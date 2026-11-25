import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { test, expect, type BrowserContext } from "@playwright/test";
import type { JornadaApp } from "../../src/lib/driver/jornada-app-types";

const url = process.env.E2E_DATABASE_URL;
if (!url || process.env.E2E_ISOLATED_DATABASE !== "1" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("Esta prueba usa exclusivamente PostgreSQL local aislado.");
}
const db = new PrismaClient({ datasourceUrl: url });
const uid = randomUUID();
const password = "Jornada-" + uid;
const email = uid + "@example.com";
let admin: string, driver: string, vehicle: string, schedule: string, route: string, fila: string, passenger: string;

test.beforeEach(async () => {
  // Los casos comparten loopback en la base efímera del runner.
  await db.rateLimitHit.deleteMany({ where: { key: { in: [
    "acceso-corta:127.0.0.1", "acceso-hora:127.0.0.1", "acceso-corta:::1", "acceso-hora:::1",
    "acceso-corta:::ffff:127.0.0.1", "acceso-hora:::ffff:127.0.0.1"
  ] } } });
});
test.beforeAll(async () => {
  driver = (await db.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 4), role: "DRIVER", isActive: true } })).id;
  admin = (await db.user.create({ data: { email: "admin-" + email, passwordHash: await bcrypt.hash(password, 4), role: "ADMIN", isActive: true } })).id;
  vehicle = (await db.vehicle.create({ data: { name: "Combi del turno", licensePlate: "TEST", internalNumber: "411" } })).id;
  route = (await db.travelRoute.create({ data: {
    slug: uid, from: "Cabecera de prueba", to: "Terminal del lago", via: "Ruta 40", durationMin: 90,
    priceCents: 100, category: "REGIONAL", description: "", stops: []
  } })).id;
  schedule = (await db.schedule.create({ data: {
    driverId: driver, vehicleId: vehicle, routeId: route, departureAt: new Date(Date.now() - 60000), arrivalAt: new Date(Date.now() + 3600000)
  } })).id;
  const reserva = await db.reservation.create({ data: {
    schedule: { connect: { id: schedule } }, code: uid, shortCode: uid.slice(0, 8), passengerCount: 3, totalCents: 300, status: "CONFIRMED",
    passenger: { create: { firstName: "Ana", lastName: "Prueba", documentType: "DNI", documentId: "0000", email, phone: "" } }
  } });
  fila = reserva.id;
  passenger = reserva.passengerId;
});

test.afterAll(async () => {
  if (driver) await db.driverServiceMark.deleteMany({ where: { driverId: driver } });
  if (fila) await db.reservation.delete({ where: { id: fila } });
  if (route) await db.travelRoute.delete({ where: { id: route } });
  if (passenger) await db.passenger.delete({ where: { id: passenger } });
  if (admin) await db.user.delete({ where: { id: admin } });
  if (driver) await db.user.delete({ where: { id: driver } });
  if (vehicle) await db.vehicle.delete({ where: { id: vehicle } });
  await db.$disconnect();
});

async function loginLocal(context: BrowserContext, cuenta: string) {
  const response = await context.request.post("/api/v1/auth/login", { data: { email: cuenta, password } });
  expect(response.status()).toBe(200);
  // El runner usa HTTP en loopback. Playwright sólo envía las cookies Secure de producción por HTTPS.
  if (process.env.PLAYWRIGHT_USE_BUILD === "1") {
    const { token, user } = await response.json();
    const domain = new URL(response.url()).hostname;
    await context.addCookies([
      { domain, path: "/", name: "araucana_session", value: token, httpOnly: true },
      ...(user.role === "DRIVER" ? [{ domain, path: "/chofer", name: "chofer_offline", value: user.id }] : [])
    ]);
  }
}

test("reabre la hoja sin red, sincroniza la corrección y conserva la asignación original al reasignar", async ({ page, context, browser }) => {
  test.setTimeout(150000);
  await loginLocal(context, email);
  const respuesta = await page.request.get("/api/v1/driver/jornada");
  expect(respuesta.status()).toBe(200);
  const agenda = await respuesta.json() as JornadaApp;
  const hoja = agenda.servicios.find(s => s.id === "salida-" + schedule)!;
  expect(hoja.nave?.id).toBe(vehicle);
  expect(hoja.filas.map(f => f.id)).toEqual([fila]);
  const gps = (vehicleId: string) => page.request.post("/api/v1/driver/location", {
    data: { servicioId: hoja.id, vehicleId, latitude: -40.1, longitude: -71.3, recordedAt: new Date().toISOString() }
  });
  expect((await gps(vehicle)).status()).toBe(200);
  expect((await gps("otra")).status()).toBe(403);
  await page.goto("/chofer");
  await page.getByRole("button", { name: /Ver hoja de ruta/i }).click();
  await expect(page.getByText("Ana Prueba")).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Ausente", exact: true }).click();
  await expect(page.getByText(/Pendientes de envío · 1/)).toBeVisible();
  const otraPestana = await context.newPage();
  await page.close();
  await otraPestana.goto("/chofer");
  await otraPestana.getByRole("button", { name: /Ver hoja de ruta/i }).click();
  await expect(otraPestana.getByText(/Ausente en esta nave/)).toBeVisible();
  await otraPestana.getByRole("button", { name: "Otra cantidad" }).click();
  await otraPestana.getByLabel("Cantidad en esta nave").fill("2");
  await otraPestana.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(otraPestana.getByText(/Pendientes de envío · 2/)).toBeVisible();
  await context.setOffline(false);
  await expect.poll(async () => db.driverServiceMark.count({ where: { driverId: driver } })).toBe(2);
  const http = otraPestana.request;
  const vigentes = await (await http.get("/api/v1/driver/marcas")).json();
  expect(vigentes.marcas).toHaveLength(1);
  expect(vigentes.marcas[0].cantidad).toBe(2);

  const oficina = await browser.newContext({ baseURL: new URL(otraPestana.url()).origin });
  const tablero = await oficina.newPage();
  await loginLocal(oficina, "admin-" + email);
  await tablero.goto("/admin/naves/en-vivo");
  await tablero.getByLabel("Recorridos de hoy").selectOption(hoja.id);
  await expect(tablero.locator(".flota-plan-ficha")).toContainText("Embarcados 2");
  await tablero.goto(`/admin/rutas/${route}/salidas/${schedule}/planilla`);
  await expect(tablero.getByLabel("Registro del chofer")).toContainText("2 de 3 embarcados");

  const payload = { id: randomUUID(), servicioId: hoja.id, vehicleId: vehicle, comprobante: hoja.comprobante,
    tipo: "fin", at: new Date().toISOString() };
  const post = () => http.post("/api/v1/driver/marcas", { data: payload });
  await db.schedule.update({ where: { id: schedule }, data: { driverId: null } });
  const [primera, repetida] = await Promise.all([post(), post()]);
  expect(await primera.json()).toMatchObject({ estado: "revision" });
  expect(await repetida.json()).toMatchObject({ estado: "revision" });
  expect(await db.driverServiceMark.count({ where: { id: payload.id } })).toBe(1);
  await tablero.goto(`/admin/choferes/${driver}/ordenes`);
  await tablero.locator("summary").filter({ hasText: "Registro del chofer" }).click();
  await expect(tablero.getByLabel("Registro del chofer")).toContainText("La asignación cambió");
  await oficina.close();
  expect((await (await http.get("/api/v1/driver/marcas")).json()).marcas).toEqual([expect.objectContaining({ id: payload.id, estado: "revision" })]);
  expect((await http.post("/api/v1/driver/location", { data: { servicioId: hoja.id, vehicleId: vehicle, latitude: -40, longitude: -71, recordedAt: new Date().toISOString() } })).status()).toBe(403);
});

test("comparte la planilla entre las naves asignadas, señala la diferencia y pausa GPS si se superponen", async ({ context, browser }) => {
  const host = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  const otroContexto = await browser.newContext({ baseURL: host });
  const administracion = await browser.newContext({ baseURL: host });
  const segundoMail = "segundo-" + email;
  const suplente = await db.user.create({ data: { email: segundoMail, role: "DRIVER", isActive: true, passwordHash: await bcrypt.hash(password, 4) } });
  const extra = await db.vehicle.create({ data: { name: "Refuerzo del turno" } });
  const servicioId = "salida-" + schedule;
  try {
    await db.schedule.update({ where: { id: schedule }, data: { driverId: driver } });
    await db.scheduleUnit.create({ data: { scheduleId: schedule, vehicleId: extra.id, driverId: suplente.id } });
    await Promise.all([loginLocal(context, email), loginLocal(otroContexto, segundoMail), loginLocal(administracion, "admin-" + email)]);
    const enviar = async (sesion: BrowserContext, nave: string) => {
      const response = await sesion.request.get("/api/v1/driver/jornada");
      const datos = await response.json() as JornadaApp;
      const hoja = datos.servicios.find(s => s.id === servicioId)!;
      expect(hoja).toMatchObject({ compartida: true, nave: { id: nave }, filas: [{ id: fila, cantidad: 3 }] });
      const payload = { id: randomUUID(), servicioId, vehicleId: nave, tipo: "embarque", filaId: fila,
        cantidad: 2, at: new Date().toISOString(), comprobante: hoja.comprobante };
      const r = await sesion.request.post("/api/v1/driver/marcas", { data: payload });
      expect(await r.json()).toMatchObject({ estado: "guardada" });
      return payload;
    };
    const [propia] = await Promise.all([enviar(context, vehicle), enviar(otroContexto, extra.id)]);
    const copiaAjena = await otroContexto.request.post("/api/v1/driver/marcas", { data: { ...propia, id: randomUUID() } });
    expect(copiaAjena.status()).toBe(403);
    const tablero = await administracion.newPage();
    await tablero.goto(`/admin/rutas/${route}/salidas/${schedule}/planilla`);
    await expect(tablero.getByLabel("Registro del chofer")).toContainText("Reservas con exceso de embarque · 1");
    await db.scheduleUnit.updateMany({ where: { scheduleId: schedule, vehicleId: extra.id }, data: { driverId: driver } });
    for (const vehicleId of [vehicle, extra.id]) {
      const gps = await context.request.post("/api/v1/driver/location", {
        data: { servicioId, vehicleId, latitude: -40, longitude: -71, recordedAt: new Date().toISOString() }
      });
      expect(gps.status()).toBe(403);
    }
  } finally {
    await Promise.all([otroContexto.close(), administracion.close()]);
    await db.driverServiceMark.deleteMany({ where: { driverId: suplente.id } });
    await db.scheduleUnit.deleteMany({ where: { scheduleId: schedule, vehicleId: extra.id } });
    await db.user.delete({ where: { id: suplente.id } });
    await db.vehicle.delete({ where: { id: extra.id } });
  }
});

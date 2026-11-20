import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";
import { createReservationShortCode } from "../../src/lib/booking/codes";

/**
 * Orden de servicio por nave: un vuelo con dos naves da dos órdenes, cada una con su imprimir, su
 * Excel y su link para el chofer, y la recorrida se ordena desde la misma pantalla.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const email = `orden-${suffix}@example.com`;
const password = `Test-${suffix}-orden`;
const day = "2031-03-14";
const naves = { a: { name: `Sprinter ${suffix}`, id: "", assignment: "" }, b: { name: `Master ${suffix}`, id: "", assignment: "" } };
// Del aeropuerto hacia el centro: Ana queda más cerca que Beto, y Beto más que Ceci.
const pasajeros = {
  ana: { firstName: "Ana", seats: 3, lat: -40.08, lng: -71.15, code: "" },
  beto: { firstName: "Beto", seats: 2, lat: -40.12, lng: -71.3, code: "" },
  ceci: { firstName: "Ceci", seats: 2, lat: -40.157, lng: -71.353, code: "" }
};
let flightId = "";
const chofer = `Rosa ${suffix}`;
const oficina = { enabled: false, label: "la sucursal", address: "Oficina de prueba 123", point: [-40.16, -71.36] };
let oficinaAnterior: { value: string; updatedBy: string | null } | null = null;

test.beforeAll(async () => {
  oficinaAnterior = await db.appSetting.findUnique({ where: { key: "airport.officePickup" }, select: { value: true, updatedBy: true } });
  await db.user.create({ data: { email: `chofer-${suffix}@example.com`, name: chofer, role: "DRIVER", isActive: true } });
  await db.user.create({ data: { email, name: "Admin orden", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  const flight = await db.flight.create({ data: {
    number: `AR${1000 + Math.floor(Math.random() * 8999)}`, origin: "Aeroparque", direction: "DEPARTURE",
    scheduledAt: new Date(`${day}T15:15:00-03:00`), source: "MANUAL"
  } });
  flightId = flight.id;
  for (const nave of Object.values(naves)) {
    const vehicle = await db.vehicle.create({ data: { name: nave.name, seats: { create: Array.from({ length: 8 }, (_, i) => ({ number: String(i + 1), row: i + 1, column: 1 })) } } });
    nave.id = vehicle.id;
    nave.assignment = (await db.airportVehicleAssignment.create({ data: { flightId, vehicleId: vehicle.id } })).id;
  }
  for (const pasajero of Object.values(pasajeros)) {
    pasajero.code = `ARA-2603-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    await db.reservation.create({ data: {
      code: pasajero.code, shortCode: createReservationShortCode(), bookingMode: "AIRPORT", status: "CONFIRMED",
      passengerCount: pasajero.seats, totalCents: pasajero.seats * 1000000, currency: "ARS",
      passenger: { create: { firstName: pasajero.firstName, lastName: suffix, email: "orden@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "30111222" } },
      airportDetails: { create: {
        flightId, flightNumber: flight.number, direction: "DEPARTURE", serviceDate: new Date(`${day}T12:00:00-03:00`),
        pickupName: `Hotel ${pasajero.firstName}`, pickupLatitude: pasajero.lat, pickupLongitude: pasajero.lng
      } }
    } });
  }
});
test.afterAll(async () => {
  if (oficinaAnterior) {
    await db.appSetting.upsert({ where: { key: "airport.officePickup" }, create: { key: "airport.officePickup", ...oficinaAnterior }, update: oficinaAnterior });
  } else {
    await db.appSetting.deleteMany({ where: { key: "airport.officePickup" } });
  }
  await db.$disconnect();
});

test.beforeEach(async ({ page }) => {
  await db.rateLimitHit.deleteMany();
  await db.payment.deleteMany({ where: { reservation: { code: { in: Object.values(pasajeros).map((pasajero) => pasajero.code) } } } });
  await db.appSetting.upsert({
    where: { key: "airport.officePickup" },
    create: { key: "airport.officePickup", value: JSON.stringify(oficina) },
    update: { value: JSON.stringify(oficina) }
  });
  await db.airportReservationDetails.updateMany({ where: { flightId }, data: { routePosition: null, assignmentId: null } });
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
});

const orden = (page: Page, nave: string) => page.locator("section.orden-bloque").filter({ has: page.getByRole("heading", { name: new RegExp(nave) }) });
const nombres = async (page: Page, nave: string) =>
  (await orden(page, nave).locator("tbody tr[data-codigo] td:first-child").allInnerTexts()).map((texto) => texto.replace(/^\W*\d+\.\s*/, "").split(" ")[0]);

async function abrir(page: Page) {
  await page.goto(`/admin/aeropuerto/orden-de-servicio/ver?date=${day}&flight=${flightId}`);
  await expect(page.locator("section.orden-bloque")).toHaveCount(2);
}

test("un vuelo con dos naves da una orden por nave, repartida por capacidad en el orden de la recorrida", async ({ page }) => {
  await abrir(page);
  expect(await nombres(page, naves.a.name)).toEqual(["Ana"]);
  // Es una partida: la recorrida termina en el aeropuerto, así que arranca por la más lejana (Ceci).
  expect(await nombres(page, naves.b.name)).toEqual(["Ceci", "Beto"]);
  // Naves de 8 butacas venden 4 para el aeropuerto (las de menos de 26 dejan 4 para el equipaje).
  await expect(orden(page, naves.a.name).locator(".orden-inicio-recorrida")).toContainText(/Inicio de recorrida\s*\d{2}:\d{2}/);
  await expect(orden(page, naves.b.name).locator("tfoot")).toContainText(`Total OUT`);
  await expect(orden(page, naves.b.name).locator("tfoot")).toContainText(naves.b.name);

  for (const nave of [naves.a.name, naves.b.name]) {
    const bloque = orden(page, nave);
    await expect(bloque.getByRole("button", { name: "Imprimir" })).toBeVisible();
    await expect(bloque.getByRole("link", { name: "Descargar Excel" })).toBeVisible();
    await expect(bloque.getByRole("button", { name: "Copiar link" })).toBeVisible();
  }
  // El contacto usa el mismo botón verde «W» del listado de reservas, sin el texto «WhatsApp».
  const whatsapp = orden(page, naves.a.name).getByRole("link", { name: "Enviar WhatsApp a +5492944000000" });
  await expect(whatsapp).toHaveText("W");
  await expect(whatsapp).toHaveClass(/whatsapp-link/);
  await expect(whatsapp).toHaveAttribute("href", /wa\.me|whatsapp/);
  await expect(orden(page, naves.a.name)).not.toContainText("· WhatsApp");
  // Las opciones ya no están arriba para todo el día.
  await expect(page.locator(".orden-link-chofer")).toHaveCount(0);

  const excel = await orden(page, naves.b.name).getByRole("link", { name: "Descargar Excel" }).getAttribute("href");
  expect(excel).toContain(`vehicle=${naves.b.assignment}`);
  const respuesta = await page.request.get(excel!);
  expect(respuesta.status()).toBe(200);
  expect(respuesta.headers()["content-disposition"]).toContain(`master-${suffix.toLowerCase()}`);
  await page.screenshot({ path: "/tmp/araucana-orden-por-nave.png", fullPage: true });
});

test("las flechas reordenan la recorrida y queda guardada para el chofer", async ({ page }) => {
  await abrir(page);
  await orden(page, naves.b.name).getByRole("button", { name: `Bajar Ceci ${suffix}` }).click();
  await expect(orden(page, naves.b.name).getByText("Recorrida guardada.")).toBeVisible();
  const guardado = await db.airportReservationDetails.findMany({ where: { flightId, assignmentId: naves.b.assignment }, orderBy: { routePosition: "asc" }, include: { reservation: { select: { code: true } } } });
  expect(guardado.map((detalle) => detalle.reservation.code)).toEqual([pasajeros.beto.code, pasajeros.ceci.code]);

  await page.reload();
  expect(await nombres(page, naves.b.name)).toEqual(["Beto", "Ceci"]);
  await expect(orden(page, naves.b.name).getByRole("button", { name: "Orden sugerido" })).toBeVisible();
  await orden(page, naves.b.name).getByRole("button", { name: "Orden sugerido" }).click();
  await expect.poll(() => nombres(page, naves.b.name)).toEqual(["Ceci", "Beto"]);
});

test("arrastrar una fila cambia el orden, y soltarla en la otra nave la pasa a esa nave", async ({ page }) => {
  // Las dos órdenes tienen que entrar en pantalla: un arrastre HTML que tiene que hacer scroll a mitad de
  // camino no suelta en Chromium.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await abrir(page);
  const b = orden(page, naves.b.name);
  await b.locator(`tr[data-codigo="${pasajeros.beto.code}"]`).dragTo(b.locator(`tr[data-codigo="${pasajeros.ceci.code}"]`), { targetPosition: { x: 20, y: 4 } });
  await expect.poll(() => nombres(page, naves.b.name)).toEqual(["Beto", "Ceci"]);
  // Que el primer cambio termine de guardarse antes de arrastrar otra vez.
  await expect(b.getByText("Recorrida guardada.")).toBeVisible();

  const a = orden(page, naves.a.name);
  await b.locator(`tr[data-codigo="${pasajeros.ceci.code}"]`).dragTo(a.locator(`tr[data-codigo="${pasajeros.ana.code}"]`), { targetPosition: { x: 20, y: 4 } });
  await expect.poll(() => nombres(page, naves.a.name)).toEqual(["Ceci", "Ana"]);
  await expect.poll(() => nombres(page, naves.b.name)).toEqual(["Beto"]);
  const ceci = await db.airportReservationDetails.findFirstOrThrow({ where: { reservation: { code: pasajeros.ceci.code } } });
  expect(ceci.assignmentId).toBe(naves.a.assignment);
});

test("«Nave» pasa al pasajero al final de la otra nave", async ({ page }) => {
  await abrir(page);
  await orden(page, naves.a.name).getByLabel(`Nave de Ana ${suffix}`).selectOption(naves.b.assignment);
  await expect.poll(() => nombres(page, naves.b.name)).toEqual(["Ceci", "Beto", "Ana"]);
  // La nave que quedó vacía sigue en pantalla para poder volver a soltar gente.
  await expect(orden(page, naves.a.name)).toContainText("Sin pasajeros en esta nave");
});

test("el link copiado abre sólo la orden de esa nave, sin usuario", async ({ page, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await abrir(page);
  await orden(page, naves.a.name).getByRole("button", { name: "Copiar link" }).click();
  await expect(orden(page, naves.a.name).getByRole("button", { name: "Link copiado" })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/orden\//);

  const anonimo = await browser.newContext();
  const chofer = await anonimo.newPage();
  await chofer.goto(link);
  await expect(chofer.locator("section.orden-bloque")).toHaveCount(1);
  await expect(chofer.locator("section.orden-bloque")).toContainText(`Ana ${suffix}`);
  await expect(chofer.locator("section.orden-bloque")).not.toContainText(`Beto ${suffix}`);
  await chofer.getByRole("button", { name: "Visualizar recorrido" }).click();
  await expect(chofer.locator(".recorrido-mapa-oficina")).toHaveAttribute("title", `Oficina · ${oficina.address} (inicio del recorrido)`);
  await expect(chofer.locator(".recorrido-mapa-parada")).toHaveText(["1"]);
  await anonimo.close();
});

test("cada orden tiene su «Nave y chofer», que abre el modal de la combi y vuelve a la orden", async ({ page }) => {
  await abrir(page);
  // Ya no hay un botón general que mandaba a «Salidas del día».
  await expect(page.getByRole("link", { name: "Asignar naves y choferes" })).toHaveCount(0);
  const b = orden(page, naves.b.name);
  const boton = b.getByRole("button", { name: /nave y chofer del/ });
  await expect(boton).toHaveText(`Nave y chofer: ${naves.b.name} · sin chofer`);
  await expect(orden(page, naves.a.name).getByRole("button", { name: /nave y chofer del/ })).toHaveText(`Nave y chofer: ${naves.a.name} · sin chofer`);

  await boton.click();
  const modal = page.getByRole("dialog", { name: /Combi del/ });
  // El mismo modal que en Aeropuerto: las combis del vuelo y los dos buscadores, nave y chofer.
  await expect(modal.getByLabel(/Buscar nave para/)).toBeVisible();
  await expect(modal.getByLabel(/Buscar chofer para/)).toBeVisible();
  await page.screenshot({ path: "/tmp/araucana-orden-modal.png" });
  await modal.getByLabel(`Chofer de ${naves.b.name}`).selectOption({ label: chofer });
  await modal.getByRole("button", { name: "Guardar chofer" }).nth(1).click();

  await expect(page.getByText("Chofer asignado a la combi.")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/aeropuerto\/orden-de-servicio\/ver\?date=2031-03-14&flight=/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(orden(page, naves.b.name).getByRole("button", { name: /nave y chofer del/ })).toHaveText(`Nave y chofer: ${naves.b.name} · ${chofer}`);
  expect((await db.airportVehicleAssignment.findUniqueOrThrow({ where: { id: naves.b.assignment }, include: { driver: true } })).driver?.name).toBe(chofer);
  await page.screenshot({ path: "/tmp/araucana-orden-asignada.png", fullPage: true });
  await db.airportVehicleAssignment.update({ where: { id: naves.b.assignment }, data: { driverId: null } });
});

test("Imprimir de una orden deja sólo esa orden en el papel", async ({ page }) => {
  await page.addInitScript(() => { window.print = () => undefined; });
  await abrir(page);
  await orden(page, naves.b.name).getByRole("button", { name: "Imprimir" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(orden(page, naves.b.name)).toBeVisible();
  await expect(orden(page, naves.a.name)).toBeHidden();
  await expect(page.locator(".orden-cabecera")).toBeVisible();
});

test("«Visualizar recorrido» muestra debajo de la orden el mapa con las paradas numeradas", async ({ page }) => {
  await abrir(page);
  const b = orden(page, naves.b.name);
  await b.getByRole("button", { name: "Visualizar recorrido" }).click();
  const mapa = b.getByRole("img", { name: /Mapa del recorrido/ });
  await expect(mapa).toBeVisible();
  // La oficina no ocupa un número de pasajero, incluso con el atajo del checkout apagado.
  await expect(b.locator(".recorrido-mapa-parada")).toHaveText(["1", "2"]);
  await expect(b.locator(".recorrido-mapa-aeropuerto")).toHaveCount(1);
  const marcaOficina = b.locator(".recorrido-mapa-oficina");
  await expect(marcaOficina).toHaveAttribute("title", `Oficina · ${oficina.address} (inicio del recorrido)`);
  await expect(b).toContainText(`La línea sale de la oficina (${oficina.address})`);
  // El primer vértice de la línea coincide con la oficina, no con el primer retiro.
  const primerVertice = await b.locator("path.leaflet-interactive").getAttribute("d");
  const posicionOficina = await marcaOficina.evaluate((element) => {
    const posicion = element.style.transform.match(/translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/)!;
    return `${posicion[1]} ${posicion[2]}`;
  });
  expect(primerVertice?.startsWith(`M${posicionOficina}L`)).toBe(true);
  await b.screenshot({ path: "/tmp/araucana-orden-mapa.png" });
  await b.getByRole("button", { name: "Ocultar recorrido" }).click();
  await expect(mapa).toHaveCount(0);
});

test("sin coordenadas de la oficina avisa que falta el tramo inicial", async ({ page }) => {
  await db.appSetting.update({ where: { key: "airport.officePickup" }, data: { value: JSON.stringify({ ...oficina, point: null }) } });
  await abrir(page);
  const b = orden(page, naves.b.name);
  await b.getByRole("button", { name: "Visualizar recorrido" }).click();
  await expect(b.getByRole("img", { name: /Mapa del recorrido/ })).toBeVisible();
  await expect(b).toContainText("Falta configurar su punto en el mapa para mostrar el tramo inicial.");
  await expect(b.locator(".recorrido-mapa-oficina")).toHaveCount(0);
  await expect(b.locator(".recorrido-mapa-parada")).toHaveText(["1", "2"]);
});

test("los arribos siguen saliendo del aeropuerto", async ({ page }) => {
  await db.flight.update({ where: { id: flightId }, data: { direction: "ARRIVAL" } });
  await db.airportReservationDetails.updateMany({ where: { flightId }, data: { direction: "ARRIVAL" } });
  try {
    await abrir(page);
    const b = orden(page, naves.b.name);
    await b.getByRole("button", { name: "Visualizar recorrido" }).click();
    await expect(b.locator(".recorrido-mapa-aeropuerto")).toHaveAttribute("title", "Aeropuerto Chapelco (inicio del recorrido)");
    await expect(b.locator(".recorrido-mapa-oficina")).toHaveCount(0);
    await expect(b).toContainText("la línea sale del aeropuerto");
  } finally {
    await db.flight.update({ where: { id: flightId }, data: { direction: "DEPARTURE" } });
    await db.airportReservationDetails.updateMany({ where: { flightId }, data: { direction: "DEPARTURE" } });
  }
});

test("la forma de pago se guarda desde la orden y se imprime en los casilleros", async ({ page, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await abrir(page);
  const a = orden(page, naves.a.name);
  const selector = a.getByRole("combobox", { name: `Forma de pago de Ana ${suffix}` });
  await expect(selector).toHaveValue("");
  const casilleros = a.locator(".orden-forma-pago-casillero");
  await page.emulateMedia({ media: "print" });
  await expect(selector).toBeHidden();
  await expect(casilleros.first()).toBeVisible();
  await expect(casilleros).toHaveText(["", ""]);
  await page.emulateMedia({ media: "screen" });

  await selector.selectOption("Efectivo");
  await expect(a.getByRole("status")).toHaveText("Forma de pago guardada.");
  await expect(selector).toHaveValue("Efectivo");
  const reserva = await db.reservation.findUniqueOrThrow({ where: { code: pasajeros.ana.code }, include: { payment: true } });
  expect(reserva.status).toBe("CONFIRMED");
  expect(reserva.payment).toMatchObject({ method: "Efectivo", status: "PENDING", amountCents: reserva.totalCents });

  await page.reload();
  await expect(selector).toHaveValue("Efectivo");
  await page.emulateMedia({ media: "print" });
  await expect(casilleros).toHaveText(["✓", ""]);
  await expect(casilleros.first()).toBeVisible();
  await page.screenshot({ path: "/tmp/araucana-orden-forma-pago-impresa.png", fullPage: true });
  await page.emulateMedia({ media: "screen" });

  // La descarga lee el método guardado, igual que el papel.
  const respuesta = await page.request.get((await a.getByRole("link", { name: "Descargar Excel" }).getAttribute("href"))!);
  expect(respuesta.status()).toBe(200);
  const ExcelJS = (await import("exceljs")).default;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await respuesta.body() as unknown as Parameters<typeof libro.xlsx.load>[0]);
  let metodoExcel = "";
  libro.getWorksheet("Orden de servicio")!.eachRow((fila) => {
    if (String(fila.getCell(1).value).includes(`Ana ${suffix}`)) metodoExcel = String(fila.getCell(8).value);
  });
  expect(metodoExcel).toBe("[x] Efectivo\n[ ] Transferencia");

  await a.getByRole("button", { name: "Copiar link" }).click();
  await expect(a.getByRole("button", { name: "Link copiado" })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const anonimo = await browser.newContext();
  try {
    const chofer = await anonimo.newPage();
    await chofer.goto(link);
    await expect(chofer.locator(".orden-forma-pago-casillero")).toHaveText(["✓", ""]);
    await expect(chofer.getByRole("combobox", { name: /Forma de pago/ })).toHaveCount(0);
  } finally {
    await anonimo.close();
  }

  await selector.selectOption("");
  await expect(selector).toHaveValue("");
  await expect.poll(async () => (await db.payment.findUnique({ where: { reservationId: reserva.id } }))?.method).toBeNull();
  await expect(casilleros).toHaveText(["", ""]);
});

test("cargar transferencia conserva el pago aprobado y sus datos", async ({ page }) => {
  const reserva = await db.reservation.findUniqueOrThrow({ where: { code: pasajeros.ana.code } });
  await db.payment.create({ data: {
    reservationId: reserva.id, method: "Efectivo", status: "APPROVED", provider: "MANUAL",
    amountCents: reserva.totalCents, currency: "ARS", externalRef: "Referencia previa"
  } });
  await abrir(page);
  const selector = orden(page, naves.a.name).getByRole("combobox", { name: `Forma de pago de Ana ${suffix}` });
  await selector.selectOption("Transferencia");
  await expect(selector).toHaveValue("Transferencia");
  expect(await db.payment.findUniqueOrThrow({ where: { reservationId: reserva.id } })).toMatchObject({
    method: "Transferencia", status: "APPROVED", amountCents: reserva.totalCents,
    provider: "MANUAL", currency: "ARS", externalRef: "Referencia previa"
  });
  await expect(orden(page, naves.a.name).locator(".orden-forma-pago-casillero")).toHaveText(["", "✓"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(selector).toBeVisible();
  await orden(page, naves.a.name).screenshot({ path: "/tmp/araucana-orden-forma-pago-celular.png" });
});

test("optimiza oficina → retiros → aeropuerto igual en panel, Excel y enlace del chofer", async ({ page, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const vuelo = await db.flight.create({ data: {
    number: `OPT${suffix}`, origin: "Aeroparque", direction: "DEPARTURE", scheduledAt: new Date(`${day}T15:15:00-03:00`), source: "MANUAL"
  } });
  const puntos = [
    { firstName: "Oeste", lat: -40.165, lng: -71.365 },
    { firstName: "Este", lat: -40.15, lng: -71.337 },
    { firstName: "Oficina", lat: oficina.point[0], lng: oficina.point[1] },
    { firstName: "Sin punto", lat: null, lng: null }
  ];
  for (const p of puntos) {
    await db.reservation.create({ data: {
      code: `ARA-OPT-${randomUUID().replaceAll("-", "")}`, shortCode: createReservationShortCode(),
      bookingMode: "AIRPORT", status: "CONFIRMED", passengerCount: 1, totalCents: 1000000, currency: "ARS",
      passenger: { create: { firstName: p.firstName, lastName: suffix, email: "opt@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "30111222" } },
      airportDetails: { create: {
        flightId: vuelo.id, flightNumber: vuelo.number, direction: "DEPARTURE", serviceDate: new Date(`${day}T12:00:00-03:00`),
        pickupName: p.firstName, pickupLatitude: p.lat, pickupLongitude: p.lng
      } }
    } });
  }
  await page.goto(`/admin/aeropuerto/orden-de-servicio/ver?date=${day}&flight=${vuelo.id}`);
  const filas = page.locator(".orden-tabla tbody tr[data-codigo] td:first-child");
  const esperado = ["Oficina", "Oeste", "Este", "Sin punto"].map((nombre) => `${nombre} ${suffix}`);
  await expect(filas).toContainText(esperado);
  await page.getByRole("button", { name: "Visualizar recorrido" }).click();
  await expect(page.locator(".recorrido-mapa-parada")).toHaveText(["1", "2", "3"]);
  await expect(page.locator(".recorrido-mapa-parada").first()).toHaveAttribute("title", /1\. Oficina/);
  await expect(page.locator(".recorrido-mapa-oficina")).toBeVisible();
  await expect(page.getByText("Línea orientativa entre puntos", { exact: false })).toBeVisible();
  await expect(page.locator(".recorrido-mapa-sin-ubicar")).toContainText("Sin punto");

  const respuesta = await page.request.get((await page.getByRole("link", { name: "Descargar Excel" }).getAttribute("href"))!);
  expect(respuesta.status()).toBe(200);
  const ExcelJS = (await import("exceljs")).default;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await respuesta.body() as unknown as Parameters<typeof libro.xlsx.load>[0]);
  const nombresExcel: string[] = [];
  libro.getWorksheet("Orden de servicio")!.eachRow((fila) => {
    const nombre = String(fila.getCell(1).value ?? "");
    if (esperado.includes(nombre)) nombresExcel.push(nombre);
  });
  expect(nombresExcel).toEqual(esperado);

  await page.getByRole("button", { name: "Copiar link" }).click();
  await expect(page.getByRole("button", { name: "Link copiado" })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const anonimo = await browser.newContext();
  try {
    const chofer = await anonimo.newPage();
    await chofer.goto(link);
    await expect(chofer.locator(".orden-tabla tbody tr td:first-child")).toContainText(esperado);
  } finally {
    await anonimo.close();
  }
});

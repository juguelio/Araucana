import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createReservationShortCode } from "../../src/lib/booking/codes";

/**
 * Todos los modales del panel (los de `RowModal`) flotan sobre la pantalla, entran en la ventana y se
 * cierran con Escape. Un modal sin su CSS se monta igual, «visible» pero al pie de la página y con el
 * scroll bloqueado: para el operador es un botón que no abre nada. Pasó cuando un rediseño se llevó
 * las reglas `.fleet-docs-*` de globals.css.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const email = `modales-ven-${suffix}@example.com`;
const password = `Test-${suffix}-modales`;
const date = "2031-07-14";
const vuelos = {
  partidaA: { id: `mv-pa-${suffix}`, number: `MV${1000 + Math.floor(Math.random() * 4000)}` },
  partidaB: { id: `mv-pb-${suffix}`, number: `MV${5000 + Math.floor(Math.random() * 4000)}` },
  arriboA: { id: `mv-aa-${suffix}`, number: `MA${1000 + Math.floor(Math.random() * 4000)}` },
  arriboB: { id: `mv-ab-${suffix}`, number: `MA${5000 + Math.floor(Math.random() * 4000)}` }
};
let reservaCode = "";

test.beforeAll(async () => {
  await db.user.create({ data: { email, name: "Admin modales", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  await db.flight.createMany({ data: [
    { ...vuelos.partidaA, airline: "AR", origin: "AEP", destination: "AEP", direction: "DEPARTURE", source: "MANUAL", status: "SCHEDULED", scheduledAt: new Date(`${date}T15:15:00-03:00`) },
    { ...vuelos.partidaB, airline: "AR", origin: "AEP", destination: "AEP", direction: "DEPARTURE", source: "MANUAL", status: "SCHEDULED", scheduledAt: new Date(`${date}T16:30:00-03:00`) },
    { ...vuelos.arriboA, airline: "AR", origin: "AEP", direction: "ARRIVAL", source: "MANUAL", status: "SCHEDULED", scheduledAt: new Date(`${date}T18:00:00-03:00`) },
    { ...vuelos.arriboB, airline: "AR", origin: "AEP", direction: "ARRIVAL", source: "MANUAL", status: "SCHEDULED", scheduledAt: new Date(`${date}T18:40:00-03:00`) }
  ] });
  // Pasajeros en una partida, para que aparezca «Hoja del chofer».
  await db.reservation.create({ data: {
    code: `ARA-2607-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`, shortCode: createReservationShortCode(),
    bookingMode: "AIRPORT", status: "CONFIRMED", passengerCount: 2, totalCents: 2000000, currency: "ARS",
    passenger: { create: { firstName: "Ana", lastName: suffix, email: "modales@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "30111222" } },
    airportDetails: { create: {
      flightId: vuelos.partidaA.id, flightNumber: vuelos.partidaA.number, direction: "DEPARTURE", serviceDate: new Date(`${date}T12:00:00-03:00`),
      pickupName: "Hotel Ana", pickupLatitude: -40.15, pickupLongitude: -71.35
    } }
  } });
  // Una reserva de ruta con pago manual pendiente: estado, «Registrar pago», comprobante y cancelar.
  const route = await db.travelRoute.create({ data: { slug: `modales-ven-${suffix}`, from: "Origen", to: "Destino", via: "Directo", durationMin: 60, priceCents: 1500000, category: "Argentina", description: "Prueba aislada", stops: [] } });
  const vehicle = await db.vehicle.create({ data: { name: `Modales ven ${suffix}`, seats: { create: Array.from({ length: 8 }, (_, i) => ({ number: String(i + 1), row: i + 1, column: 1 })) } } });
  const day = new Date(Date.now() + 86400000 * 12).toISOString().slice(0, 10);
  const schedule = await db.schedule.create({ data: { routeId: route.id, vehicleId: vehicle.id, departureAt: new Date(`${day}T12:00:00-03:00`), arrivalAt: new Date(`${day}T13:00:00-03:00`), status: "OPEN" } });
  reservaCode = `ARC-2611-${randomUUID().replaceAll("-", "").toUpperCase()}`;
  await db.reservation.create({ data: {
    code: reservaCode, shortCode: createReservationShortCode(), route: { connect: { id: route.id } }, schedule: { connect: { id: schedule.id } },
    passengerCount: 1, status: "PENDING_PAYMENT", totalCents: 1500000, currency: "ARS",
    passenger: { create: { firstName: "Modal", lastName: suffix, email: "modal@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "30111222" } },
    payment: { create: { provider: "MANUAL", status: "PENDING", amountCents: 1500000, currency: "ARS" } }
  } });
});
test.afterAll(async () => { await db.$disconnect(); });

test.beforeEach(async ({ page }) => {
  await db.rateLimitHit.deleteMany();
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
});

/** Abre el modal desde su botón, comprueba que flota y entra en la ventana, y lo cierra con Escape. */
async function abreYSeVe(page: Page, trigger: Locator, nombre: string) {
  await trigger.click();
  const modal = page.getByRole("dialog");
  await expect(modal, nombre).toHaveCount(1);
  await expect(page.locator(".fleet-docs-backdrop"), nombre).toHaveCSS("position", "fixed");
  await expect(modal, nombre).toBeInViewport({ ratio: 0.95 });
  const caja = await modal.boundingBox();
  const ventana = page.viewportSize()!;
  expect(caja, nombre).not.toBeNull();
  expect(caja!.y, `${nombre}: arriba`).toBeGreaterThanOrEqual(0);
  expect(caja!.y + caja!.height, `${nombre}: abajo`).toBeLessThanOrEqual(ventana.height);
  if (process.env.MODALES_CAPTURAS) await page.screenshot({ path: `${process.env.MODALES_CAPTURAS}/${test.info().project.name}-${nombre}.png` });
  await page.keyboard.press("Escape");
  await expect(modal, nombre).toHaveCount(0);
}

test("los modales de Aeropuerto flotan, entran en la ventana y se cierran", async ({ page }) => {
  await page.goto(`/admin/aeropuerto?date=${date}`);
  const tarjeta = (id: string) => page.locator(`#vuelo-${id}`);
  await abreYSeVe(page, page.getByRole("button", { name: "Cargar vuelo a mano" }), "cargar-vuelo");
  await abreYSeVe(page, tarjeta(vuelos.partidaA.id).getByRole("button", { name: `Coordinar recorrida del ${vuelos.partidaA.number}` }), "coordinar-recorrida");
  await abreYSeVe(page, tarjeta(vuelos.arriboA.id).getByRole("button", { name: `Juntar arribos con el ${vuelos.arriboA.number}` }), "juntar-arribos");
  await abreYSeVe(page, tarjeta(vuelos.partidaA.id).getByRole("button", { name: `Asignar combi al ${vuelos.partidaA.number}` }), "combi");
  await abreYSeVe(page, tarjeta(vuelos.partidaA.id).getByRole("button", { name: /Hoja del chofer/ }), "hoja-del-chofer");
});

test("los modales de Reservas flotan, entran en la ventana y se cierran", async ({ page }) => {
  await page.goto(`/admin/reservas?code=${reservaCode}`);
  const fila = page.locator("li.reservas-fila").filter({ hasText: suffix });
  await expect(fila).toHaveCount(1);
  await abreYSeVe(page, fila.getByRole("button", { name: /Ver estado y pago/ }), "estado-y-pago");
  await abreYSeVe(page, fila.getByRole("button", { name: "Registrar pago" }), "registrar-pago");
  for (const [nombre, boton] of [["comprobante", /Subir comprobante|Ver comprobante/], ["cancelar", "Cancelar reserva"]] as const) {
    await fila.locator("summary.menu-fila-boton").click();
    await abreYSeVe(page, fila.getByRole("button", { name: boton }), nombre);
  }
});

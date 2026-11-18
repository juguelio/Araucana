import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * El traslado al aeropuerto se reserva sin DNI (#206, #208): el formulario lo marca «(opcional)».
 * El servidor lo seguía exigiendo, así que ni el pasajero ni el administrador podían reservar
 * dejando el documento vacío. Estas pruebas cubren los cuatro caminos: un tramo e ida y vuelta,
 * desde la web pública y desde el panel.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const slug = `airport-sin-dni-${suffix}`;
const day = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const numbers = { arrival: `SDNA${suffix}`, departure: `SDND${suffix}` };
const point = [-40.15, -71.35];
const adminEmail = `sin-dni-${suffix}@example.com`;
const adminPassword = `Test-${suffix}`;
const sinDni = { firstName: "Sin", lastName: "Documento", documentType: "DNI", documentId: "", nationality: "Argentina", email: "sin-dni@example.com", phone: "+5492944123456" };
const pickup = { pickupAddress: "Sucursal prueba", pickupPoint: point };
const leg = (flightNumber: string) => ({ flightNumber, serviceDate: day, ...pickup });
const unTramo = (passenger: Record<string, string> = sinDni) => ({ routeSlug: slug, flightNumber: numbers.arrival, direction: "ARRIVAL", serviceDate: day, passengerCount: 1, passenger, ...pickup });
const idaYVuelta = (passenger: Record<string, string> = sinDni) => ({ routeSlug: slug, passengerCount: 1, passenger, arrival: leg(numbers.arrival), departure: leg(numbers.departure) });

async function loginAdmin(request: APIRequestContext) {
  expect((await request.post("/api/v1/auth/login", { data: { email: adminEmail, password: adminPassword } })).status()).toBe(200);
}

test.beforeAll(async () => {
  await db.user.create({ data: { email: adminEmail, name: "Prueba sin DNI", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(adminPassword, 10) } });
  for (const [direction, routeSlug] of [["ARRIVAL", slug], ["DEPARTURE", `${slug}-return`]]) {
    await db.travelRoute.create({ data: { slug: routeSlug, from: direction === "ARRIVAL" ? "CPC" : "SMA", to: direction === "ARRIVAL" ? "SMA" : "CPC", via: "Directo", durationMin: 60, priceCents: 1000000, category: "Aeropuerto", description: "Prueba aislada", stops: [], bookingMode: "AIRPORT", specialType: direction } });
  }
  for (const [number, direction, hour] of [[numbers.arrival, "ARRIVAL", "12"], [numbers.departure, "DEPARTURE", "20"]]) {
    await db.flight.create({ data: { number, direction, scheduledAt: new Date(`${day}T${hour}:00:00-03:00`), origin: "Prueba", source: "MANUAL" } });
  }
  const settings = {
    // Mismos valores que airport-round-trip.spec: los specs corren en paralelo y comparten estos ajustes.
    "airport.extras": { zoneExtraCents: 500000, sportsLuggageCents: 100000, arrivalCutoffMinutes: 20, departureCutoffMinutes: 0 },
    "airport.pickupCoverage": { enabled: true, boundary: [[-40.11, -71.31], [-40.11, -71.3], [-40.1, -71.3], [-40.1, -71.31]], extraBoundary: [[-41, -72], [-41, -71], [-40, -71], [-40, -72]], exclusions: [] },
    "airport.officePickup": { enabled: true, label: "Sucursal prueba", address: "Sucursal prueba 123", point }
  };
  for (const [key, value] of Object.entries(settings)) await db.appSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
});
test.beforeEach(async () => { await db.rateLimitHit.deleteMany(); });
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: adminEmail } });
  await db.$disconnect();
});

async function documentoGuardado(code: string) {
  const r = await db.reservation.findUniqueOrThrow({ where: { code }, include: { passenger: true } });
  return r.passenger.documentId;
}

test("el pasajero reserva un tramo sin DNI", async ({ request }) => {
  const response = await request.post("/api/v1/airport/reservations", { data: unTramo() });
  expect(response.status(), await response.text()).toBe(201);
  const { reservation } = await response.json();
  expect(await documentoGuardado(reservation.code)).toBe("");
});

test("el pasajero reserva ida y vuelta sin DNI", async ({ request }) => {
  const response = await request.post("/api/v1/airport/reservations/round-trip", { data: idaYVuelta() });
  expect(response.status(), await response.text()).toBe(201);
  const { roundTrip } = await response.json();
  expect(await db.reservation.count({ where: { roundTripId: roundTrip.id } })).toBe(2);
});

test("el administrador reserva un tramo sin DNI", async ({ page }) => {
  await loginAdmin(page.request);
  const response = await page.request.post("/api/v1/airport/reservations?source=admin", { data: unTramo() });
  expect(response.status(), await response.text()).toBe(201);
  const { reservation } = await response.json();
  expect(await documentoGuardado(reservation.code)).toBe("");
});

test("el administrador reserva ida y vuelta sin DNI", async ({ page }) => {
  await loginAdmin(page.request);
  const response = await page.request.post("/api/v1/airport/reservations/round-trip?source=admin", { data: idaYVuelta() });
  expect(response.status(), await response.text()).toBe(201);
});

test("si el DNI viene cargado, sigue validándose", async ({ request }) => {
  const response = await request.post("/api/v1/airport/reservations", { data: unTramo({ ...sinDni, documentId: "12" }) });
  expect(response.status()).toBe(400);
  expect(await response.text()).toMatch(/DNI de 7 u 8 dígitos/);
});

/** Completa el checkout de un tramo (llegada) dejando el documento vacío y devuelve la respuesta del alta. */
async function reservarUnTramoSinDni(page: import("@playwright/test").Page, url: string, endpoint: string) {
  await page.goto(url);
  // Las tres tarjetas de «AirportTripOptions» están siempre a la vista; la llegada fija el sentido
  // del único tramo. No hay pasos ni botón «Continuar»: las secciones se abren solas.
  await page.locator(".wizard-option").filter({ hasText: "Llegada a Chapelco" }).click();
  // La barra estilo Kiwi con un solo tramo (el día ya viene en el link, `?date=`): se abre el panel
  // del tramo y se elige el vuelo de la lista; no hay botón de invertir.
  await page.locator(".trip-search-leg").click();
  await page.locator(".trip-search-flight").filter({ hasText: numbers.arrival }).click();
  await expect(page.getByRole("button", { name: "Invertir: cambiar desde y hacia" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Continuar|Siguiente|Completar datos/ })).toHaveCount(0);
  // Con el vuelo elegido aparece sola la sección de los lugares, con el buscador de dirección.
  const lugares = page.locator("section.pickup-flow").filter({ hasText: "Los lugares" });
  await expect(lugares).toBeVisible();
  await expect(lugares.getByLabel("Hotel, cabaña o dirección")).toBeVisible();
  await lugares.getByRole("button", { name: "Ir a Sucursal prueba" }).click();
  // Y con el lugar confirmado, los datos del pasajero, sin apretar nada en el medio.
  await expect(page.getByLabel("Nombre")).toBeVisible();
  await page.getByLabel("Nombre").fill("Sin");
  await page.getByLabel("Apellido").fill("Documento");
  await page.getByLabel("Email").fill("sin-dni-ui@example.com");
  await page.getByLabel("Codigo de pais").selectOption("+54");
  await page.getByLabel("Telefono").fill("9 294 400 0000");
  await expect(page.getByLabel(/^Documento/)).toHaveValue("");
  const respuesta = page.waitForResponse((r) => r.url().includes(endpoint) && r.request().method() === "POST");
  await page.locator(".checkout-panel").getByRole("button", { name: "Reservar", exact: true }).click();
  return respuesta;
}

test("el pasajero completa el checkout web sin DNI", async ({ page }) => {
  const response = await reservarUnTramoSinDni(page, `/reservar/${slug}?date=${day}`, "/api/v1/airport/reservations");
  expect(response.status(), await response.text()).toBe(201);
  await expect(page).toHaveURL(/\/reservas\/[A-Z0-9-]+/);
});

test("el administrador completa la reserva del panel sin DNI", async ({ page }) => {
  await loginAdmin(page.request);
  const response = await reservarUnTramoSinDni(page, `/admin/aeropuerto/reservar?date=${day}`, "/api/v1/airport/reservations?source=admin");
  expect(response.status(), await response.text()).toBe(201);
  await expect(page).toHaveURL(/\/admin\/reservas\/[A-Z0-9-]+/);
});

test("el administrador edita una reserva del aeropuerto que quedó sin DNI", async ({ page, request }) => {
  const alta = await request.post("/api/v1/airport/reservations", { data: unTramo() });
  expect(alta.status(), await alta.text()).toBe(201);
  const { reservation } = await alta.json();
  await loginAdmin(page.request);
  await page.goto(`/admin/reservas/${reservation.code}/editar`);
  await expect(page.getByLabel("Número de documento (opcional)")).toHaveValue("");
  await page.getByLabel("Teléfono", { exact: true }).fill("+5492944999888");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect.poll(async () => (await db.reservation.findUniqueOrThrow({ where: { code: reservation.code }, include: { passenger: true } })).passenger.phone).toBe("+5492944999888");
  const guardada = await db.reservation.findUniqueOrThrow({ where: { code: reservation.code }, include: { passenger: true } });
  expect(guardada.passenger.documentId).toBe("");
});

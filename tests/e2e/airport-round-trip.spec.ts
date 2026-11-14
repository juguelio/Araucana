import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Airport review tests require local database");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const slug = `airport-review-${suffix}`;
const day = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const numbers = { arrival: `TESTA${suffix}`, departure: `TESTD${suffix}`, early: `TESTE${suffix}` };
const point = [-40.15, -71.35];
const passenger = { firstName: "Prueba", lastName: "Reservas", documentType: "DNI", documentId: "30111222", nationality: "Argentina", email: "review@example.com", phone: "+5492944123456" };
const leg = (flightNumber: string) => ({ flightNumber, serviceDate: day, pickupAddress: "Sucursal prueba", pickupPoint: point });
const payload = () => ({ routeSlug: slug, passengerCount: 2, halfFareCount: 1, passenger, arrival: leg(numbers.arrival), departure: leg(numbers.departure) });

test.beforeAll(async () => {
  for (const [direction, routeSlug] of [["ARRIVAL", slug], ["DEPARTURE", `${slug}-return`]]) {
    await db.travelRoute.create({ data: { slug: routeSlug, from: direction === "ARRIVAL" ? "CPC" : "SMA", to: direction === "ARRIVAL" ? "SMA" : "CPC", via: "Directo", durationMin: 60, priceCents: 1000000, category: "Aeropuerto", description: "Prueba aislada", stops: [], bookingMode: "AIRPORT", specialType: direction } });
  }
  for (const [number, direction, hour] of [[numbers.arrival, "ARRIVAL", "12"], [numbers.departure, "DEPARTURE", "20"], [numbers.early, "DEPARTURE", "09"]]) {
    await db.flight.create({ data: { number, direction, scheduledAt: new Date(`${day}T${hour}:00:00-03:00`), origin: "Prueba", source: "MANUAL" } });
  }
  const settings = {
    "airport.extras": { zoneExtraCents: 500000, sportsLuggageCents: 100000, arrivalCutoffMinutes: 20, departureCutoffMinutes: 0 },
    "airport.pickupCoverage": { enabled: true, boundary: [[-40.11, -71.31], [-40.11, -71.3], [-40.1, -71.3], [-40.1, -71.31]], extraBoundary: [[-41, -72], [-41, -71], [-40, -71], [-40, -72]], exclusions: [] },
    "airport.officePickup": { enabled: true, label: "Sucursal prueba", address: "Sucursal prueba 123", point }
  };
  for (const [key, value] of Object.entries(settings)) await db.appSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
});
test.beforeEach(async () => { await db.rateLimitHit.deleteMany(); });
test.afterAll(async () => { await db.$disconnect(); });

test("API rechaza sentido incorrecto y vuelta anterior sin dejar reservas parciales", async ({ request }) => {
  for (const [flightNumber, error] of [[numbers.arrival, "FLIGHT_NOT_FOUND"], [numbers.early, "INVALID_ROUND_TRIP_ORDER"]]) {
    const before = await db.reservation.count();
    const response = await request.post("/api/v1/airport/reservations/round-trip", { data: { ...payload(), departure: leg(flightNumber) } });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect((await response.json()).error.code).toBe(error);
    expect(await db.reservation.count()).toBe(before);
  }
});

test("API crea dos pagos con recargo y no sobrevende el último cupo concurrente", async ({ request }) => {
  const response = await request.post("/api/v1/airport/reservations/round-trip", { data: payload() });
  expect(response.status()).toBe(201);
  const { roundTrip } = await response.json();
  const saved = await db.reservation.findMany({ where: { roundTripId: roundTrip.id }, include: { payment: true } });
  expect(saved).toHaveLength(2);
  expect(saved.map(r => r.totalCents)).toEqual([2000000, 2000000]);
  expect(saved.every(r => r.payment?.amountCents === r.totalCents && r.payment.status === "PENDING")).toBe(true);
  // Quedan 22 plazas por vuelo. Dos solicitudes simultáneas de 22: sólo una puede entrar.
  const results = await Promise.all([1, 2].map(() => request.post("/api/v1/airport/reservations/round-trip", { data: { ...payload(), passengerCount: 22, halfFareCount: 0 } })));
  expect(results.filter(r => r.status() === 201)).toHaveLength(1);
  expect(results.filter(r => r.status() === 409)).toHaveLength(1);
  const reservations = await db.reservation.findMany({ where: { airportDetails: { flightNumber: numbers.arrival } } });
  expect(reservations.reduce((n, r) => n + r.passengerCount, 0)).toBe(24);
  // Liberar para el caso visual siguiente, conservando los registros de la prueba.
  await db.reservation.updateMany({ where: { airportDetails: { flightNumber: { in: Object.values(numbers) } } }, data: { status: "CANCELLED" } });
});

test("checkout móvil muestra recargos y crea el viaje al precio anunciado", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/reservar/${slug}/ida-y-vuelta?date=${day}`);
  const selects = page.locator(".leg-card select");
  await expect(selects).toHaveCount(2);
  const arrival = await db.flight.findFirstOrThrow({ where: { number: numbers.arrival } });
  const departure = await db.flight.findFirstOrThrow({ where: { number: numbers.departure } });
  await selects.nth(0).selectOption(arrival.id);
  await selects.nth(1).selectOption(departure.id);
  await page.getByRole("button", { name: /Continuar con los pickups/ }).click();
  await page.getByRole("button", { name: "Ir a Sucursal prueba" }).click();
  await expect(page.getByText(/incluye recargo de zona/).first()).toBeVisible();
  const sidebar = page.locator(".checkout-summary");
  await expect(sidebar.locator(".price")).toHaveText(/30[.,]000/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: /Continuar con tus datos/ }).click();
  await page.getByLabel("Nombre").fill("Prueba");
  await page.getByLabel("Apellido").fill("Checkout");
  await page.getByLabel("Email").fill("checkout@example.com");
  await page.getByLabel("Codigo de pais").selectOption("+54");
  await page.getByLabel("Telefono").fill("9 294 400 0000");
  await page.getByLabel(/^Documento/).fill("30111222");
  const responsePromise = page.waitForResponse(r => r.url().includes("/api/v1/airport/reservations/round-trip") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Reservar ida y vuelta", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const { roundTrip } = await response.json();
  expect(roundTrip.arrival.totalCents + roundTrip.departure.totalCents).toBe(3000000);
  await expect(page.getByRole("heading", { name: "Ida y vuelta reservada" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver el comprobante y pagar" })).toHaveCount(2);
  await page.screenshot({ path: "/tmp/araucana-live-checkout-mobile.png", fullPage: true });
});

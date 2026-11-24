import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";

const url = process.env.E2E_DATABASE_URL;
if (!url || process.env.E2E_ISOLATED_DATABASE !== "1" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Requires isolated local database");
const db = new PrismaClient({ datasourceUrl: url });

test.afterAll(() => db.$disconnect());

test("cinco pasajeros en tres alojamientos con una orden privada y una nave asignada después", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const email = `privada-${suffix}@example.com`;
  const password = `Test-${suffix}`;
  const day = "2032-09-02";
  const slug = `privada-${suffix}`;
  await db.user.create({ data: { email, name: "Administración", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 4) } });
  await db.travelRoute.create({ data: { slug, from: "Aeropuerto", to: "San Martín", via: "Directo", durationMin: 60, priceCents: 100000, category: "Argentina",
    bookingMode: "AIRPORT", specialType: "ARRIVAL", description: "Traslado", stops: [] } });
  const flight = await db.flight.create({ data: { number: `AR${suffix}`.toUpperCase(), origin: "Aeroparque", direction: "ARRIVAL", scheduledAt: new Date(`${day}T15:00:00-03:00`), source: "MANUAL" } });
  const vehicle = await db.vehicle.create({ data: { name: `Combi privada ${suffix}`, seats: { create: Array.from({ length: 12 }, (_, i) => ({ number: String(i + 1), row: i + 1, column: 1 })) } } });
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
  await page.goto(`/admin/reservas/nueva?servicio=aeropuerto&sentido=ARRIVAL&date=${day}&vuelo=${flight.id}`);
  await page.getByRole("checkbox", { name: /Privada · nave exclusiva/ }).check();
  const stops = ["Hotel Lago, Villa La Angostura", "Cabañas del Río, Junín", "Hostería del Bosque, Traful"];
  for (const [i, stop] of stops.entries()) {
    if (i) await page.getByRole("button", { name: "Agregar parada" }).click();
    await page.getByLabel(`Parada ${i + 1}`, { exact: true }).fill(stop);
    await page.getByLabel(`Pasajeros en la parada ${i + 1}`, { exact: true }).fill(i === 2 ? "1" : "2");
  }
  await page.getByLabel(/Precio total del tramo/).fill("100000");
  await page.locator('[name="firstName"]').fill("Silvia");
  await page.locator('[name="lastName"]').fill("Del Valle");
  await page.locator('[name="phone"]').fill("2944123456");
  await page.getByRole("button", { name: "Crear reserva privada" }).click();
  await expect(page).toHaveURL(/\/admin\/reservas\/ARC-/);
  const code = page.url().split("/").pop()!;
  const saved = await db.reservation.findUniqueOrThrow({ where: { code }, include: { payment: true, privateAirportVehicle: true, airportDetails: true } });
  expect(saved).toMatchObject({ passengerCount: 5, totalCents: 10000000, privateAirportVehicle: null, payment: { amountCents: 10000000 }, airportDetails: { isPrivate: true } });
  await expect(page.locator("body")).toContainText("Traslado privado · paradas y nave");
  await page.getByLabel("Nave exclusiva", { exact: true }).selectOption(vehicle.id);
  await page.getByRole("button", { name: "Guardar paradas y nave" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Traslado privado actualizado." })).toBeVisible();

  const common = { routeSlug: slug, serviceDate: day, direction: "ARRIVAL", flightNumber: flight.number, passengerCount: 1,
    passenger: { firstName: "Otro", lastName: "Pasajero", phone: "+5492944123456", email: "", documentType: "DNI", documentId: "" } };
  const duplicate = await page.request.post("/api/v1/airport/reservations?source=admin", { data: { ...common,
    privateTransfer: { vehicleId: vehicle.id, totalCents: 2000, stops: [{ destination: "Junín", passengers: 1 }] } } });
  expect((await duplicate.json()).error.code).toBe("PRIVATE_VEHICLE_UNAVAILABLE");
  const shared = await page.request.post("/api/v1/airport/reservations?source=admin", { data: { ...common, pickupPoint: [-40.157, -71.353] } });
  expect(shared.ok(), await shared.text()).toBe(true);
  await page.goto(`/admin/aeropuerto/orden-de-servicio/ver?date=${day}&flight=${flight.id}`);
  const order = page.locator(".orden-bloque").filter({ has: page.getByRole("heading", { name: new RegExp(`Privada · ${vehicle.name}`) }) });
  await expect(order.locator("tbody tr")).toHaveCount(3);
  await expect(order.getByText("Silvia Del Valle")).toHaveCount(3);
  await expect(order.getByText("Otro Pasajero")).toHaveCount(0);
  for (const stop of stops) await expect(order.getByText(stop, { exact: true })).toBeVisible();
  await expect(order.getByText(/^Cobrar/)).toHaveCount(1);
  const scope = new URLSearchParams({ date: day, flight: flight.id, vehicle: `privada-${saved.airportDetails!.id}` });
  const download = await page.request.get(`/admin/aeropuerto/orden-de-servicio?${scope}`);
  expect(download.ok()).toBe(true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await download.body()).buffer);
  const exported = JSON.stringify(workbook.worksheets[0].getSheetValues());
  for (const stop of stops) expect(exported).toContain(stop);
  expect(exported).not.toContain("Otro Pasajero");
  expect(await db.reservation.count({ where: { airportDetails: { flightId: flight.id } } })).toBe(2);
});

test("ida y vuelta privada conserva la tarifa de cada tramo y permite asignar la nave al crear", async ({ request }) => {
  const suffix = randomUUID().slice(0, 8);
  const email = `vuelta-${suffix}@example.com`;
  const password = `Test-${suffix}`;
  await db.user.create({ data: { email, role: "SECRETARY", isActive: true, passwordHash: await bcrypt.hash(password, 4) } });
  expect((await request.post("/api/v1/auth/login", { data: { email, password } })).ok()).toBe(true);
  const vehicle = await db.vehicle.create({ data: { name: `Privada ida y vuelta ${suffix}`, seats: { create: Array.from({ length: 12 }, (_, i) => ({ number: String(i + 1), row: i + 1, column: 1 })) } } });
  const legs = [];
  for (const [i, direction] of ["ARRIVAL", "DEPARTURE"].entries()) {
    const serviceDate = `2032-09-0${i + 3}`;
    const number = `RT${suffix}${i}`.toUpperCase();
    const slug = `vuelta-${direction.toLowerCase()}-${suffix}`;
    await db.travelRoute.create({ data: { slug, from: "Origen", to: "Destino", via: "Directo", durationMin: 60, priceCents: 1000,
      category: "Argentina", bookingMode: "AIRPORT", specialType: direction, description: "Traslado", stops: [] } });
    await db.flight.create({ data: { number, direction, origin: "Aeroparque", scheduledAt: new Date(`${serviceDate}T17:00:00-03:00`), source: "MANUAL" } });
    legs.push({ flightNumber: number, serviceDate, privateTransfer: { vehicleId: vehicle.id, totalCents: 250000 + i * 10000, stops: [{ destination: "Villa Meliquina", passengers: 3 }] } });
  }
  const body = { routeSlug: `vuelta-arrival-${suffix}`, passengerCount: 3, idempotencyKey: randomUUID(), arrival: legs[0], departure: legs[1],
    passenger: { firstName: "Lila", lastName: "Pérez", phone: "+5492944123456", email: "", documentType: "DNI", documentId: "" } };
  const endpoint = "/api/v1/airport/reservations/round-trip?source=admin";
  const response = await request.post(endpoint, { data: body });
  expect(response.ok(), await response.text()).toBe(true);
  const { roundTrip } = await response.json();
  expect(roundTrip.arrival.totalCents).toBe(250000);
  expect(roundTrip.departure.totalCents).toBe(260000);
  expect(await db.airportVehicleAssignment.count({ where: { vehicleId: vehicle.id, privateReservation: { roundTripId: roundTrip.id } } })).toBe(2);
  const retry = await request.post(endpoint, { data: body });
  expect((await retry.json()).roundTrip.id).toBe(roundTrip.id);
});

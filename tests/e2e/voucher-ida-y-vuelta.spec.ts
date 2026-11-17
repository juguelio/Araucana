import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { createReservationShortCode } from "../../src/lib/booking/codes";

/**
 * Voucher del ida y vuelta: muestra los dos tramos, suma el valor y lo pagado de los dos, y nombra el
 * código del otro tramo. Se abre con el enlace privado (el `code`), sin sesión.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const roundTripId = randomUUID();
const tramos = {
  ida: { code: `ARC-2611-${randomUUID().replaceAll("-", "").toUpperCase()}`, shortCode: createReservationShortCode(), direction: "ARRIVAL", flight: "JA3181", day: "2031-04-10", paid: true },
  vuelta: { code: `ARC-2611-${randomUUID().replaceAll("-", "").toUpperCase()}`, shortCode: createReservationShortCode(), direction: "DEPARTURE", flight: "AR1655", day: "2031-04-15", paid: false }
};

test.beforeAll(async () => {
  const passenger = await db.passenger.create({ data: { firstName: "Ida", lastName: "Vuelta", email: "ida@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "" } });
  for (const tramo of Object.values(tramos)) {
    const route = await db.travelRoute.create({ data: {
      slug: `voucher-${tramo.direction.toLowerCase()}-${roundTripId}`, from: "Aeropuerto", to: "Ciudad", via: "Ruta 234", durationMin: 30,
      priceCents: 1200000, category: "aeropuerto", description: "Prueba aislada", stops: [], bookingMode: "AIRPORT"
    } });
    await db.reservation.create({ data: {
      routeId: route.id,
      code: tramo.code, shortCode: tramo.shortCode, roundTripId, bookingMode: "AIRPORT", status: tramo.paid ? "CONFIRMED" : "PENDING_PAYMENT",
      passengerCount: 1, totalCents: 1200000, currency: "ARS", passengerId: passenger.id,
      payment: { create: { provider: "MANUAL", status: tramo.paid ? "APPROVED" : "PENDING", amountCents: 1200000, currency: "ARS" } },
      airportDetails: { create: { flightNumber: tramo.flight, direction: tramo.direction, serviceDate: new Date(`${tramo.day}T03:00:00Z`) } }
    } });
  }
});
test.afterAll(async () => { await db.$disconnect(); });

test("el voucher de cualquiera de los tramos trae los dos, con el total del viaje", async ({ page }) => {
  for (const tramo of [tramos.ida, tramos.vuelta]) {
    await page.goto(`/reservas/${tramo.code}/voucher`);
    const filas = page.locator(".voucher-tabla tbody tr");
    await expect(filas).toHaveCount(2);
    await expect(filas.nth(0)).toContainText("JA3181");
    await expect(filas.nth(1)).toContainText("AR1655");
    // La vuelta sin dirección cargada sale de la ciudad, no «Aeropuerto → Aeropuerto».
    await expect(filas.nth(1)).toContainText("San Martín de los Andes");

    const valores = page.locator(".voucher-valores");
    await expect(valores).toContainText("24.000");
    await expect(valores.locator(".voucher-saldo")).toContainText("12.000");
    await expect(page.locator(".voucher-ida-vuelta")).toContainText("Ida y vuelta");
  }
  await page.screenshot({ path: "/tmp/araucana-voucher-ida-vuelta.png", fullPage: true });
});

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
import { createReservationCode, createReservationShortCode } from "../../src/lib/booking/codes";

const url = process.env.E2E_DATABASE_URL;
if (!url || process.env.E2E_ISOLATED_DATABASE !== "1" || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("La consola se prueba con una base local aislada.");
}
const db = new PrismaClient({ datasourceUrl: url });

test("un daño señala cada servicio de la nave y se puede resolver y cobrar desde la misma consola", async ({ page }) => {
  const tag = randomUUID();
  const date = "2032-03-20";
  const email = tag + "@example.test";
  const password = "Test-" + tag;
  const admin = await db.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 8), role: "ADMIN", isActive: true } });
  const driver = await db.user.create({ data: { email: "driver-" + email, name: "Marina", role: "DRIVER", isActive: true } });
  const bus = await db.vehicle.create({ data: { name: "Patagonia " + tag, seats: { create: [{ number: "1", row: 1, column: 1 }] } } });
  const route = await db.travelRoute.create({ data: {
    slug: tag, from: "San Martín", to: "Traful", durationMin: 60, priceCents: 100000, category: "Regular", description: "", stops: [], via: "",
    schedules: { create: ["09", "13"].map(hour => ({ vehicleId: bus.id, driverId: driver.id,
      departureAt: new Date(date + "T" + hour + ":00:00-03:00"), arrivalAt: new Date(date + "T" + hour + ":50:00-03:00") })) }
  }, include: { schedules: { orderBy: { departureAt: "asc" } } } });
  const code = createReservationCode();
  const pax = await db.passenger.create({ data: { firstName: "Amalia", lastName: "Lagos", email, phone: "", documentType: "DNI", documentId: "32444221" } });
  try {
    await db.reservation.create({ data: { roundTripId: tag, code, shortCode: createReservationShortCode(), scheduleId: route.schedules[0].id,
      passengerId: pax.id, status: "PENDING_PAYMENT", passengerCount: 1, totalCents: 100000, currency: "ARS",
      payment: { create: { provider: "MANUAL", status: "PENDING", amountCents: 100000, currency: "ARS" } }
    } });
    const regreso = await db.schedule.create({ data: { routeId: route.id, vehicleId: bus.id, driverId: driver.id,
      departureAt: new Date("2032-03-21T13:00:00-03:00"), arrivalAt: new Date("2032-03-21T14:00:00-03:00") } });
    const vuelta = await db.reservation.create({ data: { roundTripId: tag, code: createReservationCode(), shortCode: createReservationShortCode(),
      scheduleId: regreso.id, passengerId: pax.id, status: "CONFIRMED", passengerCount: 1, totalCents: 100000, currency: "ARS" } });
    expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
    await page.goto("/admin?date=" + date);
    await page.getByRole("link", { name: /Flota y choferes/ }).click();
    const busRow = page.locator(".console-resource").filter({ hasText: bus.name });
    await busRow.locator("summary").click();
    await expect(busRow.locator(".console-job")).toHaveCount(2);
    await busRow.getByRole("button", { name: /Anotar daño/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Qué se dañó").fill("Falla en frenos");
    await dialog.getByLabel("Fecha", { exact: true }).fill(date);
    await dialog.getByLabel("Gravedad").selectOption("GRAVE");
    await dialog.getByRole("button", { name: "Anotar daño" }).click();
    await expect(page.getByRole("status")).toContainText("Daño anotado");
    await page.getByRole("link", { name: /Pendientes/ }).click();
    await expect(page.locator(".sd-row")).toHaveCount(2);
    await expect(page.locator(".plan-alert").first()).toContainText("daño grave");
    await page.getByRole("link", { name: /Flota y choferes/ }).click();
    await busRow.locator("summary").click();
    await busRow.locator(".console-job").last().click();
    const afternoon = page.locator(".plan-service-fold[open]");
    await expect(afternoon).toContainText("13:00");
    await afternoon.getByRole("link", { name: "Pasajeros y cobros" }).click();
    await expect(page.getByRole("heading", { name: /13:00 · San Martín/ })).toBeVisible();
    await expect(page.getByText("No hay reservas para mostrar.")).toBeVisible();
    await page.getByRole("link", { name: /Flota y choferes/ }).click();
    await busRow.locator("summary").click();
    await busRow.getByLabel("Estado del daño: Falla en frenos").selectOption("REPARADO");
    await busRow.getByRole("button", { name: "Guardar estado" }).click();
    await expect(page.getByRole("status")).toContainText("reparado");
    await expect(page.getByRole("link", { name: /Pendientes/ }).locator("strong")).toHaveText("0");
    await page.getByRole("link", { name: /^Jornada/ }).click();
    const occupied = page.locator(".sd-row").filter({ has: page.locator(".plan-time strong", { hasText: "09:00" }) });
    await occupied.locator(".plan-service-fold > summary").click();
    await occupied.getByRole("link", { name: "Pasajeros y cobros" }).click();
    await expect(page.getByRole("heading", { name: /09:00 · San Martín/ })).toBeVisible();
    await page.getByRole("searchbox", { name: "Buscar reserva" }).fill("Lagos");
    await page.getByLabel("Cola de trabajo").selectOption("pending-payment");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Amalia Lagos" }) });
    await expect(row.getByRole("link", { name: /Vuelta/ })).toHaveAttribute("href", "/admin/reservas/" + vuelta.code);
    await row.getByLabel(/Más opciones de/).click();
    await row.getByRole("button", { name: "Copiar voucher" }).click();
    await expect(row.getByRole("button", { name: "¡Voucher copiado!" })).toBeVisible();
    await row.getByLabel(/Más opciones de/).click();
    await row.getByRole("button", { name: "Registrar pago" }).click();
    await dialog.getByLabel("Forma de pago").fill("Efectivo");
    await dialog.getByRole("button", { name: "Registrar pago" }).click();
    await expect(page.getByText("Pago registrado.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(u => u.pathname === "/admin" && u.searchParams.get("vista") === "reservas" && u.searchParams.get("date") === date && u.searchParams.get("q") === "Lagos" && !!u.searchParams.get("servicio"));
    await expect(page.getByRole("link", { name: /Reservas y cobros/ })).toContainText("1 viaje por confirmar");
    await page.getByLabel("Cola de trabajo").selectOption("paid-unconfirmed");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await row.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(page.getByText("Reserva confirmada.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Reservas y cobros/ }).locator("strong")).toHaveText("0");
    const saved = await db.reservation.findUniqueOrThrow({ where: { code }, include: { payment: true } });
    expect(saved.status).toBe("CONFIRMED");
    expect(saved.payment?.status).toBe("APPROVED");
  } finally {
    await db.reservation.deleteMany({ where: { passengerId: pax.id } });
    await db.passenger.delete({ where: { id: pax.id } });
    await db.travelRoute.delete({ where: { id: route.id } });
    await db.vehicle.delete({ where: { id: bus.id } });
    await db.user.deleteMany({ where: { id: { in: [admin.id, driver.id] } } });
    await db.$disconnect();
  }
});

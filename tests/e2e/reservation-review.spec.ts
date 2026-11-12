import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createReservationShortCode } from "../../src/lib/booking/codes";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";

// The runner requires a separate database. Never fall back to DATABASE_URL here.
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
const prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID();
const password = `Test-${suffix}`;
const email = `review-${suffix}@example.com`;
let code: string;
let scheduleId: string;
let routeSlug: string;
let serviceDate: string;

test.beforeAll(async () => {
  await prisma.user.create({ data: { email, name: "Operador de prueba", role: "SECRETARY", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  routeSlug = `review-${suffix}`;
  const route = await prisma.travelRoute.create({ data: { slug: routeSlug, from: "Origen prueba", to: "Destino prueba", via: "Directo", durationMin: 60, priceCents: 10000, category: "Argentina", description: "Prueba aislada", stops: [] } });
  const vehicle = await prisma.vehicle.create({ data: { name: `Prueba ${suffix}`, seats: { create: [{ number: "1", row: 1, column: 1 }] } } });
  serviceDate = new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10);
  const schedule = await prisma.schedule.create({ data: { routeId: route.id, vehicleId: vehicle.id, departureAt: new Date(`${serviceDate}T12:00:00-03:00`), arrivalAt: new Date(`${serviceDate}T13:00:00-03:00`), status: "OPEN" } });
  scheduleId = schedule.id;
  code = `ARC-2611-${randomUUID().replaceAll("-", "").toUpperCase()}`;
  await prisma.reservation.create({ data: {
    code, shortCode: createReservationShortCode(), route: { connect: { id: route.id } }, schedule: { connect: { id: scheduleId } }, passengerCount: 1, status: "PENDING_PAYMENT", totalCents: 10000, currency: "ARS",
    passenger: { create: { firstName: "Persona", lastName: "Prueba", email: "passenger@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "TEST1234" } },
    payment: { create: { provider: "MANUAL", status: "PENDING", amountCents: 10000, currency: "ARS", receiptBlobPathname: "isolated-test/receipt.pdf", receiptFileName: "prueba.pdf" } }
  } });
});
test.afterAll(async () => { await prisma.$disconnect(); });

test("secretaría filtra, rechaza y valida un nuevo comprobante sin confirmar pagos pendientes", async ({ page }) => {
  const login = await page.request.post("/api/v1/auth/login", { data: { email, password } });
  expect(login.ok()).toBeTruthy();
  await page.goto("/admin/reservas");
  await page.getByLabel("Código de reserva").fill(code);
  await page.getByLabel("Fecha del viaje").fill(serviceDate);
  await page.getByLabel("Ruta (origen, destino o identificador)").fill(routeSlug);
  await page.getByLabel("ID de salida").fill(scheduleId);
  await page.getByRole("button", { name: "Buscar reservas" }).click();
  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Rechazar", exact: true }).click();
  await expect(page.getByText("Comprobante rechazado. El pasajero puede enviar uno nuevo.")).toBeVisible();
  const rejected = await prisma.reservation.findUniqueOrThrow({ where: { code }, include: { payment: true } });
  expect(rejected.status).toBe("PENDING_PAYMENT");
  expect(rejected.payment?.status).toBe("REJECTED");
  await page.goto(`/reservas/${code}`);
  await expect(page.getByRole("heading", { name: "Reserva recibida · pago pendiente" })).toBeVisible();
  await expect(page.getByText(/El comprobante fue rechazado/)).toBeVisible();
  // Blob storage is deliberately not exercised: simulate a replacement already attached.
  await prisma.payment.update({ where: { reservationId: rejected.id }, data: { status: "PENDING", receiptBlobPathname: "isolated-test/replacement.pdf" } });
  await page.goto(`/admin/reservas?code=${code}`);
  await page.getByRole("button", { name: "Validar pago" }).click();
  await expect(page.getByText("Pago validado con éxito.")).toBeVisible();
  expect((await prisma.reservation.findUniqueOrThrow({ where: { code } })).status).toBe("CONFIRMED");
  await page.goto(`/reservas/${code}`);
  await expect(page.getByRole("heading", { name: "Reserva confirmada" })).toBeVisible();
  await page.goto(`/admin/reservas?code=${code}&date=2000-01-01`);
  await expect(page.getByText("No se encontraron reservas con esos filtros.")).toBeVisible();
  await page.goto("/admin/reservas?date=2026-02-30");
  await expect(page.getByRole("alert").filter({ hasText: "Revisá los filtros" })).toBeVisible();
});

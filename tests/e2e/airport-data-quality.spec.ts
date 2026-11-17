import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID();
const email = `airport-${suffix}@example.com`;
const password = `Test-${suffix}`;
const date = "2031-11-14";
const ids = [0, 1, 2].map((i) => `quality-${suffix}-${i}`);
// Un día futuro: AirLabs no publica futuros, así que sólo hay proyecciones.
const futureDate = "2031-11-15";
const futureIds = [0, 1].map((i) => `future-${suffix}-${i}`);
test.beforeAll(async () => {
  await prisma.user.create({ data: { email, name: "Prueba aeropuerto", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  await prisma.flight.createMany({ data: [
    { id: ids[0], number: "JA3181", airline: "JA", origin: "EZE", destination: "CPC", direction: "ARRIVAL", source: "FIDS", status: "LANDED", scheduledAt: new Date(`${date}T15:04:00Z`), estimatedAt: new Date(`${date}T03:00:00Z`), lastCheckedAt: new Date("2031-11-13T22:00:00Z") },
    // Carga manual de un vuelo que se ofrece (AJ324 salió de la oferta el 14/11 y el panel ya no lo lista).
    { id: ids[1], number: "AR1700", airline: "AR", origin: "AEP", destination: "CPC", direction: "ARRIVAL", source: "MANUAL", status: "SCHEDULED", scheduledAt: new Date(`${date}T16:50:00Z`) },
    { id: ids[2], number: "AR1653", airline: "AR", origin: "AEP", destination: "AEP", direction: "DEPARTURE", source: "ESTIMADO", status: "SCHEDULED", scheduledAt: new Date(`${date}T15:45:00Z`) },
    { id: futureIds[0], number: "AR1654", airline: "AR", origin: "AEP", destination: "CPC", direction: "ARRIVAL", source: "ESTIMADO", status: "SCHEDULED", scheduledAt: new Date(`${futureDate}T16:05:00Z`) },
    { id: futureIds[1], number: "AR1655", airline: "AR", origin: "AEP", destination: "AEP", direction: "DEPARTURE", source: "ESTIMADO", status: "SCHEDULED", scheduledAt: new Date(`${futureDate}T16:45:00Z`) }
  ] });
});
test.afterAll(async () => {
  await prisma.flight.deleteMany({ where: { id: { in: [...ids, ...futureIds] } } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});
test("el panel separa datos dudosos e identifica datos manuales y proyectados", async ({ page }) => {
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
  await page.goto(`/admin/aeropuerto?date=${date}`);
  const suspect = page.locator(`#vuelo-${ids[0]}`);
  await expect(suspect.getByText("A verificar", { exact: true })).toBeVisible();
  await expect(suspect.getByText(/Fecha sin confirmar/)).toBeVisible();
  await expect(suspect.getByText(/00:00 estima/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Por verificar · 1" })).toBeVisible();
  await expect(page.locator(`#vuelo-${ids[1]}`).getByText("Sin estado en vivo", { exact: true })).toBeVisible();
  // En un día con vuelos confirmados, la proyección es un vuelo fantasma y no entra al tablero.
  await expect(page.locator(`#vuelo-${ids[2]}`)).toHaveCount(0);
  await expect(page.getByText(/vuelos que ya pasaron/i)).toHaveCount(0);
  await page.screenshot({ path: "/tmp/araucana-airport-data-quality-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(suspect.getByText("A verificar", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/araucana-airport-data-quality-mobile.png", fullPage: true });
});

test("una fecha futura muestra los vuelos estimados en el panel", async ({ page }) => {
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
  await page.goto(`/admin/aeropuerto?date=${futureDate}`);
  await expect(page.getByText(`No hay vuelos cargados para ${futureDate}.`)).toHaveCount(0);
  // Las proyecciones se ven con su rótulo en cada tarjeta, sin el aviso largo arriba.
  await expect(page.getByText(/Ningún vuelo de este día está confirmado todavía/)).toHaveCount(0);
  for (const id of futureIds) {
    await expect(page.locator(`#vuelo-${id}`).getByText(/Proyección histórica/)).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Arribos 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Partidas 1" })).toBeVisible();
  await page.screenshot({ path: "/tmp/araucana-airport-future-date.png", fullPage: true });
});

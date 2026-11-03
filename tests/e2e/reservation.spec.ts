import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
const prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const slug = `traful-test-${randomUUID()}`;
test.beforeAll(async () => {
  const route = await prisma.travelRoute.create({ data: { slug, from: "SMA", to: "Villa Traful", via: "Directo", durationMin: 60, priceCents: 10000, category: "Argentina", description: "Prueba aislada", stops: [] } });
  const vehicle = await prisma.vehicle.create({ data: { name: "Vehículo prueba reserva", seats: { create: [{ number: "1", row: 1, column: 1 }, { number: "2", row: 1, column: 2 }] } } });
  await prisma.schedule.create({ data: { routeId: route.id, vehicleId: vehicle.id, departureAt: new Date(Date.now() + 86400000 * 7), arrivalAt: new Date(Date.now() + 86400000 * 7 + 3600000), status: "OPEN" } });
});
test.afterAll(async () => { await prisma.$disconnect(); });

async function waitForReactFormHydration(page: Page) {
  await page.locator("form").evaluate((form) => {
    return new Promise<void>((resolve, reject) => {
      const hasReactProps = () => Object.keys(form).some((key) => key.startsWith("__reactProps$"));

      if (hasReactProps()) {
        resolve();
        return;
      }

      const timeout = window.setTimeout(() => {
        window.clearInterval(interval);
        reject(new Error("Timed out waiting for the reservation form to hydrate"));
      }, 10_000);

      const interval = window.setInterval(() => {
        if (!hasReactProps()) {
          return;
        }

        window.clearTimeout(timeout);
        window.clearInterval(interval);
        resolve();
      }, 50);
    });
  });
}

test.describe("Reserva web", () => {
  test("permite completar una reserva de un lugar para Villa Traful", async ({ page }) => {
    await page.goto(`/rutas/${slug}`);
    await page.getByRole("link", { name: "Reservar asiento" }).click();

    await expect(page).toHaveURL(new RegExp(`/reservar/${slug}$`));
    await waitForReactFormHydration(page);

    const departure = page.locator("label.schedule-option").first();
    await expect(departure).toBeVisible();
    await departure.click();
    await expect(departure.locator('input[name="scheduleId"]')).toBeChecked();

    await page.getByLabel("Nombre").fill("Camila");
    await page.getByLabel("Apellido").fill("Vidal");
    await page.getByLabel("Email").fill(`camila.${Date.now()}@example.com`);
    await page.getByLabel("Codigo de pais").selectOption("+54");
    await page.getByLabel("Telefono").fill("9 294 400 0000");
    await page.getByLabel("Tipo de documento").selectOption("DNI");
    await page.getByLabel("Documento", { exact: true }).fill("30111222");

    await page.getByRole("button", { name: "Confirmar reserva" }).click();

    await expect(page).toHaveURL(/\/reservas\/ARC-/, { timeout: 20000 });
    await expect(page.getByRole("heading", { name: "Reserva recibida · pago pendiente" })).toBeVisible();
    await expect(page.getByText("1 lugar", { exact: true }).first()).toBeVisible();
  });
});

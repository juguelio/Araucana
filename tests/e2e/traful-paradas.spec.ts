import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID();
const origin = "San Martín de los Andes";
const terminal = "Villa Traful";
const email = `tramos-${suffix}@example.com`;
let returnId: string;

test.beforeAll(async () => {
  await db.user.create({ data: { email, name: "Operador", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(suffix, 4) } });
  const vehicle = await db.vehicle.create({ data: { name: suffix, seats: { create: [{ number: "1", row: 1, column: 1 }, { number: "2", row: 1, column: 2 }] } } });
  for (const [i, [from, to]] of [[origin, terminal], [terminal, origin]].entries()) {
    const departureAt = new Date(Date.now() + (7 + i) * 86400000);
    const schedule = await db.schedule.create({ data: {
      departureAt, arrivalAt: new Date(+departureAt + 7200000), vehicle: { connect: { id: vehicle.id } },
      route: { create: { from, to, slug: `tramos-${i}-${suffix}`, via: "7 Lagos", category: "Argentina",
        description: "Servicio de prueba", stops: [], durationMin: 120, priceCents: 3000000 } }
    } });
    if (i === 1) returnId = schedule.id;
  }
});

test.afterAll(async () => { await db.$disconnect(); });

// La navegación desde el buscador carga HTML nuevo. Esperar el formulario interactivo
// antes del primer clic evita marcar un checkbox mientras React sigue hidratándolo.
async function waitForCheckout(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form.checkout-layout");
    return form && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
  });
}

test("reserva y cobra dos tramos intermedios desde el buscador", async ({ page }) => {
  await page.goto("/rutas");
  await page.locator('select[name="from"]').selectOption("Río Hermoso");
  await page.locator('select[name="to"]').selectOption("Falkner");
  await page.getByRole("button", { name: "Buscar salidas" }).click();
  const card = page.locator("article").filter({ has: page.locator(`form[action="/reservar/tramos-0-${suffix}"]`) });
  await expect(card.getByRole("heading")).toHaveText("Río Hermoso → Falkner");
  await card.getByRole("button").click();
  await waitForCheckout(page);
  await expect(page.getByLabel("Parada de subida")).toHaveValue("Río Hermoso");
  const bajada = page.getByLabel("Parada de bajada");
  await expect(bajada).toHaveValue("Falkner");
  await expect(bajada.getByRole("option", { name: /Río Hermoso|Acceso Chapelco/ })).toHaveCount(0);
  await page.getByLabel("Ida y vuelta", { exact: true }).check();
  await page.getByLabel(/Vuelta · Falkner → Río Hermoso/).selectOption(returnId);
  await expect(page.locator(".checkout-summary .price")).toContainText(/12[.]000/);
  await page.getByLabel("Nombre", { exact: true }).fill("Camila");
  await page.getByLabel("Apellido").fill("Vidal");
  await page.getByLabel("Email").fill("tramos@example.com");
  await page.getByLabel("Codigo de pais").selectOption("+54");
  await page.getByLabel("Telefono").fill("9 294 400 0000");
  await page.getByLabel("Documento", { exact: true }).fill("30111222");
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(page).toHaveURL(/\/reservas\/ARC-/);
  const code = page.url().split("/").at(-1);
  const ida = await db.reservation.findUniqueOrThrow({ where: { code } });
  expect(ida.roundTripId).toBeTruthy();
  const legs = await db.reservation.findMany({ where: { roundTripId: ida.roundTripId }, include: { payment: true }, orderBy: { schedule: { departureAt: "asc" } } });
  expect(legs).toMatchObject([
    { boardingStop: "Río Hermoso", dropoffStop: "Falkner", totalCents: 600000, payment: { amountCents: 600000 } },
    { boardingStop: "Falkner", dropoffStop: "Río Hermoso", totalCents: 600000, payment: { amountCents: 600000 } }
  ]);
  await page.getByRole("link", { name: "Ver mi voucher" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Río Hermoso" })).toHaveCount(2);
});

test("el mostrador selecciona la subida y la bajada en Desde y Hacia", async ({ page }) => {
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password: suffix } })).status()).toBe(200);
  await page.goto(`/admin/reservas/nueva?desde=${encodeURIComponent(origin)}&hacia=Villa+Traful`);
  await waitForCheckout(page);
  await page.locator('[data-campo="desde"]').click();
  await page.getByRole("radio", { name: /Río Hermoso/ }).click();
  await page.getByRole("radio", { name: /Falkner/ }).click();
  await page.locator(".trip-search-flight").first().click();
  await page.locator('[data-campo="agregar-vuelta"]').click();
  await page.locator(".trip-search-flight").first().click();
  await expect(page.locator('input[name="boardingStop"]')).toHaveValue("Río Hermoso");
  await expect(page.locator('input[name="returnBoardingStop"]')).toHaveValue("Falkner");
  await expect(page.locator("aside .price")).toContainText(/12[.]000/);
  await page.getByLabel("Nombre", { exact: true }).fill("Ana");
  await page.getByLabel("Apellido").fill("Del Lago");
  await page.getByLabel("Codigo de pais").selectOption("+54");
  await page.getByLabel("Telefono").fill("9 294 400 0000");
  await page.getByRole("button", { name: "Crear ida y vuelta" }).click();
  await expect(page).toHaveURL(/\/admin\/reservas\/ARC-/);
  const code = page.url().split("/").at(-1);
  const ida = await db.reservation.findUniqueOrThrow({ where: { code } });
  expect(ida).toMatchObject({ boardingStop: "Río Hermoso", dropoffStop: "Falkner", totalCents: 600000 });
  expect(ida.roundTripId).toBeTruthy();
  expect(await db.reservation.findFirstOrThrow({ where: { roundTripId: ida.roundTripId, id: { not: ida.id } } }))
    .toMatchObject({ boardingStop: "Falkner", dropoffStop: "Río Hermoso", totalCents: 600000 });
});

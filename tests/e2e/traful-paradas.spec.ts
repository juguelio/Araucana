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


test.beforeAll(async () => {
  await db.user.create({ data: { email, name: "Operador", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(suffix, 4) } });
  for (const direction of ["DEPARTURE", "ARRIVAL"]) {
    await db.travelRoute.create({data: {slug: `airport-${direction.toLowerCase()}-${suffix}`, from: direction === "DEPARTURE" ? origin : "Aeropuerto Chapelco",
      to: direction === "DEPARTURE" ? "Aeropuerto Chapelco" : origin, via: "Directo", category: "Aeropuerto", bookingMode: "AIRPORT", specialType: direction,
      stops: [], description: "Traslado de prueba", durationMin: 40, priceCents: 1000000 }});
  }
  const vehicle = await db.vehicle.create({ data: { name: suffix, seats: { create: [{ number: "1", row: 1, column: 1 }, { number: "2", row: 1, column: 2 }] } } });
  for (const [i, [from, to]] of [[origin, terminal], [terminal, origin]].entries()) {
    const departureAt = new Date(Date.now() + (7 + i) * 86400000);
    await db.schedule.create({ data: {
      departureAt, arrivalAt: new Date(+departureAt + 7200000), vehicle: { connect: { id: vehicle.id } },
      route: { create: { from, to, slug: `tramos-${i}-${suffix}`, via: "7 Lagos", category: "Argentina",
        description: "Servicio de prueba", stops: [], durationMin: 120, priceCents: 3000000 } }
    } });

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
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/");
  const search = page.locator(".public-trip-search");
  await expect(search.locator('[data-campo="hacia"]')).toContainText("Aeropuerto Chapelco");
  await search.locator('[data-campo="desde"]').click();
  await search.getByRole("radio", {name: /Río Hermoso/}).click();
  await expect(page).toHaveURL(/\/rutas\?from=/);
  await expect(search.locator('[data-campo="desde"]')).toContainText("Río Hermoso");
  await search.locator('[data-campo="hacia"]').click();
  await search.getByRole("radio", {name: /Falkner/}).click();
  await search.locator(".trip-search-flight").first().click();
  await search.locator('[data-campo="agregar-vuelta"]').click();
  await search.locator(".trip-search-flight").first().click();
  await page.getByRole("link", {name: "Continuar con la reserva"}).click();
  await waitForCheckout(page);
  await expect(page.locator('[data-campo="desde"]')).toContainText("Río Hermoso");
  await expect(page.locator('[data-campo="hacia"]')).toContainText("Falkner");
  await expect(page.locator('[data-campo="vuelta"]')).toHaveAttribute("data-listo", "true");
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

test("el buscador de rutas conserva el vuelo elegido al continuar o agregar vuelta", async ({ page }) => {
  await page.route("**/api/v1/airport/flights?*", async request => {
    const day = new URL(request.request().url()).searchParams.get("date");
    await request.fulfill({json: { flights: [{
      id: "flight-test", number: "AR9999", direction: "DEPARTURE", available: 8,
      bookable: true, airline: "AR", scheduledAt: day + "T18:00:00-03:00", estimatedAt: null
    }] }});
  });
  await page.goto("/rutas");
  const search = page.locator(".public-trip-search");
  await search.locator('[data-campo="DEPARTURE"]').click();
  await search.getByRole("button", {name: /AR9999/}).click();
  await expect(search.getByRole("link", {name: "Continuar con la reserva"})).toHaveAttribute("href", /sentido=DEPARTURE&vuelo=flight-test/);
  await expect(search.getByRole("link", {name: /Agregar vuelta/})).toHaveAttribute("href", /ida-y-vuelta.*vuelo=flight-test/);
});

test("el mostrador selecciona la subida y la bajada en Desde y Hacia", async ({ page }) => {
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password: suffix } })).status()).toBe(200);
  await page.goto("/admin/reservas/nueva");
  await waitForCheckout(page);
  await page.locator('[data-campo="desde"]').click();
  await page.getByRole("radio", { name: /Río Hermoso/ }).click();
  await expect(page).toHaveURL(/desde=/);
  await page.locator('[data-campo="hacia"]').click();
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

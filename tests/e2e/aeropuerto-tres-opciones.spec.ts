import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Un solo criterio para reservar el aeropuerto: «Llegada a Chapelco», «Salida desde San Martín» e «Ida y
 * vuelta», como tres tarjetas iguales en la reserva web de un tramo, en la de ida y vuelta y en el panel.
 * Ya no está el recuadro verde «Reservar ida y vuelta» ni las pestañas del panel.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const slug = `tres-opciones-${suffix}`;
const day = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
const email = `opciones-${suffix}@example.com`;
const password = `Test-${suffix}-opc`;

test.beforeAll(async () => {
  await db.user.create({ data: { email, name: "Admin opciones", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  for (const [direction, routeSlug] of [["ARRIVAL", slug], ["DEPARTURE", `${slug}-return`]]) {
    await db.travelRoute.create({ data: { slug: routeSlug, from: direction === "ARRIVAL" ? "CPC" : "SMA", to: direction === "ARRIVAL" ? "SMA" : "CPC", via: "Directo", durationMin: 60, priceCents: 1000000, category: "Aeropuerto", description: "Prueba aislada", stops: [], bookingMode: "AIRPORT", specialType: direction } });
  }
});
test.afterAll(async () => { await db.$disconnect(); });

const tarjetas = (page: Page) => ({
  llegada: page.locator(".wizard-option").filter({ hasText: "Llegada a Chapelco" }),
  salida: page.locator(".wizard-option").filter({ hasText: "Salida desde San Martín" }),
  idaYVuelta: page.locator(".wizard-option").filter({ hasText: "Ida y vuelta" })
});

test("la reserva web muestra las tres opciones y ya no el recuadro verde de ida y vuelta", async ({ page }) => {
  await page.goto(`/reservar/${slug}?date=${day}`);
  await expect(page.getByRole("heading", { name: "¿Vas y volvés?" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reservar ida y vuelta" })).toHaveCount(0);
  const t = tarjetas(page);
  await expect(t.llegada).toBeVisible();
  await expect(t.salida).toBeVisible();
  await expect(t.idaYVuelta).toBeVisible();
  await page.screenshot({ path: "/tmp/araucana-tres-opciones-web.png", fullPage: true });

  await t.idaYVuelta.click();
  await expect(page).toHaveURL(new RegExp(`/reservar/${slug}/ida-y-vuelta`));
  const enIdaYVuelta = tarjetas(page);
  await expect(enIdaYVuelta.idaYVuelta).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "/tmp/araucana-tres-opciones-ida-vuelta.png", fullPage: true });

  await enIdaYVuelta.salida.click();
  await expect(page).toHaveURL(/sentido=DEPARTURE/);
  // La reserva de un tramo entra con el sentido ya elegido y la barra del vuelo a la vista: la
  // página es una sola que se despliega sola, así que ya no hay «Paso 2 de 3».
  await expect(page.locator(".trip-search-leg")).toHaveCount(1);
  await expect(page.locator('.trip-search-place[data-campo="desde"] .trip-search-chip')).toHaveText("San Martín de los Andes");
});

test("el panel usa las mismas tres opciones en vez de pestañas", async ({ page }) => {
  await db.rateLimitHit.deleteMany();
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
  await page.goto(`/admin/aeropuerto/reservar?date=${day}`);
  await expect(page.getByRole("navigation", { name: "Tramos de la reserva" })).toHaveCount(0);
  const t = tarjetas(page);
  await expect(t.llegada).toBeVisible();
  await t.idaYVuelta.click();
  await expect(page).toHaveURL(/tramos=ida-y-vuelta/);
  await expect(tarjetas(page).idaYVuelta).toHaveAttribute("aria-pressed", "true");
  await tarjetas(page).llegada.click();
  await expect(page).toHaveURL(/\/admin\/aeropuerto\/reservar\?.*sentido=ARRIVAL/);
  // La barra del vuelo queda a la vista, con Desde fijo en el aeropuerto (el sentido vino en el link).
  await expect(page.locator(".trip-search-leg")).toHaveCount(1);
  await expect(page.locator('.trip-search-place[data-campo="desde"] .trip-search-chip')).toHaveText("Aeropuerto Chapelco");
});

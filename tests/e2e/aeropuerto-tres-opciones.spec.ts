import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";

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

async function probarTramos(page: Page, inicial: "Llegada" | "Salida") {
  const invertido = inicial === "Llegada" ? "Salida" : "Llegada";
  const ida = (sentido: string) => page.getByRole("button", { name: new RegExp("Ida · " + sentido) });
  const invertir = page.getByRole("button", { name: "Invertir: cambiar desde y hacia" });
  const agregar = page.getByRole("link", { name: /Agregar vuelta/ });
  await expect(ida(inicial)).toBeVisible();
  await invertir.click();
  await expect(ida(invertido)).toBeVisible();
  await agregar.click();
  await expect(page.getByRole("button", { name: new RegExp("Vuelta · " + inicial) })).toBeVisible();
  await expect(ida(invertido)).toBeVisible();
  await page.getByRole("link", { name: "Sacar la vuelta y reservar un solo tramo" }).click();
  await expect(agregar).toBeVisible();
  await expect(ida(invertido)).toBeVisible();
  await expect(page).toHaveURL(new RegExp("date=" + day));
}

test("el pasajero puede invertir el sentido, agregar la vuelta y volver a un tramo", async ({ page }) => {
  await page.goto(`/reservar/${slug}?date=${day}`);
  await probarTramos(page, "Llegada");
});

test("el panel conserva el día y el sentido al cambiar los tramos de aeropuerto", async ({ page }) => {
  await db.rateLimitHit.deleteMany();
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
  await page.goto(`/admin/aeropuerto/reservar?date=${day}`);
  await probarTramos(page, "Salida");
  await expect(page).toHaveURL(/\/admin\/reservas\/nueva/);
});

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";

/**
 * Carga manual de vuelos: ya no es un formulario fijo en la pantalla de aeropuerto, sino un botón
 * que abre un modal. Al cargar el vuelo el modal se cierra y queda el aviso.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const email = `vuelo-modal-${suffix}@example.com`;
const password = `Test-${suffix}-vuelo`;
const numero = `AR${1000 + Math.floor(Math.random() * 8999)}`;

test.beforeAll(async () => {
  await db.user.create({ data: { email, name: "Admin vuelos", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
});
test.afterAll(async () => { await db.$disconnect(); });

test.beforeEach(async ({ page }) => {
  await db.rateLimitHit.deleteMany();
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
});

test("el formulario de carga manual está detrás de un botón y se abre en un modal", async ({ page }) => {
  await page.goto("/admin/aeropuerto?date=2031-05-20");
  await expect(page.getByLabel("Número de vuelo")).toHaveCount(0);

  await page.getByRole("button", { name: "Cargar vuelo a mano" }).click();
  const modal = page.getByRole("dialog", { name: "Cargar vuelo a mano" });
  await expect(modal).toBeVisible();
  await page.screenshot({ path: "/tmp/araucana-vuelo-modal.png" });

  await modal.getByLabel("Número de vuelo").fill(numero);
  await modal.getByLabel("Aerolínea").fill("Aerolíneas Argentinas");
  await modal.getByLabel(/Origen/).fill("Aeroparque (AEP)");
  await modal.getByLabel("Fecha y hora programada").fill("2031-05-20T14:30");
  await modal.getByRole("button", { name: "Agregar vuelo" }).click();

  await expect(page.getByText(`Vuelo ${numero} cargado.`)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await db.flight.count({ where: { number: numero, source: "MANUAL" } })).toBe(1);
});

test("un error de carga se muestra dentro del modal, sin cerrarlo", async ({ page }) => {
  await page.goto("/admin/aeropuerto?date=2031-05-20");
  await page.getByRole("button", { name: "Cargar vuelo a mano" }).click();
  const modal = page.getByRole("dialog", { name: "Cargar vuelo a mano" });
  await modal.getByLabel("Número de vuelo").fill(numero);
  await modal.getByLabel(/Origen/).fill("Aeroparque (AEP)");
  await modal.getByLabel("Fecha y hora programada").fill("2031-05-20T14:30");
  await modal.getByRole("button", { name: "Agregar vuelo" }).click();

  await expect(modal.getByText(/ya está cargado/)).toBeVisible();
  await expect(modal).toBeVisible();
});

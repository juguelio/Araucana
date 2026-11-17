import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";

/**
 * Listado de naves: los vencimientos se ven por unidad (alerta en la fila + detalle en un modal), ya
 * no en un bloque «Vencimientos de la flota» arriba de la tabla. La tabla se ordena por cualquier
 * columna y se pagina de a 20.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const email = `naves-${suffix}@example.com`;
const password = `Test-${suffix}`;
const dias = (n: number) => new Date(Date.now() + n * 86400000);
// 25 unidades: la tabla necesita dos páginas.
const unidades = Array.from({ length: 25 }, (_, i) => ({
  id: `nave-${suffix}-${i}`,
  name: `Prueba ${suffix} ${i}`,
  internalNumber: `9${String(i).padStart(3, "0")}`,
  brand: "Mercedes",
  model: "Sprinter",
  licensePlate: `AA${String(i).padStart(3, "0")}ZZ`,
  rtoDueAt: dias(400 + i)
}));
// La más urgente: póliza vencida hace mucho. La que más asientos tiene: 45.
const vencida = unidades[17];
const grande = unidades[3];

test.beforeAll(async () => {
  await db.user.create({ data: { email, name: "Prueba naves", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  for (const unidad of unidades) {
    await db.vehicle.create({
      data: {
        ...unidad,
        owner: unidad === vencida ? "AAA Titular" : null,
        policyDueAt: unidad === vencida ? dias(-900) : null,
        seats: { create: Array.from({ length: unidad === grande ? 45 : 2 }, (_, n) => ({ number: String(n + 1), row: n, column: 0 })) }
      }
    });
  }
});
test.afterAll(async () => {
  await db.seat.deleteMany({ where: { vehicleId: { in: unidades.map((u) => u.id) } } });
  await db.vehicle.deleteMany({ where: { id: { in: unidades.map((u) => u.id) } } });
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
});

const filas = (page: import("@playwright/test").Page) => page.locator(".naves-tabla tbody tr");

test("ya no está el bloque de vencimientos de la flota y la tabla se pagina de a 20", async ({ page }) => {
  await page.goto("/admin/naves");
  await expect(page.getByText("Vencimientos de la flota")).toHaveCount(0);
  await expect(filas(page)).toHaveCount(20);
  const paginador = page.getByRole("navigation", { name: "Paginación de naves" });
  await expect(paginador).toContainText("página 1 de");
  await paginador.getByRole("link", { name: "Siguiente →" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(paginador).toContainText("página 2 de");
  expect(await filas(page).count()).toBeGreaterThanOrEqual(5);
});

test("cada nave tiene su alerta y su propio detalle de vencimientos", async ({ page }) => {
  await page.goto("/admin/naves?orden=vencimientos&dir=asc");
  const primera = filas(page).first();
  await expect(primera).toContainText(`Interno ${vencida.internalNumber}`);
  await expect(primera).toHaveAttribute("data-nivel", "vencido");
  await expect(primera.getByText(/Póliza: Vencido hace/)).toBeVisible();
  await primera.getByRole("button", { name: /Vencimientos/ }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("heading", { name: `Interno ${vencida.internalNumber}` })).toBeVisible();
  await expect(modal.locator(".fleet-docs-row")).toHaveCount(3);
  await expect(modal.locator('.fleet-docs-row[data-nivel="vencido"]')).toContainText("Póliza");
  await modal.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("se ordena por cualquier columna y el encabezado alterna el sentido", async ({ page }) => {
  await page.goto("/admin/naves");
  const encabezados = ["Unidad", "Marca / modelo · patente", "Titular", "Seguro", "Vencimientos", "Capacidad", "Estado"];
  for (const titulo of encabezados) {
    await expect(page.locator("th").filter({ has: page.getByRole("link", { name: titulo }) })).toHaveCount(1);
  }
  const capacidad = page.locator("th").filter({ hasText: "Capacidad" });
  await capacidad.getByRole("link").click();
  await expect(capacidad).toHaveAttribute("aria-sort", "ascending");
  await capacidad.getByRole("link").click();
  await expect(capacidad).toHaveAttribute("aria-sort", "descending");
  await expect(filas(page).first()).toContainText(`Interno ${grande.internalNumber}`);
  await expect(filas(page).first()).toContainText("45 pasajeros");

  const titular = page.locator("th").filter({ hasText: "Titular" });
  await titular.getByRole("link").click();
  await expect(titular).toHaveAttribute("aria-sort", "ascending");
  await expect(filas(page).first()).toContainText("AAA Titular");
  await page.screenshot({ path: "/tmp/araucana-naves-desktop.png" });
});

test("el indicador de papeles vencidos lleva al listado ordenado por vencimientos", async ({ page }) => {
  await page.goto("/admin/naves");
  await page.getByRole("link", { name: /Papeles vencidos \/ por vencer/ }).click();
  await expect(page).toHaveURL(/orden=vencimientos&dir=asc/);
  await expect(page.locator("th").filter({ hasText: "Vencimientos" })).toHaveAttribute("aria-sort", "ascending");
});

test("en el celular se ordena con el selector", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/naves");
  const selector = page.getByRole("form", { name: "Ordenar naves" });
  await selector.getByLabel("Ordenar por").selectOption("capacidad");
  await selector.getByLabel("Sentido").selectOption("desc");
  await selector.getByRole("button", { name: "Ordenar" }).click();
  await expect(page).toHaveURL(/orden=capacidad&dir=desc/);
  await expect(filas(page).first()).toContainText("45 pasajeros");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/araucana-naves-mobile.png", fullPage: true });
});

test("el listado sólo ofrece Editar: inactivar y borrar están en la ficha", async ({ page }) => {
  await page.goto("/admin/naves");
  const acciones = filas(page).first().locator("td[data-label='Acciones']");
  await expect(acciones.getByRole("link", { name: "Editar" })).toBeVisible();
  await expect(page.locator(".naves-tabla").getByRole("button", { name: /Inactivar|Activar|Borrar|Archivar/ })).toHaveCount(0);
});

test("desde la ficha se inactiva, se reactiva y se borra con confirmación", async ({ page }) => {
  const id = `nave-${suffix}-borrable`;
  await db.vehicle.create({ data: { id, name: `Borrable ${suffix}`, internalNumber: `8${suffix.slice(0, 3)}` } });
  await page.goto(`/admin/naves/${id}`);
  const estado = page.getByRole("region", { name: "Estado de la nave" });
  await expect(estado).toContainText("Activa:");

  // Cancelar el diálogo no cambia nada.
  page.once("dialog", (dialog) => dialog.dismiss());
  await estado.getByRole("button", { name: "Inactivar nave" }).click();
  await expect.poll(async () => (await db.vehicle.findUniqueOrThrow({ where: { id } })).isActive).toBe(true);

  page.once("dialog", (dialog) => dialog.accept());
  await estado.getByRole("button", { name: "Inactivar nave" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/naves/${id}\\?notice=`));
  await expect(estado).toContainText("Inactiva:");
  expect((await db.vehicle.findUniqueOrThrow({ where: { id } })).isActive).toBe(false);

  page.once("dialog", (dialog) => dialog.accept());
  await estado.getByRole("button", { name: "Activar nave" }).click();
  await expect(estado).toContainText("Activa:");

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toMatch(/No se puede deshacer/);
    return dialog.accept();
  });
  await estado.getByRole("button", { name: "Borrar nave" }).click();
  await expect(page).toHaveURL(/\/admin\/naves\?notice=/);
  expect(await db.vehicle.findUnique({ where: { id } })).toBeNull();
});

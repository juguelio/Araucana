import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";

if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const email = `naves-${suffix}@example.com`;
const password = `Test-${suffix}`;
const dias = (n: number) => new Date(Date.now() + n * 86400000);
// Las dos docenas de unidades deben poder encontrarse también por interno y por patente.
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

const filaDe = (page: import("@playwright/test").Page, id: string) =>
  page.locator("li.naves-fila").filter({ has: page.locator(`a[href="/admin/naves/${id}"]`) });

test("la búsqueda reúne las 25 naves de la prueba y el total de sus plazas", async ({ page }) => {
  await page.goto("/admin/naves");
  await page.getByRole("searchbox", { name: "Buscar nave" }).fill(suffix);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.locator("li.naves-fila")).toHaveCount(12);
  const pages = page.locator('.naves-paginacion[data-ubicacion="arriba"]');
  await pages.getByRole("link", { name: "3", exact: true }).click();
  await expect(page.locator("li.naves-fila")).toHaveCount(1);
  await expect(page).toHaveURL(/#flota$/);
  await pages.getByRole("link", { name: "Todas" }).click();
  await expect(page.locator("li.naves-fila")).toHaveCount(25);
  await expect(page.getByRole("status")).toContainText("25 naves · 93 asientos");
});

test("la alerta de póliza abre los vencimientos de la misma nave", async ({ page }) => {
  await page.goto("/admin/naves?vista=alertas");
  const fila = filaDe(page, vencida.id);
  await expect(fila).toHaveAttribute("data-tono", "grave");
  await expect(fila.getByText(/Póliza vencida hace/)).toBeVisible();
  await fila.getByLabel(/Más opciones de/).click();
  await fila.getByRole("link", { name: "Vencimientos y seguro" }).click();
  await expect(page).toHaveURL(url => url.pathname === `/admin/naves/${vencida.id}/vencimientos`);
  const papeles = page.getByRole("region", { name: "Vencimientos", exact: true });
  await expect(papeles.getByText("Póliza de seguro")).toBeVisible();
  await expect(papeles.locator('[data-nivel="vencido"]').first()).toContainText(/Vencido hace/);
});

test("la pestaña con alertas distingue una póliza vencida de una nave al día", async ({ page }) => {
  await page.goto("/admin/naves");
  await page.getByRole("link", { name: /Con alertas/ }).click();
  await expect(filaDe(page, vencida.id)).toBeVisible();
  await expect(filaDe(page, grande.id)).toHaveCount(0);
});

test("desde Naves se abre la agenda de la unidad elegida en la consola", async ({ page }) => {
  await page.goto("/admin/naves");
  await filaDe(page, grande.id).getByLabel(/Más opciones de/).click();
  await filaDe(page, grande.id).getByRole("link", { name: "Agenda de hoy" }).click();
  await expect(page).toHaveURL(url => url.pathname === "/admin" && url.searchParams.get("vista") === "flota" && url.searchParams.get("recurso") === grande.id);
  await expect(page.locator("details.console-resource[open] > summary")).toContainText(grande.name);
});

test("en el celular se busca por patente y se ve la capacidad", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/naves");
  await page.getByRole("searchbox", { name: "Buscar nave" }).fill(grande.licensePlate.toLowerCase());
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(filaDe(page, grande.id)).toContainText("45 asientos");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("el menú de la nave abre su ficha y edición", async ({ page }) => {
  await page.goto("/admin/naves");
  const fila = filaDe(page, grande.id);
  await fila.getByLabel(/Más opciones de/).click();
  await expect(fila.getByRole("link", { name: "Ver ficha" })).toHaveAttribute("href", `/admin/naves/${grande.id}`);
  await expect(fila.getByRole("link", { name: "Editar nave" })).toHaveAttribute("href", `/admin/naves/${grande.id}/editar`);
  await expect(fila.getByRole("button", { name: /Inactivar|Activar|Borrar|Archivar/ })).toHaveCount(0);
});

test("desde la edición de la nave se inactiva, se reactiva y se borra con confirmación", async ({ page }) => {
  const id = `nave-${suffix}-borrable`;
  await db.vehicle.create({ data: { id, name: `Borrable ${suffix}`, internalNumber: `8${suffix.slice(0, 3)}` } });
  await page.goto(`/admin/naves/${id}/editar`);
  const estado = page.getByRole("region", { name: "Estado de la nave" });
  await expect(estado).toContainText("Activa:");

  // Cancelar el diálogo no cambia nada.
  page.once("dialog", (dialog) => dialog.dismiss());
  await estado.getByRole("button", { name: "Inactivar nave" }).click();
  await expect.poll(async () => (await db.vehicle.findUniqueOrThrow({ where: { id } })).isActive).toBe(true);

  page.once("dialog", (dialog) => dialog.accept());
  await estado.getByRole("button", { name: "Inactivar nave" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/naves/${id}/editar\\?notice=`));
  await expect(estado.getByRole("button", { name: "Activar nave", exact: true })).toBeVisible();
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

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";

// Este spec sólo escribe en la base aislada exigida por el runner.
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
const target = new URL(process.env.E2E_DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(target.hostname)) throw new Error("Excursions tests require local database");
const prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID();
const password = `Test-${suffix}`;
const name = `Excursión de prueba ${suffix}`;
let excursionId: string;
let firstPhotoId: string;
let secondPhotoId: string;
const date = new Date(Date.now() + 86400000 * 20).toISOString().slice(0, 10);
const departure = `${date}T09:30`;
async function login(page: Page, role: string) {
  const response = await page.request.post("/api/v1/auth/login", { data: { email: `${role.toLowerCase()}-${suffix}@example.com`, password } });
  expect(response.status()).toBe(200);
}

test.describe.serial("Excursiones: carga editorial y publicación", () => {
  test.beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 10);
    for (const role of ["SECRETARY", "ADMIN", "DRIVER", "USER"]) await prisma.user.create({ data: { email: `${role.toLowerCase()}-${suffix}@example.com`, name: "Prueba excursiones", role, isActive: true, passwordHash } });
  });
  test.afterAll(async () => {
    if (excursionId) await prisma.excursion.deleteMany({ where: { id: excursionId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
    await prisma.$disconnect();
  });

  test("catálogo vacío funciona en tres idiomas y el panel exige sesión", async ({ page }) => {
    for (const [path, message] of [["/excursiones", "Estamos preparando nuevas excursiones."], ["/en/excursiones", "We’re preparing new excursions."], ["/pt/excursiones", "Estamos preparando novas excursões."]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: message })).toBeVisible();
    }
    await page.goto("/admin/excursiones");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("secretaría crea borrador, publica con galería y fechas, y la web excluye el pasado", async ({ page }) => {
    await login(page, "SECRETARY");
    await page.goto("/admin/excursiones/nueva");
    await expect(page.getByRole("link", { name: "Excursiones", exact: true })).toBeVisible();
    await page.getByLabel("Nombre de la excursión").fill(name);
    await page.getByLabel("Descripción", { exact: true }).fill("Itinerario de prueba, sin oferta comercial real.");
    await page.getByLabel(/^Duración/).fill("4 horas");
    await page.getByLabel("Precio (opcional)").fill("12500,50");
    await page.getByRole("button", { name: "Agregar fecha de salida" }).click();
    await page.getByLabel("Salida 1", { exact: true }).fill(departure);
    await page.getByRole("button", { name: "Agregar fecha de salida" }).click();
    await page.getByLabel("Salida 2", { exact: true }).fill("2000-01-01T10:00");
    await page.getByRole("button", { name: "Crear borrador" }).click();
    await page.waitForURL(/\/admin\/excursiones\/[^/?]+\?notice=/);
    const record = await prisma.excursion.findFirstOrThrow({ where: { name }, include: { departures: true } });
    excursionId = record.id;
    expect(record.isPublished).toBe(false);
    expect(record.priceCents).toBe(1250050);
    expect(record.departures.map((d) => d.departureAt.toISOString())).toContain(`${date}T12:30:00.000Z`);
    const hidden = await page.request.get(`/excursiones/${excursionId}`);
    expect(hidden.status()).toBe(404);
    // Se prueba validación real del server action, sin enviar datos a Blob externo.
    await page.getByLabel(/^Agregar una foto/).setInputFiles({ name: "fake.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not an image") });
    await page.getByRole("button", { name: "Subir foto", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "El contenido no corresponde" })).toBeVisible();
    expect(await prisma.excursionPhoto.count({ where: { excursionId } })).toBe(0);
    // Blob externo no se ejercita: metadatos simulados y respuesta de imagen interceptada.
    const photos = await Promise.all([0, 1].map((position) => prisma.excursionPhoto.create({ data: { excursionId, blobPathname: `excursion-photos/${excursionId}/simulated-${position}.png`, contentType: "image/png", position } })));
    [firstPhotoId, secondPhotoId] = photos.map((p) => p.id);
    await page.route("**/excursiones/fotos/*", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFZkAAAAASUVORK5CYII=", "base64") }));
    await page.reload();
    await page.getByLabel("Publicar en la web", { exact: true }).check();
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await expect(page.getByText("Publicada", { exact: true })).toBeVisible();
    expect((await prisma.excursion.findUniqueOrThrow({ where: { id: excursionId } })).isPublished).toBe(true);
    await page.goto(`/excursiones/${excursionId}`);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.locator("main img")).toHaveCount(2);
    await expect(page.locator("#salidas time")).toHaveCount(1);
    await expect(page.locator("#salidas time")).toHaveAttribute("datetime", `${date}T12:30:00.000Z`);
    const href = await page.getByRole("link", { name: /Consultar esta salida:/ }).getAttribute("href");
    expect(new URL(href!).searchParams.get("text")).toContain(name);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await page.screenshot({ path: test.info().outputPath("excursion-mobile.png"), fullPage: true });
    await page.goto("/excursiones");
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test("protege ediciones concurrentes y cambiar portada/quitar fotos no deja una publicación rota", async ({ page, context }) => {
    await login(page, "SECRETARY");
    const detail = `/admin/excursiones/${excursionId}`;
    await page.goto(detail);
    const second = await context.newPage();
    await second.goto(detail);
    await page.getByLabel(/^Duración/).fill("5 horas");
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Excursión guardada" })).toBeVisible();
    await second.getByLabel(/^Duración/).fill("6 horas");
    await second.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await expect(second.getByRole("status").filter({ hasText: "La excursión cambió" })).toBeVisible();
    expect((await prisma.excursion.findUniqueOrThrow({ where: { id: excursionId } })).duration).toBe("5 horas");
    await second.close();
    await page.getByRole("button", { name: "Usar como portada", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Foto principal actualizada" })).toBeVisible();
    const ordered = await prisma.excursionPhoto.findMany({ where: { excursionId }, orderBy: { position: "asc" } });
    expect(ordered.map((p) => p.id)).toEqual([secondPhotoId, firstPhotoId]);
    for (let remaining = 1; remaining >= 0; remaining--) {
      await page.getByRole("button", { name: "Quitar foto", exact: true }).first().click();
      await expect(page.getByRole("status").filter({ hasText: "Foto eliminada" })).toBeVisible();
      await expect.poll(() => prisma.excursionPhoto.count({ where: { excursionId } })).toBe(remaining);
    }
    expect((await prisma.excursion.findUniqueOrThrow({ where: { id: excursionId } })).isPublished).toBe(false);
    expect((await page.request.get(`/excursiones/${excursionId}`)).status()).toBe(404);
    await page.getByText("Eliminar excursión", { exact: true }).click();
    await page.getByLabel("Escribí ELIMINAR para confirmar").fill("ELIMINAR");
    await page.getByRole("button", { name: "Eliminar definitivamente", exact: true }).click();
    await page.waitForURL(/\/admin\/excursiones\?notice=/);
    expect(await prisma.excursion.count({ where: { id: excursionId } })).toBe(0);
    expect(await prisma.excursionDeparture.count({ where: { excursionId } })).toBe(0);
  });

  test("ADMIN accede y USER/DRIVER no pueden abrir formularios", async ({ page }) => {
    for (const role of ["ADMIN", "USER", "DRIVER"]) {
      await login(page, role);
      await page.goto("/admin/excursiones/nueva");
      if (role === "ADMIN") await expect(page.getByLabel("Nombre de la excursión")).toBeVisible();
      else {
        await expect(page).not.toHaveURL(/\/admin\/excursiones/);
        await expect(page.getByLabel("Nombre de la excursión")).toHaveCount(0);
      }
    }
  });
});

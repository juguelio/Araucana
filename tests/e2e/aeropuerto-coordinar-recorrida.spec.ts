import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";

/**
 * Coordinar el inicio de recorrida desde cada partida: el botón del vuelo abre un modal con ese vuelo
 * marcado, deja sumar otra partida de la misma camioneta y fija la hora en que los busca.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const email = `coordinar-${suffix}@example.com`;
const password = `Test-${suffix}-coord`;
const date = "2031-06-10";
const vuelos = { a: { id: `coord-a-${suffix}`, number: `AR${1000 + Math.floor(Math.random() * 4000)}` }, b: { id: `coord-b-${suffix}`, number: `AR${5000 + Math.floor(Math.random() * 4000)}` } };

test.beforeAll(async () => {
  await db.user.create({ data: { email, name: "Admin coordinar", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  await db.flight.createMany({ data: [
    { id: vuelos.a.id, number: vuelos.a.number, airline: "AR", origin: "AEP", destination: "AEP", direction: "DEPARTURE", source: "MANUAL", status: "SCHEDULED", scheduledAt: new Date(`${date}T15:15:00-03:00`) },
    { id: vuelos.b.id, number: vuelos.b.number, airline: "AR", origin: "AEP", destination: "AEP", direction: "DEPARTURE", source: "MANUAL", status: "SCHEDULED", scheduledAt: new Date(`${date}T16:30:00-03:00`) }
  ] });
});
test.afterAll(async () => { await db.$disconnect(); });

test("cada partida abre su modal, suma otra partida y fija la hora de la recorrida", async ({ page }) => {
  await db.rateLimitHit.deleteMany();
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
  await page.goto(`/admin/aeropuerto?date=${date}`);
  // Ya no hay una sección suelta para coordinar: está en cada vuelo.
  await expect(page.getByText("Coordinar inicio de recorrida")).toHaveCount(0);

  await page.locator(`#vuelo-${vuelos.a.id}`).getByRole("button", { name: `Coordinar recorrida del ${vuelos.a.number}` }).click();
  const modal = page.getByRole("dialog", { name: `Coordinar recorrida · ${vuelos.a.number}` });
  await expect(modal.getByRole("checkbox", { name: new RegExp(vuelos.a.number) })).toBeChecked();
  await expect(modal.getByRole("checkbox", { name: new RegExp(vuelos.b.number) })).not.toBeChecked();
  await modal.getByRole("checkbox", { name: new RegExp(vuelos.b.number) }).check();
  await modal.getByLabel("Hora en que los busca").fill(`${date}T12:10`);
  await page.screenshot({ path: "/tmp/araucana-coordinar-modal.png" });
  await modal.getByRole("button", { name: "Siguiente: naves y choferes" }).click();

  // Paso 2: se abre solo el modal de las combis de la recorrida, con «Listo» para cerrarlo.
  await expect(page.getByText("Recorrida coordinada. Ahora elegí las naves y los choferes.")).toBeVisible();
  const paso2 = page.getByRole("dialog", { name: `Combis de la recorrida ${vuelos.a.number} + ${vuelos.b.number}` });
  await expect(paso2).toContainText("Paso 2 de 2 · Naves y choferes");
  await page.screenshot({ path: "/tmp/araucana-coordinar-paso2.png" });
  await paso2.getByRole("link", { name: "Listo" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const guardados = await db.flight.findMany({ where: { id: { in: [vuelos.a.id, vuelos.b.id] } }, select: { pickupStartOverrideAt: true } });
  for (const vuelo of guardados) expect(vuelo.pickupStartOverrideAt?.toISOString()).toBe(new Date(`${date}T12:10:00-03:00`).toISOString());
  await expect(page.locator(`#vuelo-${vuelos.b.id}`)).toContainText(`Recorrida 12:10 con ${vuelos.a.number}`);
});

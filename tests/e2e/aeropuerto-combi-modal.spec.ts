import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";

/**
 * La combi de cada vuelo se asigna desde su etiqueta («sin combi asignada»): abre un modal con buscador
 * de naves. El menú «Gestionar vuelo» ya no existe y «Borrar vuelo» está dentro de Editar vuelo.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const email = `combi-${suffix}@example.com`;
const password = `Test-${suffix}-combi`;
const date = "2031-07-08";
const vuelo = { id: `combi-${suffix}`, number: `AR${1000 + Math.floor(Math.random() * 8999)}` };
const doble = { id: `doble-${suffix}`, number: `AR${1000 + Math.floor(Math.random() * 8999)}` };
const borrable = { id: `borrar-${suffix}`, number: `AR${1000 + Math.floor(Math.random() * 8999)}` };
const choferes = { ramon: `Ramón ${suffix}`, lucia: `Lucía ${suffix}` };
const naves = { buscada: { name: `Sprinter ${suffix}`, internal: `9${suffix.replace(/\D/g, "").slice(0, 3).padEnd(3, "7")}` }, otra: { name: `Master ${suffix}` } };

test.beforeAll(async () => {
  await db.user.createMany({ data: [
    { email: `ramon-${suffix}@example.com`, name: choferes.ramon, role: "DRIVER", isActive: true },
    { email: `lucia-${suffix}@example.com`, name: choferes.lucia, role: "DRIVER", isActive: true }
  ] });
  await db.user.create({ data: { email, name: "Admin combi", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  await db.flight.createMany({ data: [
    { id: vuelo.id, number: vuelo.number, airline: "AR", origin: "AEP", destination: "CPC", direction: "ARRIVAL", source: "MANUAL", status: "SCHEDULED", scheduledAt: new Date(`${date}T14:10:00-03:00`) },
    { id: doble.id, number: doble.number, airline: "AR", origin: "AEP", destination: "CPC", direction: "ARRIVAL", source: "MANUAL", status: "SCHEDULED", scheduledAt: new Date(`${date}T10:10:00-03:00`) },
    { id: borrable.id, number: borrable.number, airline: "AR", origin: "AEP", destination: "CPC", direction: "ARRIVAL", source: "MANUAL", status: "SCHEDULED", scheduledAt: new Date(`${date}T18:10:00-03:00`) }
  ] });
  const asientos = (n: number) => ({ create: Array.from({ length: n }, (_, i) => ({ number: String(i + 1), row: i + 1, column: 1 })) });
  await db.vehicle.create({ data: { name: naves.buscada.name, internalNumber: naves.buscada.internal, seats: asientos(19) } });
  await db.vehicle.create({ data: { name: naves.otra.name, seats: asientos(19) } });
});
test.afterAll(async () => { await db.$disconnect(); });

test.beforeEach(async ({ page }) => {
  await db.rateLimitHit.deleteMany();
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
});

test("«sin combi asignada» abre el modal, busca la nave y la asigna; después se quita desde el mismo modal", async ({ page }) => {
  await page.goto(`/admin/aeropuerto?date=${date}`);
  const tarjeta = page.locator(`#vuelo-${vuelo.id}`);
  await expect(page.getByText("Gestionar vuelo")).toHaveCount(0);

  await tarjeta.getByRole("button", { name: `Asignar combi al ${vuelo.number}` }).click();
  const modal = page.getByRole("dialog", { name: `Combi del ${vuelo.number}` });
  await modal.getByLabel(`Buscar nave para ${vuelo.number}`).fill(naves.buscada.internal);
  await expect(modal.getByRole("radio")).toHaveCount(1);
  await expect(modal).toContainText("15 lugares para aeropuerto");
  await modal.getByRole("radio", { name: new RegExp(naves.buscada.name) }).check();
  await modal.getByLabel(`Chofer para ${vuelo.number}`).selectOption({ label: choferes.ramon });
  await page.screenshot({ path: "/tmp/araucana-combi-modal.png" });
  await modal.getByRole("button", { name: "Asignar nave" }).click();

  await expect(page.getByText("Combi asignada al vuelo.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const boton = tarjeta.getByRole("button", { name: `Cambiar combi del ${vuelo.number}` });
  await expect(boton).toContainText(`${naves.buscada.name} (15) · ${choferes.ramon}`);
  const asignacion = await db.airportVehicleAssignment.findMany({ where: { flightId: vuelo.id }, include: { driver: true } });
  expect(asignacion.map((a) => a.driver?.name)).toEqual([choferes.ramon]);

  // El chofer de la combi ya asignada se cambia desde el mismo modal.
  await boton.click();
  const abierto = page.getByRole("dialog", { name: `Combi del ${vuelo.number}` });
  await abierto.getByLabel(`Chofer de ${naves.buscada.name}`).selectOption({ label: choferes.lucia });
  await abierto.getByRole("button", { name: "Guardar chofer" }).click();
  await expect(page.getByText("Chofer asignado a la combi.")).toBeVisible();
  await expect(boton).toContainText(`${naves.buscada.name} (15) · ${choferes.lucia}`);
  expect((await db.airportVehicleAssignment.findFirst({ where: { flightId: vuelo.id }, include: { driver: true } }))?.driver?.name).toBe(choferes.lucia);

  await tarjeta.getByRole("button", { name: `Cambiar combi del ${vuelo.number}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Quitar" }).click();
  await expect(page.getByText("Combi quitada del vuelo.")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`date=${date}`));
  expect(await db.airportVehicleAssignment.count({ where: { flightId: vuelo.id } })).toBe(0);
});

test("el mismo chofer en dos combis del vuelo avisa y sólo se guarda al confirmar", async ({ page }) => {
  await page.goto(`/admin/aeropuerto?date=${date}`);
  const tarjeta = page.locator(`#vuelo-${doble.id}`);
  const modal = page.getByRole("dialog", { name: `Combi del ${doble.number}` });

  await tarjeta.getByRole("button", { name: `Asignar combi al ${doble.number}` }).click();
  await modal.getByRole("radio", { name: new RegExp(naves.buscada.name) }).check();
  await modal.getByLabel(`Chofer para ${doble.number}`).selectOption({ label: choferes.ramon });
  await modal.getByRole("button", { name: "Asignar nave" }).click();
  await expect(page.getByText("Combi asignada al vuelo.")).toBeVisible();

  await tarjeta.getByRole("button", { name: `Cambiar combi del ${doble.number}` }).click();
  await modal.getByRole("radio", { name: new RegExp(naves.otra.name) }).check();
  await modal.getByLabel(`Chofer para ${doble.number}`).selectOption({ label: choferes.ramon });
  await modal.getByRole("button", { name: "Sumar nave" }).click();
  await expect(modal.getByText("Revisá la ocupación del chofer.")).toBeVisible();
  await expect(modal.getByRole("link", { name: `Posible cruce · Chofer · Aeropuerto · ${doble.number}` })).toBeVisible();
  await page.screenshot({ path: "/tmp/araucana-combi-chofer-aviso.png" });
  expect(await db.airportVehicleAssignment.count({ where: { flightId: doble.id } })).toBe(1);

  await modal.getByRole("button", { name: "Confirmar y guardar con estos avisos" }).click();
  // El aviso «Combi asignada» de la primera combi sigue en la URL: se espera a la base.
  await expect.poll(() => db.airportVehicleAssignment.count({ where: { flightId: doble.id } })).toBe(2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tarjeta.getByRole("button", { name: `Cambiar combi del ${doble.number}` })).toContainText(`${naves.otra.name} (15) · ${choferes.ramon}`);
  const asignadas = await db.airportVehicleAssignment.findMany({ where: { flightId: doble.id }, include: { driver: true } });
  expect(asignadas.map((a) => a.driver?.name)).toEqual([choferes.ramon, choferes.ramon]);
  expect(await db.fleetConflictAcceptance.count({ where: { service: "AIRPORT", serviceId: { in: asignadas.map((a) => a.id) } } })).toBe(1);
});

test("Borrar vuelo está dentro de Editar vuelo", async ({ page }) => {
  await page.goto(`/admin/aeropuerto/${borrable.id}/editar`);
  const seccion = page.getByRole("region", { name: "Borrar vuelo" });
  page.once("dialog", (dialog) => dialog.accept());
  await seccion.getByRole("button", { name: "Borrar vuelo" }).click();
  await expect(page.getByText("Vuelo borrado.")).toBeVisible();
  expect(await db.flight.findUnique({ where: { id: borrable.id } })).toBeNull();
});

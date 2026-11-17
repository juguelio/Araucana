import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";
import { createReservationShortCode } from "../../src/lib/booking/codes";

/**
 * Orden de servicio por nave: un vuelo con dos naves da dos órdenes, cada una con su imprimir, su
 * Excel y su link para el chofer, y la recorrida se ordena desde la misma pantalla.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const email = `orden-${suffix}@example.com`;
const password = `Test-${suffix}-orden`;
const day = "2031-03-14";
const naves = { a: { name: `Sprinter ${suffix}`, id: "", assignment: "" }, b: { name: `Master ${suffix}`, id: "", assignment: "" } };
// Del aeropuerto hacia el centro: Ana queda más cerca que Beto, y Beto más que Ceci.
const pasajeros = {
  ana: { firstName: "Ana", seats: 3, lat: -40.08, lng: -71.15, code: "" },
  beto: { firstName: "Beto", seats: 2, lat: -40.12, lng: -71.3, code: "" },
  ceci: { firstName: "Ceci", seats: 2, lat: -40.157, lng: -71.353, code: "" }
};
let flightId = "";

test.beforeAll(async () => {
  await db.user.create({ data: { email, name: "Admin orden", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  const flight = await db.flight.create({ data: {
    number: `AR${1000 + Math.floor(Math.random() * 8999)}`, origin: "Aeroparque", direction: "DEPARTURE",
    scheduledAt: new Date(`${day}T15:15:00-03:00`), source: "MANUAL"
  } });
  flightId = flight.id;
  for (const nave of Object.values(naves)) {
    const vehicle = await db.vehicle.create({ data: { name: nave.name, seats: { create: Array.from({ length: 4 }, (_, i) => ({ number: String(i + 1), row: i + 1, column: 1 })) } } });
    nave.id = vehicle.id;
    nave.assignment = (await db.airportVehicleAssignment.create({ data: { flightId, vehicleId: vehicle.id } })).id;
  }
  for (const pasajero of Object.values(pasajeros)) {
    pasajero.code = `ARA-2603-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    await db.reservation.create({ data: {
      code: pasajero.code, shortCode: createReservationShortCode(), bookingMode: "AIRPORT", status: "CONFIRMED",
      passengerCount: pasajero.seats, totalCents: pasajero.seats * 1000000, currency: "ARS",
      passenger: { create: { firstName: pasajero.firstName, lastName: suffix, email: "orden@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "30111222" } },
      airportDetails: { create: {
        flightId, flightNumber: flight.number, direction: "DEPARTURE", serviceDate: new Date(`${day}T12:00:00-03:00`),
        pickupName: `Hotel ${pasajero.firstName}`, pickupLatitude: pasajero.lat, pickupLongitude: pasajero.lng
      } }
    } });
  }
});
test.afterAll(async () => { await db.$disconnect(); });

test.beforeEach(async ({ page }) => {
  await db.rateLimitHit.deleteMany();
  await db.airportReservationDetails.updateMany({ where: { flightId }, data: { routePosition: null, assignmentId: null } });
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
});

const orden = (page: Page, nave: string) => page.locator("section.orden-bloque").filter({ has: page.getByRole("heading", { name: new RegExp(nave) }) });
const nombres = async (page: Page, nave: string) =>
  (await orden(page, nave).locator("tbody tr[data-codigo] td:first-child").allInnerTexts()).map((texto) => texto.replace(/^\W*\d+\.\s*/, "").split(" ")[0]);

async function abrir(page: Page) {
  await page.goto(`/admin/aeropuerto/orden-de-servicio/ver?date=${day}&flight=${flightId}`);
  await expect(page.locator("section.orden-bloque")).toHaveCount(2);
}

test("un vuelo con dos naves da una orden por nave, repartida por capacidad en el orden de la recorrida", async ({ page }) => {
  await abrir(page);
  expect(await nombres(page, naves.a.name)).toEqual(["Ana"]);
  expect(await nombres(page, naves.b.name)).toEqual(["Beto", "Ceci"]);
  await expect(orden(page, naves.b.name).locator("tfoot")).toContainText(`Total OUT`);
  await expect(orden(page, naves.b.name).locator("tfoot")).toContainText(naves.b.name);

  for (const nave of [naves.a.name, naves.b.name]) {
    const bloque = orden(page, nave);
    await expect(bloque.getByRole("button", { name: "Imprimir" })).toBeVisible();
    await expect(bloque.getByRole("link", { name: "Descargar Excel" })).toBeVisible();
    await expect(bloque.getByRole("button", { name: "Copiar link" })).toBeVisible();
  }
  // Las opciones ya no están arriba para todo el día.
  await expect(page.locator(".orden-link-chofer")).toHaveCount(0);

  const excel = await orden(page, naves.b.name).getByRole("link", { name: "Descargar Excel" }).getAttribute("href");
  expect(excel).toContain(`vehicle=${naves.b.assignment}`);
  const respuesta = await page.request.get(excel!);
  expect(respuesta.status()).toBe(200);
  expect(respuesta.headers()["content-disposition"]).toContain(`master-${suffix.toLowerCase()}`);
  await page.screenshot({ path: "/tmp/araucana-orden-por-nave.png", fullPage: true });
});

test("las flechas reordenan la recorrida y queda guardada para el chofer", async ({ page }) => {
  await abrir(page);
  await orden(page, naves.b.name).getByRole("button", { name: `Bajar Beto ${suffix}` }).click();
  await expect(orden(page, naves.b.name).getByText("Recorrida guardada.")).toBeVisible();
  const guardado = await db.airportReservationDetails.findMany({ where: { flightId, assignmentId: naves.b.assignment }, orderBy: { routePosition: "asc" }, include: { reservation: { select: { code: true } } } });
  expect(guardado.map((detalle) => detalle.reservation.code)).toEqual([pasajeros.ceci.code, pasajeros.beto.code]);

  await page.reload();
  expect(await nombres(page, naves.b.name)).toEqual(["Ceci", "Beto"]);
  await expect(orden(page, naves.b.name).getByRole("button", { name: "Orden sugerido" })).toBeVisible();
  await orden(page, naves.b.name).getByRole("button", { name: "Orden sugerido" }).click();
  await expect.poll(() => nombres(page, naves.b.name)).toEqual(["Beto", "Ceci"]);
});

test("arrastrar una fila cambia el orden, y soltarla en la otra nave la pasa a esa nave", async ({ page }) => {
  await abrir(page);
  const b = orden(page, naves.b.name);
  await b.locator(`tr[data-codigo="${pasajeros.ceci.code}"]`).dragTo(b.locator(`tr[data-codigo="${pasajeros.beto.code}"]`), { targetPosition: { x: 20, y: 4 } });
  await expect.poll(() => nombres(page, naves.b.name)).toEqual(["Ceci", "Beto"]);

  const a = orden(page, naves.a.name);
  await b.locator(`tr[data-codigo="${pasajeros.beto.code}"]`).dragTo(a.locator(`tr[data-codigo="${pasajeros.ana.code}"]`), { targetPosition: { x: 20, y: 4 } });
  await expect.poll(() => nombres(page, naves.a.name)).toEqual(["Beto", "Ana"]);
  await expect.poll(() => nombres(page, naves.b.name)).toEqual(["Ceci"]);
  const beto = await db.airportReservationDetails.findFirstOrThrow({ where: { reservation: { code: pasajeros.beto.code } } });
  expect(beto.assignmentId).toBe(naves.a.assignment);
});

test("«Nave» pasa al pasajero al final de la otra nave", async ({ page }) => {
  await abrir(page);
  await orden(page, naves.a.name).getByLabel(`Nave de Ana ${suffix}`).selectOption(naves.b.assignment);
  await expect.poll(() => nombres(page, naves.b.name)).toEqual(["Beto", "Ceci", "Ana"]);
  // La nave que quedó vacía sigue en pantalla para poder volver a soltar gente.
  await expect(orden(page, naves.a.name)).toContainText("Sin pasajeros en esta nave");
});

test("el link copiado abre sólo la orden de esa nave, sin usuario", async ({ page, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await abrir(page);
  await orden(page, naves.a.name).getByRole("button", { name: "Copiar link" }).click();
  await expect(orden(page, naves.a.name).getByRole("button", { name: "Link copiado" })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/orden\//);

  const anonimo = await browser.newContext();
  const chofer = await anonimo.newPage();
  await chofer.goto(link);
  await expect(chofer.locator("section.orden-bloque")).toHaveCount(1);
  await expect(chofer.locator("section.orden-bloque")).toContainText(`Ana ${suffix}`);
  await expect(chofer.locator("section.orden-bloque")).not.toContainText(`Beto ${suffix}`);
  await anonimo.close();
});

test("Imprimir de una orden deja sólo esa orden en el papel", async ({ page }) => {
  await page.addInitScript(() => { window.print = () => undefined; });
  await abrir(page);
  await orden(page, naves.b.name).getByRole("button", { name: "Imprimir" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(orden(page, naves.b.name)).toBeVisible();
  await expect(orden(page, naves.a.name)).toBeHidden();
  await expect(page.locator(".orden-cabecera")).toBeVisible();
});

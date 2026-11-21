import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
import { createReservationCode, createReservationShortCode } from "../../src/lib/booking/codes";

/**
 * En Aeropuerto, «Hoja del chofer» abre un modal donde se eligen las órdenes del día —una por vuelo, o
 * una por combi en las recorridas que salen con varias— y las abre juntas, con el diálogo de impresión,
 * con una página de impresión por orden.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const email = `hoja-${suffix}@example.com`;
const password = `Test-${suffix}-hoja`;
const day = "2031-04-09";
const vuelos: Array<{ id: string; number: string; hour: string }> = [
  { id: "", number: `AR${1000 + Math.floor(Math.random() * 3000)}`, hour: "09:10" },
  { id: "", number: `AR${4000 + Math.floor(Math.random() * 3000)}`, hour: "13:40" },
  { id: "", number: `AR${7000 + Math.floor(Math.random() * 2999)}`, hour: "18:20" }
];

test.beforeAll(async () => {
  await db.user.create({ data: { email, name: "Admin hoja", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  const vehicle = await db.vehicle.create({ data: { name: `Sprinter ${suffix}`, seats: { create: Array.from({ length: 19 }, (_, i) => ({ number: String(i + 1), row: i + 1, column: 1 })) } } });
  for (const vuelo of vuelos) {
    const flight = await db.flight.create({ data: {
      number: vuelo.number, airline: "AR", origin: "Aeroparque", direction: "DEPARTURE", source: "MANUAL", status: "SCHEDULED",
      scheduledAt: new Date(`${day}T${vuelo.hour}:00-03:00`)
    } });
    vuelo.id = flight.id;
    await db.airportVehicleAssignment.create({ data: { flightId: flight.id, vehicleId: vehicle.id } });
    for (const nombre of ["Ana", "Beto", "Ceci"]) {
      await db.reservation.create({ data: {
        code: `ARA-2604-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`, shortCode: createReservationShortCode(),
        bookingMode: "AIRPORT", status: "CONFIRMED", passengerCount: 2, totalCents: 2000000, currency: "ARS",
        passenger: { create: { firstName: nombre, lastName: `${vuelo.number} ${suffix}`, email: "hoja@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "30111222" } },
        airportDetails: { create: {
          flightId: flight.id, flightNumber: flight.number, direction: "DEPARTURE", serviceDate: new Date(`${day}T12:00:00-03:00`),
          pickupName: `Hotel ${nombre}`, pickupLatitude: -40.15, pickupLongitude: -71.35
        } }
      } });
    }
  }
});
// Dos partidas llenas que se coordinan juntas, cada una con su trafic, y gente de dos zonas en cada vuelo.
const recorrida: Array<{ id: string; number: string; hour: string; nave: string }> = [
  { id: "", number: `JA${1000 + Math.floor(Math.random() * 4000)}`, hour: "21:00", nave: `Trafic Centro ${suffix}` },
  { id: "", number: `JA${5000 + Math.floor(Math.random() * 4999)}`, hour: "21:20", nave: `Trafic Lago ${suffix}` }
];

test.beforeAll(async () => {
  const grupo = `grupo-${suffix}`;
  for (const [indice, vuelo] of recorrida.entries()) {
    const nave = await db.vehicle.create({ data: { name: vuelo.nave, seats: { create: Array.from({ length: 12 }, (_, i) => ({ number: String(i + 1), row: i + 1, column: 1 })) } } });
    const flight = await db.flight.create({ data: {
      number: vuelo.number, airline: "JA", origin: "Aeroparque", direction: "DEPARTURE", source: "MANUAL", status: "SCHEDULED",
      scheduledAt: new Date(`${day}T${vuelo.hour}:00-03:00`), pickupGroupId: grupo
    } });
    vuelo.id = flight.id;
    await db.airportVehicleAssignment.create({ data: { flightId: flight.id, vehicleId: nave.id } });
    // 8 lugares por vuelo: 16 en total no entran en una trafic de 8 (12 butacas menos 4 de equipaje).
    for (const [n, [latitude, longitude]] of [[-40.157, -71.353], [-40.158, -71.352], [-40.18, -71.45], [-40.181, -71.449]].entries()) {
      await db.reservation.create({ data: {
        code: createReservationCode(), shortCode: createReservationShortCode(),
        bookingMode: "AIRPORT", status: "CONFIRMED", passengerCount: 2, totalCents: 2000000, currency: "ARS",
        passenger: { create: { firstName: `P${indice}${n}`, lastName: suffix, email: "hoja@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "30111222" } },
        airportDetails: { create: {
          flightId: flight.id, flightNumber: flight.number, direction: "DEPARTURE", serviceDate: new Date(`${day}T12:00:00-03:00`),
          pickupName: `Hotel ${n}`, pickupLatitude: latitude, pickupLongitude: longitude
        } }
      } });
    }
  }
});
// Un arribo de la noche, sin combi: es el IN que después hace una de las trafics de la recorrida.
const arribo = { id: "", number: `AR${2000 + Math.floor(Math.random() * 6000)}`, hour: "22:40" };

test.beforeAll(async () => {
  const flight = await db.flight.create({ data: {
    number: arribo.number, airline: "AR", origin: "Aeroparque", direction: "ARRIVAL", source: "MANUAL", status: "SCHEDULED",
    scheduledAt: new Date(`${day}T${arribo.hour}:00-03:00`)
  } });
  arribo.id = flight.id;
  await db.reservation.create({ data: {
    code: `ARA-2604-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`, shortCode: createReservationShortCode(),
    bookingMode: "AIRPORT", status: "CONFIRMED", passengerCount: 3, totalCents: 3000000, currency: "ARS",
    passenger: { create: { firstName: "Ivo", lastName: suffix, email: "hoja@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "30111222" } },
    airportDetails: { create: {
      flightId: flight.id, flightNumber: flight.number, direction: "ARRIVAL", serviceDate: new Date(`${day}T12:00:00-03:00`),
      pickupName: "Hotel Ivo", pickupLatitude: -40.157, pickupLongitude: -71.353
    } }
  } });
});
test.afterAll(async () => { await db.$disconnect(); });

test.beforeEach(async ({ page }) => {
  await db.rateLimitHit.deleteMany();
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
});

test("«Hoja del chofer» abre un modal para elegir los vuelos y abre sus órdenes juntas e imprime", async ({ page, context }) => {
  await page.goto(`/admin/aeropuerto?date=${day}`);
  const [, , c] = vuelos.map((vuelo) => page.locator(`#vuelo-${vuelo.id}`));
  // Ya no hay casilla «Juntar» en las tarjetas.
  await expect(page.getByLabel(/para la hoja del chofer/)).toHaveCount(0);

  await c.getByRole("button", { name: `Hoja del chofer del ${vuelos[2].number}` }).click();
  const modal = page.getByRole("dialog", { name: `Hoja del chofer · ${vuelos[2].number}` });
  // Viene marcado sólo el vuelo propio: la hoja es la de ese vuelo.
  await expect(modal.getByRole("checkbox", { name: new RegExp(vuelos[2].number) })).toBeChecked();
  await expect(modal.getByRole("checkbox", { name: new RegExp(vuelos[0].number) })).not.toBeChecked();
  await expect(modal.getByRole("link", { name: "Abrir hoja del chofer" })).toHaveAttribute("href", `/admin/aeropuerto/orden-de-servicio/ver?date=${day}&flight=${vuelos[2].id}`);

  await modal.getByRole("checkbox", { name: new RegExp(vuelos[0].number) }).check();
  // En el orden del día, no en el que se marcaron.
  const juntos = `/admin/aeropuerto/orden-de-servicio/ver?date=${day}&ordenes=${vuelos[0].id}%7E%2C${vuelos[2].id}%7E&imprimir=1`;
  await expect(modal.getByRole("link", { name: "Abrir hoja del chofer (2 órdenes)" })).toHaveAttribute("href", juntos);
  await page.screenshot({ path: "/tmp/araucana-hoja-marcar.png" });

  await context.addInitScript(() => {
    (window as unknown as { impresiones: number }).impresiones = 0;
    window.print = () => { (window as unknown as { impresiones: number }).impresiones += 1; };
  });
  const [hoja] = await Promise.all([context.waitForEvent("page"), modal.getByRole("link", { name: "Abrir hoja del chofer (2 órdenes)" }).click()]);
  await hoja.waitForLoadState();
  await expect(hoja.locator("section.orden-bloque")).toHaveCount(2);
  await expect(hoja.locator("section.orden-bloque").nth(0)).toContainText(vuelos[0].number);
  await expect(hoja.locator("section.orden-bloque").nth(1)).toContainText(vuelos[2].number);
  await expect(hoja.locator("section.orden-bloque")).not.toContainText([vuelos[1].number]);
  // El diálogo de impresión se abre solo, una vez.
  await expect.poll(() => hoja.evaluate(() => (window as unknown as { impresiones: number }).impresiones)).toBe(1);
  await expect(hoja.getByRole("button", { name: "Imprimir las 2 órdenes" })).toBeVisible();

  // En papel (A4 apaisado) cada orden lleva su propia cabecera en una sola hoja.
  await hoja.emulateMedia({ media: "print" });
  await expect(hoja.locator(".orden-bloque > .orden-cabecera:visible")).toHaveCount(2);
  await expect(hoja.locator(".orden-total")).toBeHidden();
  await expect(hoja.locator(".orden-pie")).toBeHidden();
  await hoja.screenshot({ path: "/tmp/araucana-hoja-impresion.png", fullPage: true });
  const pdf = await hoja.pdf({ preferCSSPageSize: true, printBackground: true });
  const paginas = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(paginas).toBe(2);

  await hoja.emulateMedia({ media: "screen" });
  await hoja.locator("section.orden-bloque").nth(1).getByRole("button", { name: "Imprimir", exact: true }).click();
  await hoja.emulateMedia({ media: "print" });
  await expect(hoja.locator("section.orden-bloque:visible")).toHaveCount(1);
  const pdfIndividual = await hoja.pdf({ preferCSSPageSize: true, printBackground: true });
  expect((pdfIndividual.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
});

test("en una recorrida con dos trafics, la hoja del chofer se elige por combi", async ({ page }) => {
  const [primero, segundo] = recorrida;
  await page.goto(`/admin/aeropuerto?date=${day}`);
  await page.locator(`#vuelo-${segundo.id}`).getByRole("button", { name: `Hoja del chofer del ${segundo.number}` }).click();
  const modal = page.getByRole("dialog", { name: `Hoja del chofer · ${segundo.number}` });
  // Una orden por trafic, cada una con los dos vuelos y 8 pasajeros, las dos marcadas.
  const centro = modal.getByRole("checkbox", { name: new RegExp(`Trafic Centro ${suffix}`) });
  const lago = modal.getByRole("checkbox", { name: new RegExp(`Trafic Lago ${suffix}`) });
  await expect(centro).toBeChecked();
  await expect(lago).toBeChecked();
  for (const fila of [centro, lago]) await expect(fila).toHaveAccessibleName(new RegExp(`${primero.number} \\+ ${segundo.number}.* 8 pasajeros`));
  await page.screenshot({ path: "/tmp/araucana-hoja-por-combi.png" });

  // Sólo la del lago: abre la orden de esa trafic, con gente de los dos vuelos.
  await centro.uncheck();
  const href = await modal.getByRole("link", { name: "Abrir hoja del chofer" }).getAttribute("href");
  expect(href).toContain("&vehicle=");
  await page.goto(href!);
  await expect(page.locator("section.orden-bloque")).toHaveCount(1);
  const orden = page.locator("section.orden-bloque");
  await expect(orden).toContainText(`Trafic Lago ${suffix}`);
  await expect(orden).toContainText(primero.number);
  await expect(orden).toContainText(segundo.number);
});

test("«Por chofer» muestra el día de cada trafic, le suma el IN y abre su hoja IN/OUT", async ({ page, context }) => {
  await page.goto(`/admin/aeropuerto?date=${day}`);
  const seccion = page.locator("#por-chofer");
  const lago = seccion.locator("li.aero-jornada").filter({ hasText: `Trafic Lago ${suffix}` });
  await expect(lago).toContainText(`OUT`);
  await expect(lago).toContainText(`${recorrida[0].number} + ${recorrida[1].number}`);
  await expect(lago).toContainText("sin IN después");

  await lago.getByLabel(`IN para Trafic Lago ${suffix}`).selectOption(arribo.id);
  await lago.getByRole("button", { name: "Asignar IN" }).click();
  await expect(page.getByText("Combi asignada al vuelo.")).toBeVisible();
  const lagoDespues = page.locator("#por-chofer li.aero-jornada").filter({ hasText: `Trafic Lago ${suffix}` });
  await expect(lagoDespues).toContainText(`IN 22:40 · ${arribo.number} · 3 pasajeros`);
  await expect(lagoDespues).not.toContainText("sin IN después");
  await page.locator("#por-chofer").screenshot({ path: "/tmp/araucana-por-chofer.png" });

  await context.addInitScript(() => { window.print = () => {}; });
  const [hoja] = await Promise.all([context.waitForEvent("page"), lagoDespues.getByRole("link", { name: "Hoja IN/OUT" }).click()]);
  await hoja.waitForLoadState();
  // La orden OUT de esa trafic (con gente de los dos vuelos) y después su IN.
  await expect(hoja.locator("section.orden-bloque")).toHaveCount(2);
  await expect(hoja.locator("section.orden-bloque").nth(0)).toContainText(`Trafic Lago ${suffix}`);
  await expect(hoja.locator("section.orden-bloque").nth(0)).toContainText(recorrida[0].number);
  await expect(hoja.locator("section.orden-bloque").nth(1)).toContainText(`Ivo ${suffix}`);
  await expect(hoja.locator("section.orden-bloque").nth(0).locator(".orden-pasajeros > span"))
    .toHaveText(["Pasajeros IN 0", "Pasajeros OUT 8"]);
  await expect(hoja.locator("section.orden-bloque").nth(1).locator(".orden-pasajeros > span"))
    .toHaveText(["Pasajeros IN 3", "Pasajeros OUT 0"]);
  await hoja.emulateMedia({ media: "print" });
  await expect(hoja.locator(".orden-bloque > .orden-cabecera:visible")).toHaveCount(1);
  const pdf = await hoja.pdf({ preferCSSPageSize: true });
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  await hoja.close();
});

test("con las dos órdenes de la recorrida abiertas, arrastrar un pasajero de una a otra lo cambia de trafic", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2000 });
  await page.goto(`/admin/aeropuerto?date=${day}`);
  await page.locator(`#vuelo-${recorrida[1].id}`).getByRole("button", { name: `Hoja del chofer del ${recorrida[1].number}` }).click();
  const modal = page.getByRole("dialog", { name: `Hoja del chofer · ${recorrida[1].number}` });
  const href = await modal.getByRole("link", { name: "Abrir hoja del chofer (2 órdenes)" }).getAttribute("href");
  await page.goto(href!.replace("&imprimir=1", ""));
  await expect(page.locator("section.orden-bloque")).toHaveCount(2);
  // Por el título de cada orden: el selector «Nave» de cada fila nombra las dos trafics.
  const deLaTrafic = (nombre: string) => page.locator("section.orden-bloque").filter({ has: page.getByRole("heading", { name: new RegExp(nombre) }) });
  const centro = deLaTrafic(`Trafic Centro ${suffix}`);
  const lago = deLaTrafic(`Trafic Lago ${suffix}`);
  const filasDe = (bloque: typeof centro) => bloque.locator("tbody tr[data-codigo]");
  const enCentro = await filasDe(centro).count();
  const enLago = await filasDe(lago).count();
  // Con códigos de reserva reales (41 caracteres): antes el guardado los rechazaba con
  // «No se pudo leer el orden de la recorrida».
  const fila = filasDe(centro).first();
  const codigo = await fila.getAttribute("data-codigo");
  expect(codigo).toHaveLength(41);
  await fila.dragTo(filasDe(lago).first(), { targetPosition: { x: 20, y: 4 } });
  await expect.poll(() => filasDe(lago).count()).toBe(enLago + 1);
  await expect.poll(() => filasDe(centro).count()).toBe(enCentro - 1);
  await expect(filasDe(lago).first()).toHaveAttribute("data-codigo", codigo!);
  await expect(page.getByText("No se pudo leer el orden de la recorrida.")).toHaveCount(0);
  await page.reload();
  await expect(lago.locator(`tr[data-codigo="${codigo}"]`)).toHaveCount(1);
  await expect(centro.locator(`tr[data-codigo="${codigo}"]`)).toHaveCount(0);
});

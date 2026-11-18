import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
import { createReservationShortCode } from "../../src/lib/booking/codes";

/**
 * En Aeropuerto se marcan varios vuelos y «Hoja del chofer» de cualquiera de ellos abre las órdenes
 * de todos juntas, con el diálogo de impresión, para imprimirlas en las menos hojas posibles.
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
test.afterAll(async () => { await db.$disconnect(); });

test.beforeEach(async ({ page }) => {
  await db.rateLimitHit.deleteMany();
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
});

test("marcando dos vuelos, «Hoja del chofer» abre las dos órdenes juntas e imprime", async ({ page, context }) => {
  await page.goto(`/admin/aeropuerto?date=${day}`);
  const [a, b, c] = vuelos.map((vuelo) => page.locator(`#vuelo-${vuelo.id}`));
  // Sin marcar, cada hoja es la de su vuelo.
  await expect(a.getByRole("link", { name: "Hoja del chofer" })).toHaveAttribute("href", `/admin/aeropuerto/orden-de-servicio/ver?date=${day}&flight=${vuelos[0].id}`);

  await a.getByLabel(`Seleccionar ${vuelos[0].number} para la hoja del chofer`).check();
  // Con uno solo marcado no cambia nada.
  await expect(a.getByRole("link", { name: "Hoja del chofer" })).toHaveAttribute("href", /flight=/);
  await c.getByLabel(`Seleccionar ${vuelos[2].number} para la hoja del chofer`).check();

  const juntos = `/admin/aeropuerto/orden-de-servicio/ver?date=${day}&flights=${vuelos[0].id}%2C${vuelos[2].id}&imprimir=1`;
  await expect(a.getByRole("link", { name: "Hoja del chofer (2 vuelos)" })).toHaveAttribute("href", juntos);
  await expect(c.getByRole("link", { name: "Hoja del chofer (2 vuelos)" })).toHaveAttribute("href", juntos);
  // Un vuelo no marcado sigue abriendo sólo su hoja.
  await expect(b.getByRole("link", { name: "Hoja del chofer" })).toHaveAttribute("href", /flight=/);
  await page.screenshot({ path: "/tmp/araucana-hoja-marcar.png" });

  await context.addInitScript(() => {
    (window as unknown as { impresiones: number }).impresiones = 0;
    window.print = () => { (window as unknown as { impresiones: number }).impresiones += 1; };
  });
  const [hoja] = await Promise.all([context.waitForEvent("page"), c.getByRole("link", { name: "Hoja del chofer (2 vuelos)" }).click()]);
  await hoja.waitForLoadState();
  await expect(hoja.locator("section.orden-bloque")).toHaveCount(2);
  await expect(hoja.locator("section.orden-bloque").nth(0)).toContainText(vuelos[0].number);
  await expect(hoja.locator("section.orden-bloque").nth(1)).toContainText(vuelos[2].number);
  await expect(hoja.locator("section.orden-bloque")).not.toContainText([vuelos[1].number]);
  // El diálogo de impresión se abre solo, una vez.
  await expect.poll(() => hoja.evaluate(() => (window as unknown as { impresiones: number }).impresiones)).toBe(1);
  await expect(hoja.getByRole("button", { name: "Imprimir las 2 órdenes" })).toBeVisible();

  // En papel (A4 apaisado) las dos órdenes de tres pasajeros entran en una sola hoja.
  await hoja.emulateMedia({ media: "print" });
  await hoja.screenshot({ path: "/tmp/araucana-hoja-impresion.png", fullPage: true });
  const pdf = await hoja.pdf({ preferCSSPageSize: true, printBackground: true });
  const paginas = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(paginas).toBe(1);
});

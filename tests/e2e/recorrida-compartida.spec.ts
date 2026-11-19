import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { createReservationShortCode } from "../../src/lib/booking/codes";

/**
 * Una sola camioneta para varios vuelos: al coordinar dos partidas juntas (o juntar dos arribos), la
 * hoja del chofer de cualquiera de ellos trae una sola orden con los pasajeros de todos, cada uno con
 * su vuelo, para que el chofer sepa por dónde buscarlos. Igual en el Excel y en el link del chofer.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const email = `vuelta-${suffix}@example.com`;
const password = `Test-${suffix}-vuelta`;
const day = "2031-05-21";
const n = () => String(1000 + Math.floor(Math.random() * 8999));
const partidas = [
  { id: "", number: `AR${n()}`, hour: "14:00", pasajeros: ["Ana", "Beto"] },
  { id: "", number: `JA${n()}`, hour: "14:40", pasajeros: ["Ceci", "Dani"] }
];
const arribos = [
  { id: "", number: `AR${n()}`, hour: "19:10", pasajeros: ["Eva"] },
  { id: "", number: `JA${n()}`, hour: "19:35", pasajeros: ["Fede", "Gabi"] }
];

// Dos partidas coordinadas juntas pero con naves distintas: no se unen y cada hoja trae sólo su vuelo.
const separadas = [
  { id: "", number: `AR${n()}`, hour: "08:00", pasajeros: ["Hugo"] },
  { id: "", number: `JA${n()}`, hour: "08:30", pasajeros: ["Ines"] }
];

test.beforeAll(async () => {
  await db.user.create({ data: { email, name: "Admin vuelta", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  const trafic = await db.vehicle.create({ data: { name: `Trafic ${suffix}`, seats: { create: Array.from({ length: 19 }, (_, i) => ({ number: String(i + 1), row: i + 1, column: 1 })) } } });
  for (const [direction, vuelos] of [["DEPARTURE", partidas], ["ARRIVAL", arribos], ["DEPARTURE", separadas]] as const) {
    for (const vuelo of vuelos) {
      const flight = await db.flight.create({ data: {
        number: vuelo.number, airline: "AR", origin: "Aeroparque", direction, source: "MANUAL", status: "SCHEDULED",
        scheduledAt: new Date(`${day}T${vuelo.hour}:00-03:00`)
      } });
      vuelo.id = flight.id;
      // La misma trafic en los dos vuelos: es la que hace la vuelta. Las «separadas» llevan cada una la suya.
      const nave = vuelos === separadas
        ? await db.vehicle.create({ data: { name: `Master ${vuelo.number}`, seats: { create: Array.from({ length: 19 }, (_, i) => ({ number: String(i + 1), row: i + 1, column: 1 })) } } })
        : trafic;
      await db.airportVehicleAssignment.create({ data: { flightId: flight.id, vehicleId: nave.id } });
      for (const [i, nombre] of vuelo.pasajeros.entries()) {
        await db.reservation.create({ data: {
          code: `ARA-2605-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`, shortCode: createReservationShortCode(),
          bookingMode: "AIRPORT", status: "CONFIRMED", passengerCount: 1, totalCents: 1500000, currency: "ARS",
          passenger: { create: { firstName: nombre, lastName: suffix, email: "vuelta@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "30111222" } },
          airportDetails: { create: {
            flightId: flight.id, flightNumber: flight.number, direction, serviceDate: new Date(`${day}T12:00:00-03:00`),
            pickupName: `Hotel ${nombre}`, pickupLatitude: -40.1 - i * 0.02, pickupLongitude: -71.2 - i * 0.05
          } }
        } });
      }
    }
  }
});
test.afterAll(async () => { await db.$disconnect(); });

test.beforeEach(async ({ page }) => {
  await db.rateLimitHit.deleteMany();
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
});

const pasajerosDeLaOrden = (page: Page) =>
  page.locator("section.orden-bloque tbody tr td:first-child").allInnerTexts().then((textos) => textos.map((texto) => texto.replace(/^\W*\d+\.\s*/, "").trim()));

async function filasDelExcel(page: Page, href: string) {
  const respuesta = await page.request.get(href);
  expect(respuesta.status()).toBe(200);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load((await respuesta.body()) as unknown as ArrayBuffer);
  const textos: string[] = [];
  libro.worksheets[0].eachRow((fila) => textos.push(fila.values.toString()));
  return textos.join("\n");
}

test("dos partidas coordinadas juntas salen en una sola orden, desde la hoja de cualquiera", async ({ page, context, browser }) => {
  const [ar, ja] = partidas;
  await page.goto(`/admin/aeropuerto?date=${day}`);
  await page.locator(`#vuelo-${ar.id}`).getByRole("button", { name: `Coordinar recorrida del ${ar.number}` }).click();
  const modal = page.getByRole("dialog", { name: `Coordinar recorrida · ${ar.number}` });
  await modal.locator(`input[name="flightId"][value="${ja.id}"]`).check();
  await modal.getByLabel("Hora en que los busca").fill(`${day}T11:30`);
  await modal.getByRole("button", { name: "Siguiente: naves y choferes" }).click();
  await expect(page.getByText("Recorrida coordinada. Ahora elegí las naves y los choferes.")).toBeVisible();
  await page.getByRole("dialog").getByRole("link", { name: "Listo" }).click();
  await expect(page.locator(`#vuelo-${ar.id}`)).toContainText(`Recorrida 11:30 con ${ja.number}`);
  await expect(page.locator(`#vuelo-${ja.id}`)).toContainText(`Recorrida 11:30 con ${ar.number}`);

  // La hoja del segundo vuelo trae la orden de los dos.
  await page.goto(`/admin/aeropuerto/orden-de-servicio/ver?date=${day}&flight=${ja.id}`);
  await expect(page.locator("section.orden-bloque")).toHaveCount(1);
  const orden = page.locator("section.orden-bloque");
  await expect(orden.locator(".orden-bloque-titulo")).toContainText(`${ar.number} despegue 14:00 + ${ja.number} despegue 14:40`);
  await expect(orden.locator(".orden-inicio-recorrida")).toContainText("11:30");
  expect((await pasajerosDeLaOrden(page)).sort()).toEqual([
    `Ana ${suffix} · ${ar.number}`, `Beto ${suffix} · ${ar.number}`, `Ceci ${suffix} · ${ja.number}`, `Dani ${suffix} · ${ja.number}`
  ]);
  // Un solo botón «Nave y chofer» por orden: la orden es de una camioneta, no de un vuelo.
  await expect(orden.getByRole("button", { name: /nave y chofer del/ })).toHaveCount(1);
  await expect(orden.getByRole("button", { name: /nave y chofer del/ })).toHaveText(/^Nave y chofer: Trafic /);
  await page.screenshot({ path: "/tmp/araucana-recorrida-compartida.png", fullPage: true });

  // El orden de la recorrida se acomoda a mano entre pasajeros de los dos vuelos y queda guardado.
  const antes = await pasajerosDeLaOrden(page);
  await orden.getByRole("button", { name: `Bajar ${antes[0]}` }).click();
  await expect(orden.getByText("Recorrida guardada.")).toBeVisible();
  await page.reload();
  const despues = await pasajerosDeLaOrden(page);
  expect(despues).toEqual([antes[1], antes[0], ...antes.slice(2)]);

  // El Excel y el link del chofer muestran lo mismo.
  const excel = await orden.getByRole("link", { name: "Descargar Excel" }).getAttribute("href");
  const filas = await filasDelExcel(page, excel!);
  for (const nombre of despues) expect(filas).toContain(nombre);

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await orden.getByRole("button", { name: "Copiar link" }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const anonimo = await browser.newContext();
  const chofer = await anonimo.newPage();
  await chofer.goto(link);
  await expect(chofer.locator("section.orden-bloque")).toHaveCount(1);
  expect(await pasajerosDeLaOrden(chofer)).toEqual(despues);
  await anonimo.close();

  // Elegir sólo uno de los dos en la hoja del chofer trae igual la orden unida.
  await page.goto(`/admin/aeropuerto/orden-de-servicio/ver?date=${day}&flights=${ar.id}%2C${arribos[0].id}`);
  await expect(page.locator("section.orden-bloque")).toHaveCount(2);
  await expect(page.locator("section.orden-bloque").first()).toContainText(`Dani ${suffix} · ${ja.number}`);
});

test("dos arribos juntados salen en una sola orden, y «Separar» los vuelve a dividir", async ({ page }) => {
  const [ar, ja] = arribos;
  await page.goto(`/admin/aeropuerto?date=${day}`);
  await page.locator(`#vuelo-${ja.id}`).getByRole("button", { name: `Juntar arribos con el ${ja.number}` }).click();
  let modal = page.getByRole("dialog", { name: `Juntar arribos · ${ja.number}` });
  await modal.locator(`input[name="flightId"][value="${ar.id}"]`).check();
  await page.screenshot({ path: "/tmp/araucana-juntar-arribos.png" });
  await modal.getByRole("button", { name: "Siguiente: naves y choferes" }).click();
  await expect(page.getByText("Arribos juntados en una recorrida. Ahora elegí las naves y los choferes.")).toBeVisible();
  await page.getByRole("dialog").getByRole("link", { name: "Listo" }).click();
  await expect(page.locator(`#vuelo-${ar.id}`)).toContainText(`Recorrida con ${ja.number}`);
  await page.goto(`/admin?date=${day}`);
  await page.getByRole("button", { name: "Equipo del día" }).click();
  await page.getByRole("searchbox", { name: "Buscar en el equipo" }).fill(`Trafic ${suffix}`);
  await page.getByRole("button", { name: new RegExp(`Trafic ${suffix}`) }).click();
  for (const vuelo of [ar, ja]) {
    const tarea = page.locator(".desk-agenda a").filter({ hasText: vuelo.number });
    await expect(tarea).toContainText("Recorrida compartida");
    await expect(tarea).not.toContainText("Revisar cruce horario");
  }
  // Juntar arribos no toca ninguna hora.
  expect((await db.flight.findUniqueOrThrow({ where: { id: ar.id } })).pickupStartOverrideAt).toBeNull();

  await page.goto(`/admin/aeropuerto/orden-de-servicio/ver?date=${day}&flight=${ar.id}`);
  await expect(page.locator("section.orden-bloque")).toHaveCount(1);
  await expect(page.locator(".orden-bloque-titulo")).toContainText(`Llega ${ar.number} llega 19:10 + ${ja.number} llega 19:35`);
  expect((await pasajerosDeLaOrden(page)).sort()).toEqual([`Eva ${suffix} · ${ar.number}`, `Fede ${suffix} · ${ja.number}`, `Gabi ${suffix} · ${ja.number}`]);

  await page.goto(`/admin/aeropuerto?date=${day}`);
  await page.locator(`#vuelo-${ar.id}`).getByRole("button", { name: `Juntar arribos con el ${ar.number}` }).click();
  modal = page.getByRole("dialog", { name: `Juntar arribos · ${ar.number}` });
  await expect(modal.locator(`input[name="flightId"][value="${ja.id}"]`)).toBeChecked();
  await modal.getByRole("button", { name: "Separar" }).click();
  await expect(page.getByText("Los arribos quedaron separados: cada uno con su orden.")).toBeVisible();
  await page.goto(`/admin/aeropuerto/orden-de-servicio/ver?date=${day}&flight=${ar.id}`);
  await expect(page.locator("section.orden-bloque")).toHaveCount(1);
  expect(await pasajerosDeLaOrden(page)).toEqual([`Eva ${suffix}`]);
});

test("coordinadas juntas con una nave cada vuelo: se juntan y, si entran todos, sale una sola nave", async ({ page }) => {
  const [ar, ja] = separadas;
  await db.flight.updateMany({ where: { id: { in: [ar.id, ja.id] } }, data: { pickupGroupId: `grupo-${suffix}` } });
  // Desde la hoja de cualquiera de los dos vuelos: la recorrida junta a los pasajeros de ambos y los
  // reparte entre las dos Master. Con dos pasajeros entran en una; la otra queda vacía (el panel la
  // muestra igual, para poder pasarle gente).
  for (const vuelo of [ar, ja]) {
    await page.goto(`/admin/aeropuerto/orden-de-servicio/ver?date=${day}&flight=${vuelo.id}`);
    await expect(page.locator("section.orden-bloque")).toHaveCount(2);
    const pasajeros = (await pasajerosDeLaOrden(page)).filter((fila) => !fila.startsWith("Sin pasajeros en esta nave"));
    expect(pasajeros.sort()).toEqual([`Hugo ${suffix} · ${ar.number}`, `Ines ${suffix} · ${ja.number}`]);
  }
  const conGente = page.locator("section.orden-bloque").filter({ hasText: `Hugo ${suffix}` });
  await expect(conGente).toContainText(`Ines ${suffix}`);
  const excel = await conGente.getByRole("link", { name: "Descargar Excel" }).getAttribute("href");
  const filas = await filasDelExcel(page, excel!);
  expect(filas).toContain(`Hugo ${suffix}`);
  expect(filas).toContain(`Ines ${suffix}`);
});

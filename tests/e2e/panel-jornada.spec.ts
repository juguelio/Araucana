import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Locator } from "@playwright/test";
import bcrypt from "bcryptjs";

const url = process.env.E2E_DATABASE_URL;
if (!url || process.env.E2E_ISOLATED_DATABASE !== "1" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Requires local test database");
const db = new PrismaClient({ datasourceUrl: url });
const suffix = randomUUID();
const day = "2031-07-15";
const password = "Local-" + suffix;
const adminEmail = "panel-" + suffix + "@example.com";
const driverName = "Chofer prueba " + suffix;
const route = { from: "Centro", to: "Terminal", via: "", durationMin: 60, priceCents: 100, category: "Regular", description: "", stops: [] };
async function abrirServicio(row: Locator) {
  await expect(row).toBeAttached();
  const programacion = row.locator('xpath=ancestor::details[contains(@class,"sd-programmed")]');
  if (await programacion.count() && await programacion.getAttribute("open") === null) {
    await programacion.locator(":scope > summary").click();
  }
  const fold = row.locator(".plan-service-fold");
  if (await fold.getAttribute("open") === null) await fold.locator(":scope > summary").click();
}

test("la misma nave y chofer cubren aeropuerto, cerro y ruta desde el panel", async ({ page }) => {
  const { id: admin } = await db.user.create({ data: { email: adminEmail, passwordHash: await bcrypt.hash(password, 8), role: "ADMIN", isActive: true } });
  const { id: driver } = await db.user.create({ data: { name: driverName, email: suffix + "@example.com", role: "DRIVER", isActive: true } });
  const { id: vehicle } = await db.vehicle.create({ data: { name: "Combi " + suffix } });
  const extras = await Promise.all([1, 2, 3].map(n =>
    db.vehicle.create({ data: { name: `Refuerzo ${n} ${suffix}` } })
  ));
  const flight = await db.flight.create({ data: { number: "AR1652", direction: "ARRIVAL", origin: "AEP", scheduledAt: new Date(day + "T08:00:00-03:00"), assignments: { create: { vehicleId: vehicle } } } });
  const cerro = await db.travelRoute.create({ data: { ...route, slug: "cerro-" + suffix, bookingMode: "CHAPELCO", specialType: "CHAPELCO", chapelcoOperationDays: { create: { serviceDate: new Date(day + "T00:00:00Z"), vehicleDuties: { create: { vehicleId: vehicle, capacity: 10 } } } } } });
  const regular = await db.travelRoute.create({ data: { ...route, slug: "ruta-" + suffix, schedules: { create: { vehicleId: vehicle, departureAt: new Date(day + "T17:00:00-03:00"), arrivalAt: new Date(day + "T18:00:00-03:00") } } } });
  try {
    expect((await page.request.post("/api/v1/auth/login", { data: { email: adminEmail, password } })).status()).toBe(200);
    await page.goto("/admin?date=" + day);
    const airportRow = page.locator('.sd-row[data-area="AEROPUERTO"]');
    await expect(airportRow.locator("select:visible")).toHaveCount(0);
    await page.getByRole("button", { name: "Equipo del día" }).click();
    await abrirServicio(airportRow);
    const vehiclePicker = airportRow.getByLabel("Combi para sumar al vuelo");
    for (const [index, extra] of extras.entries()) {
      await abrirServicio(airportRow);
      await expect(vehiclePicker).toBeEnabled();
      await page.getByRole("searchbox", { name: "Buscar en el equipo" }).fill(extra.name);
      await vehiclePicker.scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: new RegExp(extra.name) }).dragTo(vehiclePicker);
      await expect(vehiclePicker).toHaveValue(extra.id);
      await airportRow.getByRole("button", { name: "Sumar", exact: true }).click();
      await expect(airportRow.getByText(`${index + 2} naves asignadas`)).toBeVisible();
    }
    expect(await db.airportVehicleAssignment.count({ where: {flightId: flight.id} })).toBe(4);
    for (const area of ["AEROPUERTO", "CHAPELCO", "RUTA"]) {
      const row = page.locator('.sd-row[data-area="' + area + '"]').filter({ has: page.locator('select[name=driverId]') });
      const select = row.locator(area === "RUTA" ? '.sd-crew select[name=driverId]' : '.sd-driver select[name=driverId]').first();
      await abrirServicio(row);
      await page.getByRole("button", { name: "Choferes", exact: true }).click();
      await page.getByRole("searchbox", { name: "Buscar en el equipo" }).fill(driverName);
      await select.scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: driverName }).dragTo(select);
      await expect(select).toHaveValue(driver);
      await row.getByRole("button", { name: "Guardar", exact: true }).first().click();
      const notice = { AEROPUERTO: "Chofer asignado a la combi.", CHAPELCO: "Chofer asignado a la nave.", RUTA: "Chofer asignado a la salida." }[area];
      await expect(page).toHaveURL(u => u.pathname === "/admin" && u.searchParams.get("notice") === notice);
      await expect.poll(async () => area === "AEROPUERTO" ? db.airportVehicleAssignment.count({where:{flightId:flight.id,driverId:driver}}) : area === "CHAPELCO" ? db.chapelcoVehicleDuty.count({where:{vehicleId:vehicle,driverId:driver}}) : db.schedule.count({where:{routeId:regular.id,driverId:driver}})).toBe(1);
    }
    await page.reload();
    await expect(page.getByRole("button", { name: "Equipo del día" })).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "Choferes", exact: true }).click();
    await page.getByRole("button", { name: driverName }).click();
    await expect(page.locator(".desk-agenda a").filter({ has: page.locator("strong") })).toHaveCount(3);
    await page.getByRole("link", { name: "Órdenes de aeropuerto" }).click();
    await expect(page.getByText(`Sin órdenes de aeropuerto con pasajeros para ${driverName} en esta fecha.`)).toBeVisible();
    await page.getByRole("link", { name: "Volver al panel" }).click();
    await page.setViewportSize({ width:390, height:844 });
    await expect(page.getByRole("heading",{name:"Naves y choferes"})).toBeVisible();
  } finally {
    await db.flight.delete({ where:{id:flight.id} });
    await db.travelRoute.deleteMany({ where:{id:{in:[regular.id,cerro.id]}} });
    await db.vehicle.deleteMany({ where:{id:{in:[vehicle,...extras.map(extra => extra.id)]}} });
    await db.user.deleteMany({where:{id:{in:[admin,driver]}}});
    await db.$disconnect();
  }
});

test("cuatro naves en la ida y dos en la vuelta de una ruta se gestionan por separado", async ({ page }) => {
  const tag = randomUUID();
  const email = tag + "@example.com";
  const date = "2031-07-17";
  const fleet = await Promise.all([1, 2, 3, 4].map(n => db.vehicle.create({
    data: { name: `Interno ${n} ${tag}`, seats: { create: { number: "1", row: 1, column: 1 } } }
  })));
  await db.user.create({ data: { email, role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 8) } });
  const routes = await Promise.all(["Ida", "Vuelta"].map((label, i) => db.travelRoute.create({
    data: { ...route, from: i ? "Terminal" : "Centro", to: i ? "Centro" : "Terminal", slug: label + tag, schedules: { create: {
      vehicleId: fleet[0].id, departureAt: new Date(date + (i ? "T15:00:00-03:00" : "T08:00:00-03:00")),
      arrivalAt: new Date(date + (i ? "T16:00:00-03:00" : "T09:00:00-03:00"))
    } } }, include: { schedules: true }
  })));
  try {
    expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
    await page.goto("/admin?date=" + date);
    await expect(page.locator(".plan-heading")).toContainText("0 servicios");
    await expect(page.getByText("Ver la programación del día (2)")).toBeVisible();
    await page.getByRole("link", { name: /Pendientes/ }).click();
    await expect(page.locator(".sd-programmed")).toHaveCount(0);
    await page.getByRole("link", { name: /^Jornada/ }).click();
    for (const [index, trip] of routes.entries()) {
      const row = page.locator('.sd-row[data-area="RUTA"]').filter({ has: page.locator(".plan-service strong", { hasText: trip.from + " → " + trip.to }) });
      for (const [n, vehicle] of fleet.slice(1, index ? 2 : 4).entries()) {
        await abrirServicio(row);
        await row.getByLabel("Nave para sumar a la salida").selectOption(vehicle.id);
        await row.getByRole("button", { name: "Sumar", exact: true }).click();
        await expect(row.getByText(`${n + 2} naves asignadas`)).toBeAttached();
        await abrirServicio(row);
        await expect(row.getByText(`${n + 2} naves asignadas`)).toBeVisible();
      }
    }
    await page.reload();
    for (const [i, trip] of routes.entries()) {
      const row = page.locator('.sd-row[data-area="RUTA"]').filter({ has: page.locator(".plan-service strong", { hasText: trip.from + " → " + trip.to }) });
      await abrirServicio(row);
      await expect(row.getByText(i ? "2 naves asignadas" : "4 naves asignadas")).toBeVisible();
      const extras = await db.scheduleUnit.findMany({ where: { scheduleId: trip.schedules[0].id } });
      expect(extras.map(x => x.vehicleId).sort()).toEqual(fleet.slice(1, i ? 2 : 4).map(x => x.id).sort());
    }
  } finally {
    await db.travelRoute.deleteMany({ where: { id: { in: routes.map(r => r.id) } } });
    await db.vehicle.deleteMany({ where: { id: { in: fleet.map(v => v.id) } } });
    await db.user.delete({ where: { email } });
    await db.$disconnect();
  }
});

test("avería con la salida completa: un bus de 30 se reemplaza por dos de 15", async ({ page }) => {
  const tag = randomUUID();
  const date = "2031-07-20";
  const passengerData = { firstName: "Persona", lastName: "Demo", email: "demo@example.test", phone: "+5492972123456", documentType: "DNI", documentId: "30000001" };
  const email = tag + "@example.test";
  const admin = await db.user.create({ data: { email, role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 8) } });
  const fleet = await Promise.all([30, 15, 15].map((capacity, i) => db.vehicle.create({
    data: { name: "Unidad " + i + " " + tag, publicTransport: true, seats: { create: Array.from({ length: capacity }, (_, n) => ({ number: String(n+1), row: 1+Math.floor(n/4), column: 1+n%4 })) } }, include: { seats: true }
  })));
  const trip = await db.travelRoute.create({ data: { ...route, slug: tag } });
  const schedule = await db.schedule.create({ data: { vehicleId: fleet[0].id, routeId: trip.id, departureAt: new Date(date + "T12:00:00-03:00"), arrivalAt: new Date(date + "T13:00:00-03:00") } });
  const pax = await db.passenger.create({ data: passengerData });
  const reservations = fleet[0].seats.map(seat => ({
    seatNumber: seat.number, seatId: seat.id, code: tag + seat.number, shortCode: tag + "-" + seat.number,
    passengerId: pax.id, scheduleId: schedule.id, passengerCount: 1, totalCents: 1000, status: "CONFIRMED"
  }));
  try {
    await db.reservation.createMany({ data: reservations });
    expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
    await page.goto("/admin?date=" + date);
    const row = page.locator('.sd-row[data-area="RUTA"]').filter({ hasText: fleet[0].name });
    await abrirServicio(row);
    await row.getByText("Reemplazar por avería", { exact: true }).click();
    const form = row.locator(".sd-replace[open]");
    await form.getByLabel("Nave de reemplazo 1").selectOption(fleet[1].id);
    await expect(form.getByRole("status")).toContainText("Faltan 15");
    await expect(form.getByRole("button", { name: "Confirmar reemplazo" })).toBeDisabled();
    await form.getByText("Sumar otro reemplazo").click();
    await form.getByLabel("Nave de reemplazo 2").selectOption(fleet[2].id);
    // Otra operadora compromete una de las combis antes de confirmar.
    const busy = await db.schedule.create({ data: { vehicleId: fleet[2].id, routeId: trip.id, departureAt: new Date(date + "T12:20:00-03:00"), arrivalAt: new Date(date + "T14:00:00-03:00") } });
    await form.getByRole("button", { name: "Confirmar reemplazo" }).click();
    await expect(form.getByRole("alert")).toContainText("cruce de horario");
    expect(await db.scheduleUnit.count({ where: { scheduleId: schedule.id } })).toBe(0);
    expect((await db.schedule.findUniqueOrThrow({ where: { id: schedule.id } })).vehicleId).toBe(fleet[0].id);
    await db.schedule.delete({ where: { id: busy.id } });
    await form.getByRole("button", { name: "Confirmar reemplazo" }).click();
    await expect(page.getByText("2 naves asignadas", { exact: true })).toBeVisible();
    const saved = await db.schedule.findUniqueOrThrow({ where: { id: schedule.id }, include: { extraUnits: true, reservations: true } });
    expect([saved.vehicleId, ...saved.extraUnits.map(u => u.vehicleId)]).toEqual(fleet.slice(1).map(v => v.id));
    expect(saved.reservations.map(r => r.code).sort()).toEqual(reservations.map(r => r.code).sort());
    expect(saved.reservations.every(r => r.status === "CONFIRMED" && r.totalCents === 1000)).toBe(true);
    for (const vehicle of fleet.slice(1)) {
      const seats = new Set(vehicle.seats.map(s => s.id));
      expect(saved.reservations.filter(r => r.seatId && seats.has(r.seatId))).toHaveLength(15);
    }
    const booking = await page.request.post("/api/v1/reservations", { data: { scheduleId: schedule.id, passengerCount: 1, passenger: passengerData } });
    expect(booking.status()).toBe(409);
    expect(await booking.text()).toContain("CAPACITY_FULL");
  } finally {
    await db.reservation.deleteMany({ where: { scheduleId: schedule.id } });
    await db.travelRoute.delete({ where: { id: trip.id } });
    await db.passenger.delete({ where: { id: pax.id } });
    await db.vehicle.deleteMany({ where: { id: { in: fleet.map(v => v.id) } } });
    await db.user.delete({ where: { id: admin.id } });
  }
});

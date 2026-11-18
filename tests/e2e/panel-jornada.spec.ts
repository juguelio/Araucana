import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
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
test("la misma nave y chofer cubren aeropuerto, cerro y ruta desde el panel", async ({ page }) => {
  const { id: admin } = await db.user.create({ data: { email: adminEmail, passwordHash: await bcrypt.hash(password, 8), role: "ADMIN", isActive: true } });
  const { id: driver } = await db.user.create({ data: { name: driverName, email: suffix + "@example.com", role: "DRIVER", isActive: true } });
  const { id: vehicle } = await db.vehicle.create({ data: { name: "Combi " + suffix } });
  const extra = await db.vehicle.create({ data: { name: "Refuerzo " + suffix } });
  const flight = await db.flight.create({ data: { number: "AR1652", direction: "ARRIVAL", origin: "AEP", scheduledAt: new Date(day + "T08:00:00-03:00"), assignments: { create: { vehicleId: vehicle } } } });
  const cerro = await db.travelRoute.create({ data: { ...route, slug: "cerro-" + suffix, bookingMode: "CHAPELCO", specialType: "CHAPELCO", chapelcoOperationDays: { create: { serviceDate: new Date(day + "T00:00:00Z"), vehicleDuties: { create: { vehicleId: vehicle, capacity: 10 } } } } } });
  const regular = await db.travelRoute.create({ data: { ...route, slug: "ruta-" + suffix, schedules: { create: { vehicleId: vehicle, departureAt: new Date(day + "T17:00:00-03:00"), arrivalAt: new Date(day + "T18:00:00-03:00") } } } });
  try {
    expect((await page.request.post("/api/v1/auth/login", { data: { email: adminEmail, password } })).status()).toBe(200);
    await page.goto("/admin?date=" + day);
    const airportRow = page.locator('.sd-row[data-area="AEROPUERTO"]');
    const vehiclePicker = airportRow.getByLabel("Combi para sumar al vuelo");
    await page.getByRole("searchbox").fill(extra.name);
    await page.getByRole("button", { name: new RegExp(extra.name) }).dragTo(vehiclePicker);
    await expect(vehiclePicker).toHaveValue(extra.id);
    await airportRow.getByRole("button", { name: "Sumar", exact: true }).click();
    await expect(page).toHaveURL(u => u.pathname === "/admin" && u.searchParams.get("notice") === "Combi asignada al vuelo.");
    expect(await db.airportVehicleAssignment.count({ where: {flightId: flight.id} })).toBe(2);
    for (const area of ["AEROPUERTO", "CHAPELCO", "RUTA"]) {
      const row = page.locator('.sd-row[data-area="' + area + '"]').filter({ has: page.locator('select[name=driverId]') });
      const select = row.locator('select[name=driverId]').first();
      await page.getByRole("button", { name: "Choferes", exact: true }).click();
      await page.getByRole("searchbox").fill(driverName);
      await page.getByRole("button", { name: driverName }).dragTo(select);
      await expect(select).toHaveValue(driver);
      await row.getByRole("button", { name: "Guardar", exact: true }).first().click();
      const notice = { AEROPUERTO: "Chofer asignado a la combi.", CHAPELCO: "Chofer asignado a la nave.", RUTA: "Chofer asignado a la salida." }[area];
      await expect(page).toHaveURL(u => u.pathname === "/admin" && u.searchParams.get("notice") === notice);
      await expect.poll(async () => area === "AEROPUERTO" ? db.airportVehicleAssignment.count({where:{flightId:flight.id,driverId:driver}}) : area === "CHAPELCO" ? db.chapelcoVehicleDuty.count({where:{vehicleId:vehicle,driverId:driver}}) : db.schedule.count({where:{routeId:regular.id,driverId:driver}})).toBe(1);
    }
    await page.reload();
    await page.getByRole("button", { name: "Choferes", exact: true }).click();
    await page.getByRole("button", { name: driverName }).click();
    await expect(page.locator(".desk-agenda a")).toHaveCount(3);
    await page.setViewportSize({ width:390, height:844 });
    await expect(page.getByRole("heading",{name:"Equipo del día"})).toBeVisible();
  } finally {
    await db.flight.delete({ where:{id:flight.id} });
    await db.travelRoute.deleteMany({ where:{id:{in:[regular.id,cerro.id]}} });
    await db.vehicle.deleteMany({ where:{id:{in:[vehicle,extra.id]}} });
    await db.user.deleteMany({where:{id:{in:[admin,driver]}}});
    await db.$disconnect();
  }
});

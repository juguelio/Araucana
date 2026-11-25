import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const url = process.env.E2E_DATABASE_URL;
if (!url || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Se requiere una base de prueba aislada.");
const db = new PrismaClient({ datasourceUrl: url });
const suffix = randomUUID();
const day = "2034-07-18";
const nextDay = "2034-07-19";
const adminEmail = `oficina-${suffix}@example.com`;
const driverEmail = `chofer-${suffix}@example.com`;
const password = `Prueba-${suffix}`;
const driverName = `Chofer ${suffix.slice(0, 8)}`;
const tripTitle = `Cabecera ${suffix.slice(0, 8)} → Terminal`;
const specialClient = `Delegación ${suffix}`;
let driverId: string, vehicleId: string, routeId: string, flightId: string, runId: string, scheduleId: string;
let privateFlightId: string;

test.beforeAll(async () => {
  await db.user.create({ data: { email: adminEmail, role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 4) } });
  driverId = (await db.user.create({ data: { email: driverEmail, role: "DRIVER", name: driverName, isActive: true } })).id;
  vehicleId = (await db.vehicle.create({ data: { name: "Nave de prueba", seats: { create: [{ number: "1", row: 1, column: 1 }] } } })).id;
  routeId = (await db.travelRoute.create({ data: { slug: suffix, from: tripTitle.split(" → ")[0], to: "Terminal", via: "Ruta 40",
    durationMin: 60, priceCents: 1000, category: "REGIONAL", description: "", stops: [] } })).id;
  scheduleId = (await db.schedule.create({ data: { routeId, departureAt: new Date(day + "T08:00:00-03:00"), arrivalAt: new Date(day + "T09:00:00-03:00") } })).id;
  await db.schedule.create({ data: { routeId, vehicleId, departureAt: new Date(day + "T15:00:00-03:00"), arrivalAt: new Date(day + "T16:00:00-03:00") } });
  flightId = (await db.flight.create({ data: { number: "AR721", origin: "Buenos Aires", scheduledAt: new Date(day + "T12:00:00-03:00") } })).id;
  runId = (await db.schoolRun.create({ data: { serviceDate: new Date(nextDay), routeName: "Traslado de personal", shift: "17:00", kind: "personal-aeropuerto" } })).id;
  await db.specialTrip.createMany({ data: Array.from({ length: 41 }, (_, i) => ({
    client: `${specialClient} ${String(i + 1).padStart(2, "0")}`, serviceDate: new Date(day), status: "PENDING",
    legs: [], destinationSearch: "Lago", billingMode: "TOTAL", currency: "ARS", payments: []
  })) });
  await db.travelRoute.create({ data: { slug: `chapelco-${suffix}`, from: "Base", to: "Cerro", via: "", durationMin: 30,
    priceCents: 1000, category: "REGIONAL", description: "", stops: [], bookingMode: "CHAPELCO", specialType: "CHAPELCO",
    chapelcoOperationDays: { create: { serviceDate: new Date(day) } } } });
  const privateFlight = await db.flight.create({ data: {
    number: "AR723", origin: "Buenos Aires", scheduledAt: new Date(day + "T16:00:00-03:00")
  } });
  privateFlightId = privateFlight.id;
  await db.reservation.create({ data: {
    code: suffix, shortCode: suffix.slice(0, 8), bookingMode: "AIRPORT", totalCents: 1000,
    passenger: { create: { firstName: "Ana", lastName: "Prueba", email: driverEmail, phone: "12345", documentType: "DNI", documentId: suffix } },
    airportDetails: { create: { isPrivate: true, flightId: privateFlight.id, flightNumber: privateFlight.number,
      direction: privateFlight.direction, serviceDate: new Date(day) } }
  } });
});

test.afterAll(async () => {
  await db.reservation.deleteMany({ where: { code: suffix } });
  await db.passenger.deleteMany({ where: { email: driverEmail } });
  if (privateFlightId) await db.flight.delete({ where: { id: privateFlightId } });
  await db.travelRoute.deleteMany({ where: { slug: `chapelco-${suffix}` } });
  await db.specialTrip.deleteMany({ where: { client: { startsWith: specialClient } } });
  if (runId) await db.schoolRun.delete({ where: { id: runId } });
  if (flightId) await db.flight.delete({ where: { id: flightId } });
  if (routeId) await db.travelRoute.delete({ where: { id: routeId } });
  if (vehicleId) await db.vehicle.delete({ where: { id: vehicleId } });
  await db.user.deleteMany({ where: { email: { in: [adminEmail, driverEmail] } } });
  await db.$disconnect();
});

test("agrupa los viajes pendientes por rubro y asigna sólo el viaje elegido con nave y chofer", async ({ page }) => {
  test.setTimeout(120_000);
  const login = await page.request.post("/api/v1/auth/login", { data: { email: adminEmail, password } });
  expect(login.status()).toBe(200);
  if (process.env.PLAYWRIGHT_USE_BUILD === "1") {
    const { token } = await login.json();
    await page.context().addCookies([{ domain: new URL(login.url()).hostname, path: "/", name: "araucana_session", value: token, httpOnly: true }]);
  }
  await page.goto(`/admin/choferes?dia=${day}&vista=libres`);
  const trigger = page.getByRole("button", { name: `Asignar viaje a ${driverName}` });
  const fila = page.locator("li.chofer").filter({ hasText: driverName });
  const hoja = fila.getByRole("link", { name: "Ver hoja de ruta" });
  await expect(hoja).toHaveCount(0);
  await expect(fila.locator(".chofer-acciones").locator("button, a, summary")).toHaveCount(1);
  await trigger.click();
  const modal = page.getByRole("dialog");
  const rubro = (nombre: string) => modal.locator("summary").filter({ hasText: nombre });
  const lista = (nombre: string) => modal.getByRole("list", { name: nombre, exact: true });
  const buscar = modal.getByRole("searchbox", { name: "Buscar viaje" });
  await expect(modal.locator("summary")).toHaveText(["Aeropuerto 2 viajes", "Chapelco 1 viaje", "Concesiones 1 viaje", "Servicio público 1 viaje", "Viajes especiales 41 viajes"]);
  await rubro("Aeropuerto").click();
  await expect(lista("Aeropuerto").getByRole("button", { name: /AR723.*Privado/ })).toBeVisible();
  await expect(lista("Aeropuerto").getByRole("button", { name: /AR721/ })).toBeVisible();
  await buscar.fill("viajes especiales");
  const especiales = lista("Viajes especiales").getByRole("button");
  await expect(modal.locator("summary")).toHaveCount(1);
  await expect(especiales).toHaveCount(40);
  await modal.getByRole("button", { name: "Ver más viajes" }).click();
  await expect(especiales).toHaveCount(41);
  await especiales.last().click();
  await expect(modal.locator(".jornada-elegido")).toContainText(`${specialClient} 41`);
  await modal.getByRole("button", { name: "Cambiar viaje" }).click();
  await expect(especiales).toHaveCount(41);
  await buscar.fill("servicio publico");
  await modal.getByLabel("Filtrar por día").fill(nextDay);
  await expect(modal.getByRole("status")).toHaveText("Ningún viaje coincide con la búsqueda.");
  await buscar.fill("");
  await expect(lista("Concesiones").getByRole("button", { name: /Traslado de personal/ })).toBeVisible();
  await modal.getByLabel("Filtrar por día").fill("");
  await rubro("Servicio público").click();
  const schedule = lista("Servicio público").getByRole("button", { name: new RegExp(tripTitle) });
  await expect(schedule).toHaveCount(1);
  await expect(schedule).toContainText("08:00");
  await schedule.click();
  await modal.getByLabel("Nave para el viaje").selectOption(vehicleId);
  await modal.getByRole("button", { name: "Asignar viaje", exact: true }).click();
  await expect(page.getByText("Viaje asignado al chofer con la nave elegida.")).toBeVisible();
  expect(await db.schedule.findUnique({ where: { id: scheduleId }, select: { vehicleId: true, driverId: true } })).toEqual({ driverId, vehicleId });
  expect(await db.schoolRun.findUnique({ where: { id: runId }, select: { driverId: true, vehicleId: true } })).toEqual({ driverId: null, vehicleId: null });
  await expect(trigger).toHaveCount(0);
  await expect(hoja).toBeVisible();
  await expect(hoja).toHaveAttribute("href", `/admin/choferes/${driverId}/ordenes?fecha=${day}`);
  await fila.getByRole("link", { name: driverName, exact: true }).click();
  await expect(page.getByRole("link", { name: "Editar chofer" })).toHaveAttribute("href", `/admin/choferes/${driverId}`);
  await page.getByRole("link", { name: "Ver hoja del chofer" }).click();
  await expect(page).toHaveURL(new RegExp(`/ordenes\\?fecha=${day}$`));
  await page.getByRole("link", { name: "Volver a la ficha" }).click();
  const asignarEnFicha = page.getByRole("button", { name: `Asignar viaje a ${driverName}` });
  await asignarEnFicha.click();
  await expect(rubro("Servicio público")).toHaveCount(0);
  await rubro("Aeropuerto").click();
  await lista("Aeropuerto").getByRole("button", { name: /AR721/ }).click();
  await modal.getByLabel("Nave para el viaje").selectOption(vehicleId);
  await modal.getByRole("button", { name: "Asignar viaje", exact: true }).click();
  await expect(modal).toBeHidden();
  expect(await db.airportVehicleAssignment.findFirst({ where: { flightId }, select: { driverId: true, vehicleId: true } })).toEqual({ driverId, vehicleId });

  await expect(page).toHaveURL(new RegExp(`/actividad\\?dia=${day}&notice=`));
  await asignarEnFicha.click();
  await modal.getByLabel("Filtrar por día").fill(nextDay);
  await modal.getByRole("button", { name: /Traslado de personal/ }).click();
  await modal.getByLabel("Nave para el viaje").selectOption(vehicleId);
  await modal.getByRole("button", { name: "Asignar viaje", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("dia=" + nextDay));
  await expect(modal).toBeHidden();
  expect(await db.schoolRun.findUnique({ where: { id: runId }, select: { driverId: true, vehicleId: true } })).toEqual({ driverId, vehicleId });
});

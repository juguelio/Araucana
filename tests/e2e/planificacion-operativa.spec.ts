import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";

const url = process.env.E2E_DATABASE_URL;
if (!url || process.env.E2E_ISOLATED_DATABASE !== "1" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw Error("La planificación se prueba en una base local aislada.");
}
const db = new PrismaClient({ datasourceUrl: url });

test("planifica una semana, reparte los avisos y conserva los reemplazos por fecha", async ({ page }) => {
  const tag = randomUUID();
  const day = "2033-11-21";
  const admin = await db.user.create({ data: { email: tag + "@example.test", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(tag, 6) } });
  const drivers = await Promise.all(["Ana", "Pablo", "Sol"].map(name => db.user.create({ data: { name: name + tag, email: name + tag + "@example.test", role: "DRIVER", isActive: true } })));
  const vehicle = await db.vehicle.create({ data: {
    name: "Combi " + tag, technicalInspectionDueAt: new Date("2033-12-21"), serviceIntervalKm: 10000,
    documents: { create: { kind: "TECNICA", fileName: "tecnica.pdf", contentType: "application/pdf", sizeBytes: 100, blobUrl: "https://example.invalid/tecnica.pdf", blobPathname: tag + ".pdf" } },
    serviceSheets: { create: { servicedAt: new Date("2033-11-01"), odometerKm: 10000 } },
    odometerReadings: { create: { readAt: new Date("2033-11-20"), km: 19500 } }
  }, include: { documents: true } });
  const school = await db.schoolRun.create({ data: { routeName: "Escuela " + tag, shift: "Mañana", serviceDate: new Date(day), driverId: drivers[0].id } });
  const trip = await db.specialTrip.create({ data: {
    legs: [], payments: [], billingMode: "UNKNOWN", currency: "ARS", destinationSearch: "Pucón",
    client: "Club " + tag, serviceDate: new Date("2033-11-20"), endDate: new Date("2033-11-23"), status: "CONFIRMED",
    assignments: { create: { startsAt: new Date("2033-11-20T09:00:00-03:00"), endsAt: new Date("2033-11-23T18:00:00-03:00"), vehicleId: vehicle.id, driverId: drivers[1].id, coDriverId: drivers[2].id } }
  } });
  try {
    expect((await page.request.post("/api/v1/auth/login", { data: { email: admin.email, password: tag } })).status()).toBe(200);
    await page.goto("/admin?date=" + day);
    const priority = page.getByRole("complementary", { name: "Prioridad operativa" });
    await expect(priority).toContainText(school.routeName);
    await priority.getByRole("link", { name: "Resolver en la jornada" }).click();
    await expect(page.locator(".plan-service-fold[open]")).toContainText(school.routeName);
    await page.getByText("Atajos", { exact: true }).click();
    await page.getByRole("link", { name: "Boletería de servicio público" }).click();
    await expect(page.getByRole("heading", { name: "Servicio público", exact: true })).toBeVisible();
    await expect(page.getByLabel("Ir a una fecha")).toHaveValue(day);
    await page.goto("/admin?date=" + day + "&vista=semana");
    await expect(page.locator(".ops-week-day")).toHaveCount(7);
    const first = page.locator(".ops-week-day").first();
    await expect(first).toContainText("Día 2");
    await expect(first).toContainText(drivers[2].name!);
    await expect(page.locator(".ops-week-job").filter({ hasText: trip.client })).toHaveCount(3);
    await first.getByRole("link", { name: new RegExp(school.routeName) }).click();
    const open = page.locator(".plan-service-fold[open]");
    await open.getByLabel("Nave del recorrido").selectOption(vehicle.id);
    await open.getByRole("button", { name: "Guardar equipo del día" }).click();
    await expect(page.getByText("Equipo guardado para la jornada.")).toBeVisible();
    await open.getByText("Repetir recorrido", { exact: true }).click();
    await open.getByLabel("Desde", { exact: true }).fill("2033-11-22");
    await open.getByLabel("Hasta", { exact: true }).fill("2033-11-29");
    await open.getByLabel("Lun", { exact: true }).uncheck();
    await open.getByLabel("Mar", { exact: true }).check();
    await open.getByLabel(/Fechas a excluir/).fill("29/11/2033");
    await open.getByRole("button", { name: "Crear recorridos" }).click();
    await expect(page.getByText("Recorridos creados: 1.")).toBeVisible();
    const copy = await db.schoolRun.findFirstOrThrow({ where: { routeName: school.routeName, id: { not: school.id } } });
    expect(copy.serviceDate.toISOString().slice(0,10)).toBe("2033-11-22");
    const agenda = "/admin?" + new URLSearchParams({ date: day, vista: "flota", tipo: "chofer", recurso: drivers[0].id });
    await page.goto(agenda);
    const driver = page.locator(".console-resource[open]");
    await expect(driver.getByLabel("Mensaje para el chofer")).toHaveValue(new RegExp(vehicle.name));
    await driver.getByRole("button", { name: "Marcar como avisado" }).click();
    await expect(driver.locator("summary")).toContainText("Avisado");
    await page.reload();
    await expect(driver.locator("summary")).toContainText("Avisado");
    await page.goto(agenda + "&avisos=pendientes");
    await expect(page.locator(".console-resource summary").filter({ hasText: drivers[0].name! })).toHaveCount(0);
    await page.goto("/admin?date=" + day + "&servicio=escolar-" + school.id);
    await open.getByLabel("Chofer del recorrido").selectOption("");
    await open.getByRole("button", { name: "Guardar equipo del día" }).click();
    await expect(page.getByText("Equipo guardado para la jornada.")).toBeVisible();
    await page.goto(agenda + "&avisos=pendientes");
    await expect(driver.locator("summary")).toContainText("volver a avisar");
    await expect(driver.getByLabel("Mensaje para el chofer")).toHaveValue(/Sin servicios asignados/);
    expect((await db.schoolRun.findUniqueOrThrow({ where: { id: copy.id } })).driverId).toBe(drivers[0].id);
    await page.goto("/admin?" + new URLSearchParams({ date: day, vista: "flota", tipo: "chofer", recurso: drivers[2].id }));
    await expect(driver.getByLabel("Mensaje para el chofer")).toHaveValue(new RegExp(trip.client));
    await driver.getByRole("button", { name: "Marcar como avisado" }).click();
    await expect(driver.locator("summary")).toContainText("Avisado");
    await page.goto("/admin?" + new URLSearchParams({ date: day, vista: "flota", recurso: vehicle.id }));
    await expect(driver.locator("summary")).toContainText("Faltan 500 km");
    await expect(driver.getByRole("link", { name: "Service y kilometraje" })).toHaveAttribute("href", "/admin/naves/" + vehicle.id + "/service#service-km");
    await page.getByRole("link", { name: "Vencimientos a 30 días" }).click();
    const documents = page.getByRole("region", { name: "Vencimientos de flota y choferes" });
    const inspection = documents.getByRole("row").filter({ hasText: vehicle.name });
    await expect(inspection).toContainText("21/12/2033");
    await expect(inspection.getByRole("link", { name: "Abrir archivo" })).toHaveAttribute("href", "/api/vehiculos/" + vehicle.id + "/documentos/" + vehicle.documents[0].id);
    await documents.getByRole("link", { name: /Sin fecha/ }).click();
    await expect(documents.getByRole("row").filter({ hasText: drivers[1].name! })).toContainText("Licencia");
  } finally {
    await db.driverPlanNotice.deleteMany({ where: { driverId: { in: drivers.map(d => d.id) } } });
    await db.schoolRun.deleteMany({ where: { routeName: school.routeName } });
    await db.specialTrip.delete({ where: { id: trip.id } });
    await db.vehicle.delete({ where: { id: vehicle.id } });
    await db.user.deleteMany({ where: { id: { in: [admin.id, ...drivers.map(d => d.id)] } } });
  }
});

test("incluye la recorrida nocturna en el aviso correcto y permite crear un traslado de personal", async ({ page }) => {
  const tag = randomUUID(), date = "2033-05-18";
  const email = tag + "@example.test";
  const admin = await db.user.create({ data: { email, role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(tag, 6) } });
  const driver = await db.user.create({ data: { email: "chofer-" + email, role: "DRIVER", isActive: true, name: "Chofer " + tag } });
  const vehicle = await db.vehicle.create({ data: { name: "Interno " + tag } });
  const flight = await db.flight.create({ data: { number: "AR1310", direction: "DEPARTURE", scheduledAt: new Date("2033-05-19T01:00:00-03:00"),
    origin: "CPC", source: "MANUAL", assignments: { create: { vehicleId: vehicle.id, driverId: driver.id } } } });
  const name = "Personal Aerolíneas " + tag;
  try {
    expect((await page.request.post("/api/v1/auth/login", { data: { email, password: tag } })).status()).toBe(200);
    await page.goto("/admin?" + new URLSearchParams({ date, vista: "flota", tipo: "chofer", recurso: driver.id }));
    const row = page.locator(".console-resource[open]");
    await expect(row.getByLabel("Mensaje para el chofer")).toHaveValue(/22:30 – 19\/05 01:00/);
    await expect(row.getByRole("link", { name: /Órdenes de aeropuerto/ })).toHaveAttribute("href", /date=2033-05-19/);
    await page.goto("/admin?date=" + date);
    await page.getByText("Agregar servicio", { exact: true }).click();
    await page.getByRole("link", { name: "Traslado de personal" }).click();
    await page.getByLabel("Nombre del recorrido").fill(name);
    await page.getByLabel("Turno u horario").fill("10:30");
    await page.getByRole("button", { name: "Guardar recorrido" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.getByRole("link", { name: "Volver al listado" }).click();
    await expect(page.getByRole("heading", { name: "Traslados de personal" })).toBeVisible();
    await expect(page.getByRole("link", { name })).toBeVisible();
    await page.goto("/admin/escolares?fecha=" + date);
    await expect(page.getByRole("link", { name })).toHaveCount(0);
    await page.goto("/admin?date=" + date + "&area=PERSONAL");
    const service = page.locator(".sd-row");
    await expect(service).toHaveCount(1);
    await expect(service).toContainText(name);
    await expect(service).toContainText("10:30");
  } finally {
    await db.schoolRun.deleteMany({ where: { routeName: name } });
    await db.airportVehicleAssignment.deleteMany({ where: { flightId: flight.id } });
    await db.flight.delete({ where: { id: flight.id } });
    await db.vehicle.delete({ where: { id: vehicle.id } });
    await db.user.deleteMany({ where: { id: { in: [admin.id, driver.id] } } });
  }
});

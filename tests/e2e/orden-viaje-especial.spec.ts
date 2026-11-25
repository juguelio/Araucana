import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
import { emptyLeg } from "../../src/lib/special-trips/data";

if (process.env.E2E_ISOLATED_DATABASE !== "1" || !process.env.E2E_DATABASE_URL) throw new Error("Se requiere una base aislada.");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID();
const email = `especial-${suffix}@example.com`;
const password = `Prueba-${suffix}`;
let tripId: string;
let vehicleId: string;

test.beforeAll(async () => {
  await db.user.create({ data: { email, role: "SECRETARY", isActive: true, passwordHash: await bcrypt.hash(password, 4) } });
  const vehicle = await db.vehicle.create({ data: { name: "Minibús de prueba", internalNumber: "24", licensePlate: "AA 000 ZZ" } });
  vehicleId = vehicle.id;
  const trip = await db.specialTrip.create({ data: {
    client: "Grupo de prueba", status: "CONFIRMED", passengers: 16, contactName: "Sofía", contactPhone: "+5492944000000",
    serviceDate: new Date("2032-04-21"), endDate: new Date("2032-04-22"),
    destinationSearch: "Villa Traful", notes: "Encuentro en la entrada principal.",
    billingMode: "ACCOUNT", currency: "ARS", payments: [], invoice: "Factura interna de prueba",
    legs: [
      { ...emptyLeg, origin: "San Martín de los Andes", destination: "Villa Traful", departure: "2032-04-21T08:15",
        points: [{ name: "Lago Hermoso", amount: "", date: "2032-04-21" }] },
      { ...emptyLeg, description: "Regreso al punto de encuentro", stops: "Parador del lago\nCentro" }
    ],
    assignments: { create: { vehicleId, startsAt: new Date("2032-04-21T10:00Z"), endsAt: new Date("2032-04-22T22:00Z") } }
  } });
  tripId = trip.id;
});

test.afterAll(async () => {
  if (tripId) await db.specialTrip.delete({ where: { id: tripId } });
  if (vehicleId) await db.vehicle.delete({ where: { id: vehicleId } });
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

test("secretaría imprime la orden del viaje y el chofer abre la misma hoja en el celular", async ({ page, browser }) => {
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
  await page.goto(`/admin/viajes-especiales/${tripId}`);
  await page.getByRole("link", { name: "Orden de servicio" }).click();

  const order = page.locator("article.orden");
  const logo = order.getByRole("img", { name: "La Araucana Viajes S.R.L." });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveJSProperty("naturalWidth", 320);
  await expect(order).toContainText("Grupo de prueba");
  await expect(order).toContainText("San Martín de los Andes → Villa Traful");
  await expect(order).toContainText("08:15 (Argentina)");
  await expect(order).toContainText("Lago Hermoso · 21/04/2032");
  await expect(order).toContainText("Regreso al punto de encuentro");
  await expect(order).toContainText("Parador del lago");
  await expect(order).toContainText("Interno 24");
  await expect(order).toContainText("Chofer sin asignar");
  await expect(order).not.toContainText("Factura interna");
  const content = await order.innerText();
  const link = await page.locator(".orden-link-url").innerText();
  await page.emulateMedia({ media: "print" });
  await expect(logo).toBeVisible();
  await expect(page.getByText("Firma del chofer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeHidden();
  await expect(page.locator(".orden-link-url")).toBeHidden();
  await expect(page.locator(".admin-sidebar")).toBeHidden();

  const driver = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    await driver.goto(link);
    await expect(driver.locator("article.orden")).toHaveText(await order.textContent() ?? "");
    expect(await driver.locator("article.orden").innerText()).toBe(content);
    expect(await driver.locator("article").evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(375);
    await expect(driver.getByRole("link", { name: "+5492944000000" })).toHaveAttribute("href", "tel:+5492944000000");
    await db.specialTrip.update({ where: { id: tripId }, data: { status: "CANCELLED" } });
    await driver.reload();
    await expect(driver.getByRole("heading", { name: "Viaje cancelado" })).toBeVisible();
    await expect(driver.locator("article.orden")).toHaveCount(0);
  } finally {
    await driver.close();
  }
});

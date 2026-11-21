import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { createReservationShortCode } from "../../src/lib/booking/codes";
import { suggestMunicipalLodgings } from "../../src/lib/airport/lodging-catalogue";

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl || process.env.E2E_ISOLATED_DATABASE !== "1"
  || !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Requires isolated local E2E database");
}
const db = new PrismaClient({ datasourceUrl: databaseUrl });
test.afterAll(async () => { await db.$disconnect(); });

test("elegir el alojamiento guardado completa el nombre y permite guardar", async ({ page }) => {
  const suffix = randomUUID();
  const email = `editar-alojamiento-${suffix}@example.com`;
  const password = `Test-${suffix}`;
  await db.user.create({ data: { email, role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  const route = await db.travelRoute.create({ data: {
    slug: `aeropuerto-prueba-${suffix}`, from: "San Martín de los Andes", to: "Aeropuerto Chapelco",
    via: "Directo", durationMin: 40, priceCents: 1200000, category: "Argentina", description: "Traslado de prueba", stops: []
  } });
  const scheduledAt = new Date(Date.now() + 86_400_000 * 10);
  const flight = await db.flight.create({ data: {
    number: "AR1653", airline: "AR", origin: "AEP", destination: "AEP", direction: "DEPARTURE",
    source: "MANUAL", status: "SCHEDULED", scheduledAt
  } });
  const lodging = suggestMunicipalLodgings("Rincón de los Andes").find(({ lodgingId }) => lodgingId === "108");
  if (!lodging?.point) throw new Error("Falta el punto de Rincón de los Andes");
  const [pickupLatitude, pickupLongitude] = lodging.point;
  const code = `ARC-2611-${suffix.replaceAll("-", "").toUpperCase()}`;
  await db.reservation.create({ data: {
    code, shortCode: createReservationShortCode(), bookingMode: "AIRPORT", status: "PENDING_PAYMENT",
    route: { connect: { id: route.id } }, passengerCount: 1, totalCents: 1200000, currency: "ARS",
    passenger: { create: { firstName: "Prueba", lastName: "Alojamiento", email: "pasajero@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "30111222" } },
    airportDetails: { create: {
      flightId: flight.id, flightNumber: flight.number, direction: "DEPARTURE", serviceDate: scheduledAt,
      pickupName: null, pickupAddress: lodging.label, pickupLatitude, pickupLongitude
    } }
  } });

  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
  await page.goto(`/admin/reservas/${code}/editar`);
  const save = page.getByRole("button", { name: "Guardar cambios" });
  await expect(save).toBeDisabled();
  await expect(page.getByText("No hay cambios para guardar.", { exact: true })).toBeVisible();

  const count = page.locator('input[name="passengerCount"]');
  await count.fill("0");
  await expect(count).toHaveAccessibleDescription(/una cantidad entera entre 1 y/);
  await expect(save).toBeDisabled();
  await count.fill("1");
  await expect(count).not.toHaveAttribute("aria-describedby", "reservation-count-error");

  const price = page.locator('input[name="customPrice"]');
  const originalPrice = await price.inputValue();
  await price.fill("doce mil");
  await expect(price).toHaveAccessibleDescription(/Ingresá un precio válido/);
  await expect(save).toBeDisabled();
  await price.fill(originalPrice);

  const passengerEmail = page.getByRole("textbox", { name: "Email (opcional)" });
  await passengerEmail.fill("correo-invalido");
  await save.click();
  await expect(passengerEmail).toHaveAttribute("aria-invalid", "true");
  await expect(passengerEmail).toHaveAccessibleDescription(/email|correo/i);
  await expect(page.getByText("Revisá los datos para guardar la reserva.")).toHaveCount(0);
  await passengerEmail.fill("pasajero@example.com");
  await expect(passengerEmail).toHaveAttribute("aria-invalid", "false");

  const locationSearch = page.getByRole("combobox", { name: "Hotel, cabaña o dirección" });
  await locationSearch.fill("Alcedro");
  await page.getByRole("option", { name: /^Alcedro Perito Moreno 1318/ }).click();
  const confirmMap = page.getByRole("checkbox", { name: "Confirmo que el mapa marca el lugar correcto" });
  await expect(confirmMap).toHaveAccessibleDescription(/Confirmá que el marcador/);
  await expect(save).toBeDisabled();

  await locationSearch.fill("Rincón de los Andes");
  await page.getByRole("option", { name: /^Rincón de los Andes Juez Del Valle 611/ }).click();
  await expect(page.getByRole("textbox", { name: /Nombre del lugar/ })).toHaveValue("Rincón de los Andes");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("Cambios guardados.", { exact: true })).toBeVisible();
  const saved = await db.reservation.findUniqueOrThrow({ where: { code }, include: { airportDetails: true } });
  expect(saved.airportDetails).toMatchObject({ pickupName: "Rincón de los Andes", pickupAddress: lodging.label, pickupLatitude, pickupLongitude });
  expect(saved.totalCents).toBe(1200000);
});

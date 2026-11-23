import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";
import { createReservationShortCode } from "../../src/lib/booking/codes";

/**
 * Listado de reservas: el código abre el detalle (ya no hay «Ver»), «Borrar» está dentro de Editar,
 * y estado, pago y comprobante abren un modal con sus opciones.
 */
if (!process.env.E2E_DATABASE_URL || process.env.E2E_ISOLATED_DATABASE !== "1") throw new Error("Requires isolated E2E database");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.E2E_DATABASE_URL).hostname)) throw new Error("Local database only");
const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
const suffix = randomUUID();
const email = `modales-${suffix}@example.com`;
const password = `Test-${suffix}`;
const codes = { pago: "", estado: "", comprobante: "", borrar: "", editar: "", pagada: "" };

test.beforeAll(async () => {
  await db.user.create({ data: { email, name: "Admin modales", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 10) } });
  const route = await db.travelRoute.create({ data: { slug: `modales-${suffix}`, from: "Origen", to: "Destino", via: "Directo", durationMin: 60, priceCents: 1500000, category: "Argentina", description: "Prueba aislada", stops: [] } });
  const vehicle = await db.vehicle.create({ data: { name: `Modales ${suffix}`, seats: { create: Array.from({ length: 8 }, (_, i) => ({ number: String(i + 1), row: i + 1, column: 1 })) } } });
  const day = new Date(Date.now() + 86400000 * 12).toISOString().slice(0, 10);
  const schedule = await db.schedule.create({ data: { routeId: route.id, vehicleId: vehicle.id, departureAt: new Date(`${day}T12:00:00-03:00`), arrivalAt: new Date(`${day}T13:00:00-03:00`), status: "OPEN" } });
  for (const key of Object.keys(codes) as Array<keyof typeof codes>) {
    const code = `ARC-2611-${randomUUID().replaceAll("-", "").toUpperCase()}`;
    const pagada = key === "pagada";
    codes[key] = code;
    await db.reservation.create({ data: {
      code, shortCode: createReservationShortCode(), route: { connect: { id: route.id } }, schedule: { connect: { id: schedule.id } },
      passengerCount: 1, status: pagada ? "CONFIRMED" : "PENDING_PAYMENT", totalCents: 1500000, currency: "ARS",
      passenger: { create: { firstName: "Modal", lastName: key, email: "modal@example.com", phone: "+5492944000000", documentType: "DNI", documentId: "30111222" } },
      payment: { create: {
        provider: "MANUAL", status: pagada ? "APPROVED" : "PENDING", amountCents: 1500000, currency: "ARS",
        ...(pagada ? { receiptBlobPathname: "local/pago.png", receiptFileName: "pago.png", receiptUploadedAt: new Date() } : {})
      } }
    } });
  }
});
test.afterAll(async () => { await db.$disconnect(); });

test.beforeEach(async ({ page }) => {
  await db.rateLimitHit.deleteMany();
  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
});

async function fila(page: Page, code: string) {
  await page.goto(`/admin/reservas?code=${code}`);
  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toHaveCount(1);
  return row;
}

test("el código abre el detalle y la fila ya no tiene Ver ni Borrar", async ({ page }) => {
  const row = await fila(page, codes.pago);
  await expect(row.getByRole("link", { name: "Ver", exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: /Borrar/ })).toHaveCount(0);
  await row.getByRole("link", { name: /Ver la reserva|ARC-/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/reservas/${codes.pago}$`));
});

test("«Registrar pago» abre el modal y registra el pago", async ({ page }) => {
  const row = await fila(page, codes.pago);
  await row.getByRole("button", { name: "Registrar pago" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toContainText("$ 15.000");
  await modal.getByLabel("Forma de pago").fill("Efectivo");
  await modal.getByRole("button", { name: "Registrar pago" }).click();
  await expect(page.getByText("Pago registrado.")).toBeVisible();
  const saved = await db.reservation.findUniqueOrThrow({ where: { code: codes.pago }, include: { payment: true } });
  expect(saved.payment?.status).toBe("APPROVED");
  expect(saved.payment?.method).toBe("Efectivo");
});

test("«Pagada» muestra el comprobante junto al formulario de cancelación", async ({ page }) => {
  const receiptPath = `/admin/reservas/${codes.pagada}/comprobante`;
  await page.route(receiptPath, (route) => route.fulfill({ path: "public/logo.png", contentType: "image/png" }));
  await page.goto(`/admin/reservas?code=${codes.pagada}`);
  await page.getByRole("button", { name: "Pagada. Ver estado y pago" }).click();

  const modal = page.getByRole("dialog", { name: /^Pagada/ });
  const receipt = modal.getByRole("img", { name: "Comprobante pago.png" });
  const reason = modal.getByLabel("Motivo de la cancelación");
  await expect(receipt).toHaveAttribute("src", receiptPath);
  await expect(receipt).toBeVisible();
  await expect(reason).toBeVisible();
  await expect(modal.getByRole("button", { name: "Cancelar reserva" })).toBeVisible();

  const receiptDesktop = (await receipt.boundingBox())!;
  const reasonDesktop = (await reason.boundingBox())!;
  expect(receiptDesktop.x + receiptDesktop.width).toBeLessThan(reasonDesktop.x);

  await page.setViewportSize({ width: 390, height: 844 });
  const receiptMobile = (await receipt.boundingBox())!;
  const reasonMobile = (await reason.boundingBox())!;
  expect(receiptMobile.y + receiptMobile.height).toBeLessThan(reasonMobile.y);
});

test("la etiqueta «Pago pendiente» abre el modal de estado: registrar pago, cancelar con motivo y restituir", async ({ page }) => {
  const row = await fila(page, codes.estado);
  await row.getByRole("button", { name: /Estado de la reserva: Pago pendiente/ }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("Forma de pago")).toBeVisible();
  await expect(modal.getByRole("button", { name: "Confirmar reserva" })).toBeDisabled();
  await modal.getByLabel("Motivo de la cancelación").fill("El pasajero no viaja");
  await modal.getByRole("button", { name: "Cancelar reserva" }).click();
  await expect(page.getByText("Reserva cancelada.")).toBeVisible();
  const cancelada = await db.reservation.findUniqueOrThrow({ where: { code: codes.estado } });
  expect(cancelada.status).toBe("CANCELLED");
  expect(cancelada.cancellationReason).toBe("El pasajero no viaja");

  const otra = page.getByRole("row").filter({ hasText: codes.estado });
  await otra.getByRole("button", { name: /Estado de la reserva: Cancelada/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Restituir reserva" }).click();
  await expect(page.getByText("Reserva restituida.")).toBeVisible();
  expect((await db.reservation.findUniqueOrThrow({ where: { code: codes.estado } })).status).not.toBe("CANCELLED");
});

test("la etiqueta del pago abre sus opciones", async ({ page }) => {
  const row = await fila(page, codes.comprobante);
  await row.getByRole("button", { name: /^Pago: Pendiente/ }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("heading", { name: /Pendiente · \$ 15\.000/ })).toBeVisible();
  await expect(modal.getByLabel("Forma de pago")).toBeVisible();
  await page.screenshot({ path: "/tmp/araucana-reservas-modal-pago.png" });
  await modal.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("«Subir comprobante» abre el modal y muestra el resultado ahí mismo", async ({ page }) => {
  const row = await fila(page, codes.comprobante);
  await row.getByRole("button", { name: "Subir comprobante" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Archivo del comprobante").setInputFiles({ name: "comprobante.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%prueba\n") });
  await modal.getByRole("button", { name: "Subir comprobante" }).click();
  // Sin almacenamiento de archivos en la base aislada: la subida responde con el motivo, dentro del modal.
  await expect(modal.getByRole("alert")).toContainText(/carga de comprobantes no está disponible/);
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

test("Borrar está dentro de Editar", async ({ page }) => {
  await page.goto(`/admin/reservas/${codes.borrar}/editar`);
  const seccion = page.getByRole("region", { name: "Borrar reserva" });
  page.once("dialog", (dialog) => dialog.accept());
  await seccion.getByRole("button", { name: "Borrar reserva" }).click();
  await expect(page).toHaveURL(/\/admin\/reservas\?notice=/);
  expect(await db.reservation.findUnique({ where: { code: codes.borrar } })).toBeNull();
});

test("Editar reserva da acceso a cargar el pago y, ya pagada, no lo vuelve a ofrecer", async ({ page }) => {
  await page.goto(`/admin/reservas/${codes.editar}/editar`);
  const seccion = page.getByRole("region", { name: "Cargar pago" });
  await expect(seccion).toContainText("$ 15.000");
  await seccion.getByLabel("Forma de pago").fill("Transferencia");
  await seccion.getByLabel("Referencia (opcional)").fill("OP-123");
  // El comprobante se adjunta al registrar el pago. Sin almacenamiento de archivos (como en esta base
  // local) el pago se registra igual y el aviso dice que falta el comprobante.
  await seccion.getByLabel("Comprobante (opcional)").setInputFiles({ name: "comprobante.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%comprobante\n") });
  await page.screenshot({ path: "/tmp/araucana-editar-pago.png", fullPage: true });
  await seccion.getByRole("button", { name: "Registrar pago" }).click();

  await expect(page).toHaveURL(new RegExp(`/admin/reservas/${codes.editar}\\?`));
  await expect(page.getByRole("status")).toContainText("Pago registrado, pero el comprobante no se adjuntó");
  const pagada = await db.reservation.findUniqueOrThrow({ where: { code: codes.editar }, include: { payment: true } });
  expect(pagada.payment?.status).toBe("APPROVED");
  expect(pagada.payment?.method).toBe("Transferencia");

  await page.goto(`/admin/reservas/${codes.editar}/editar`);
  await expect(page.getByRole("region", { name: "Cargar pago" })).toHaveCount(0);
});

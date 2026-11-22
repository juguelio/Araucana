import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), get: vi.fn(), attach: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: mocks.put, del: mocks.del }));
vi.mock("@/lib/booking/access", () => ({ requireReservationAccess: mocks.access }));
vi.mock("@/lib/booking/repository", () => ({
  getReservationByCode: mocks.get, attachManualPaymentReceipt: mocks.attach,
  BookingError: class extends Error { constructor(public code: string, message: string) { super(message); } }
}));
import { uploadReservationReceipt } from "./receipt-upload";
import { ComprobanteViewer } from "@/app/admin/reservas/comprobante-viewer";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("subida y guardado del HEIC", () => {
  it("guarda bytes JPEG y asocia nombre, tipo y tamaño convertidos a la reserva", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "local-test-placeholder");
    mocks.get.mockResolvedValue({ status: "PENDING_PAYMENT", payment: { provider: "MANUAL", status: "PENDING" } });
    mocks.put.mockImplementation(async (pathname, file) => ({ pathname, url: "https://example.com/receipt.jpg", contentType: file.type }));
    mocks.attach.mockResolvedValue({ reservation: { code: "ARC-TEST" } });
    const heic = readFileSync(new URL("./fixtures/receipt.heic", import.meta.url));
    await uploadReservationReceipt("ARC-TEST", new File([heic], "foto.HEIC", { type: "image/heic" }));

    const [pathname, file, options] = mocks.put.mock.calls[0];
    expect(pathname).toMatch(/manual-payment-receipts\/ARC-TEST\/.*-foto\.jpg$/);
    expect(file.type).toBe("image/jpeg");
    expect(new Uint8Array(await file.slice(0, 3).arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]));
    expect(options).toMatchObject({ access: "private", contentType: "image/jpeg" });
    // El tercer argumento es el actor de auditoría: la subida pública no tiene usuario logueado.
    expect(mocks.attach).toHaveBeenCalledWith("ARC-TEST", expect.objectContaining({ fileName: "foto.jpg", contentType: "image/jpeg", size: file.size }), undefined);
    const html = renderToStaticMarkup(createElement(ComprobanteViewer, { href: "/comprobante", fileName: file.name }));
    expect(html).toContain('<img class="comprobante-viewer-img" src="/comprobante"');
    expect(html).not.toContain("Este formato no se puede mostrar");
  });

  it("no guarda ni asocia archivos cuando no se puede convertir la foto", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "local-test-placeholder");
    mocks.get.mockResolvedValue({ status: "PENDING_PAYMENT", payment: { provider: "MANUAL", status: "PENDING" } });
    await expect(uploadReservationReceipt("ARC-TEST", new File(["dañado"], "foto.heic", { type: "image/heic" })))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringMatching(/JPG o PDF/) });
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.attach).not.toHaveBeenCalled();
  });

  // El caso del cliente: registró el pago (queda APPROVED) y después manda la foto del celular.
  // Las dos reglas tienen que componerse: la política deja adjuntar y la normalización guarda JPG.
  it("adjunta la foto HEIC a un pago ya registrado que no tenía comprobante", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "local-test-placeholder");
    mocks.get.mockResolvedValue({ status: "PENDING_PAYMENT", payment: { provider: "MANUAL", status: "APPROVED" } });
    mocks.put.mockImplementation(async (pathname, file) => ({ pathname, url: "https://example.com/receipt.jpg", contentType: file.type }));
    mocks.attach.mockResolvedValue({ reservation: { code: "ARC-TEST" } });
    const heic = readFileSync(new URL("./fixtures/receipt.heic", import.meta.url));
    await uploadReservationReceipt("ARC-TEST", new File([heic], "foto.HEIC", { type: "image/heic" }));

    const [, file] = mocks.put.mock.calls[0];
    expect(file.type).toBe("image/jpeg");
    expect(mocks.attach).toHaveBeenCalledWith("ARC-TEST", expect.objectContaining({ contentType: "image/jpeg" }), undefined);
  });

  it("no reemplaza la foto de un pago aprobado que ya tenía comprobante", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "local-test-placeholder");
    mocks.get.mockResolvedValue({
      status: "PENDING_PAYMENT",
      payment: { provider: "MANUAL", status: "APPROVED", receiptBlobPathname: "manual-payment-receipts/ARC-TEST/viejo.jpg" }
    });
    const heic = readFileSync(new URL("./fixtures/receipt.heic", import.meta.url));
    await expect(uploadReservationReceipt("ARC-TEST", new File([heic], "foto.HEIC", { type: "image/heic" })))
      .rejects.toMatchObject({ code: "PAYMENT_LOCKED" });
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.attach).not.toHaveBeenCalled();
  });
});

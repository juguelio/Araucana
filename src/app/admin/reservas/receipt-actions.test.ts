import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn(), reservation: vi.fn(), upload: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: m.user }));
vi.mock("@/lib/booking/repository", async () => {
  class BookingError extends Error {
    constructor(public code: string, message: string) { super(message); }
  }
  return { BookingError, getReservationByCode: m.reservation };
});
vi.mock("@/lib/payments/receipt-upload", () => ({ uploadReservationReceipt: m.upload }));

import { ApiError } from "@/lib/api/responses";
import { uploadReceiptFromAdminAction } from "./receipt-actions";

const code = "ARC-2611-ABCDEF";
const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "comprobante.pdf", { type: "application/pdf" });
const form = (entries: Record<string, string | File>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};
const inicial = { ok: false, message: "" };

beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ role: "SECRETARY" });
  m.reservation.mockResolvedValue({ code, payment: { provider: "MANUAL", status: "PENDING" } });
  m.upload.mockResolvedValue({});
});

describe("subir el comprobante desde el panel", () => {
  it("sube el archivo con la sesión del panel y avisa dentro del modal", async () => {
    const result = await uploadReceiptFromAdminAction(inicial, form({ code, receipt: pdf() }));
    expect(result).toEqual({ ok: true, message: expect.stringMatching(/Comprobante cargado/) });
    expect(m.user).toHaveBeenCalled();
    expect(m.upload).toHaveBeenCalledWith(code, expect.any(File));
    expect(m.revalidate).toHaveBeenCalledWith("/admin/reservas");
  });

  it("sin archivo no llama a la subida", async () => {
    expect(await uploadReceiptFromAdminAction(inicial, form({ code }))).toMatchObject({ ok: false });
    expect(m.upload).not.toHaveBeenCalled();
  });

  it("rechaza tipos de archivo no admitidos", async () => {
    const txt = new File(["hola"], "nota.txt", { type: "text/plain" });
    expect(await uploadReceiptFromAdminAction(inicial, form({ code, receipt: txt }))).toMatchObject({ ok: false });
    expect(m.upload).not.toHaveBeenCalled();
  });

  it("la documentación de tarifa sin cargo sólo la carga administración", async () => {
    m.reservation.mockResolvedValue({ code, payment: { provider: "DISABILITY_DOCUMENT", status: "PENDING" } });
    const result = await uploadReceiptFromAdminAction(inicial, form({ code, receipt: pdf() }));
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/administración/) });
    expect(m.upload).not.toHaveBeenCalled();

    m.user.mockResolvedValue({ role: "ADMIN" });
    expect(await uploadReceiptFromAdminAction(inicial, form({ code, receipt: pdf() }))).toMatchObject({ ok: true });
  });

  it("muestra el motivo cuando el pago ya no admite comprobantes o falta el almacenamiento", async () => {
    m.upload.mockRejectedValueOnce(new ApiError("PAYMENT_LOCKED", "El pago ya no admite comprobantes.", 409));
    expect(await uploadReceiptFromAdminAction(inicial, form({ code, receipt: pdf() }))).toEqual({ ok: false, message: "El pago ya no admite comprobantes." });
    m.upload.mockRejectedValueOnce(new Error("blob caído"));
    expect(await uploadReceiptFromAdminAction(inicial, form({ code, receipt: pdf() }))).toEqual({ ok: false, message: expect.stringMatching(/No pudimos subir/) });
  });
});

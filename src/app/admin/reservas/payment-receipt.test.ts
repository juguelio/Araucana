import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  manage: vi.fn(),
  upload: vi.fn(),
  redirect: vi.fn(),
  orden: [] as string[]
}));

vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: mocks.staff, getCurrentAdminOrRedirect: mocks.staff }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));
vi.mock("@/lib/payments/receipt-upload", () => ({ uploadReservationReceipt: mocks.upload }));
vi.mock("@/lib/booking/admin-management", async (original) => ({
  ...(await original<typeof import("@/lib/booking/admin-management")>()),
  manageReservation: mocks.manage
}));

import { ApiError } from "@/lib/api/responses";
import { manageReservationAction } from "./actions";

const code = "ARC-2611-ABC123";

function form(receipt?: File) {
  const data = new FormData();
  data.set("code", code);
  data.set("operation", "payment");
  data.set("method", "Transferencia");
  data.set("reference", "OP-1");
  if (receipt) data.set("receipt", receipt);
  return data;
}

const pdf = () => new File(["%PDF-1.4 comprobante"], "comprobante.pdf", { type: "application/pdf" });

async function aviso(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return decodeURIComponent((error as Error).message.replace(/\+/g, " "));
  }
  throw new Error("la acción terminó sin redirigir");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.orden.length = 0;
  mocks.staff.mockResolvedValue({ id: "secre", role: "SECRETARY", email: "secre@example.com", name: "Secre" });
  mocks.upload.mockImplementation(async () => { mocks.orden.push("comprobante"); });
  mocks.manage.mockImplementation(async () => { mocks.orden.push("pago"); return { receiptPath: null }; });
  mocks.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`); });
});

describe("registrar el pago con su comprobante", () => {
  it("adjunta el comprobante antes de aprobar el pago (aprobado ya no admite archivos)", async () => {
    const url = await aviso(manageReservationAction(form(pdf())));
    expect(mocks.orden).toEqual(["comprobante", "pago"]);
    expect(mocks.upload).toHaveBeenCalledWith(code, expect.any(File), undefined, expect.objectContaining({ role: "SECRETARY" }));
    expect(mocks.manage).toHaveBeenCalledWith(code, expect.objectContaining({ operation: "payment", method: "Transferencia", reference: "OP-1" }), expect.anything());
    expect(url).toContain("Pago registrado con su comprobante.");
  });

  it("sin archivo registra el pago como siempre", async () => {
    const url = await aviso(manageReservationAction(form()));
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.orden).toEqual(["pago"]);
    expect(url).toContain("Pago registrado.");
  });

  it("un archivo inválido no registra nada, para que el operador elija otro", async () => {
    mocks.upload.mockRejectedValue(new ApiError("VALIDATION_ERROR", "El archivo no parece un PDF válido.", 400));
    const url = await aviso(manageReservationAction(form(pdf())));
    expect(mocks.manage).not.toHaveBeenCalled();
    expect(url).toContain("El archivo no parece un PDF válido.");
  });

  it("si la reserva no admite comprobante, el pago se registra igual y se avisa", async () => {
    mocks.upload.mockRejectedValue(new ApiError("PAYMENT_LOCKED", "El pago ya no admite comprobantes.", 409));
    const url = await aviso(manageReservationAction(form(pdf())));
    expect(mocks.manage).toHaveBeenCalled();
    expect(url).toContain("Pago registrado, pero el comprobante no se adjuntó: El pago ya no admite comprobantes.");
  });

  it("un tipo de archivo no permitido se rechaza antes de subir", async () => {
    const url = await aviso(manageReservationAction(form(new File(["x"], "virus.exe", { type: "application/x-msdownload" }))));
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.manage).not.toHaveBeenCalled();
    expect(url).not.toContain("Pago registrado");
  });
});

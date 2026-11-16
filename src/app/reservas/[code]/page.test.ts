import { describe, expect, it } from "vitest";
import { getManualBankDetails } from "@/lib/payments/manual-bank-details";
import { formatDateTime, paymentLabel, placesLabel, statusBadge, statusCopy, statusHeading, statusTone } from "./presentation";

describe("reservation confirmation places label", () => {
  it("counts places without exposing seat numbers", () => {
    expect(placesLabel(1)).toBe("1 lugar");
    expect(placesLabel(2)).toBe("2 lugares");
    expect(placesLabel(0)).toBe("0 lugares");
  });
});

describe("reservation confirmation status copy", () => {
  it("distinguishes a pending reservation from a confirmed reservation", () => {
    expect(statusHeading("PENDING_PAYMENT")).toBe("Reserva recibida · pago pendiente");
    expect(statusCopy("PENDING_PAYMENT")).toContain("pago queda pendiente de confirmación manual");
  });

  it("uses explicit headings for confirmed, cancelled, and unknown statuses", () => {
    expect(statusHeading("CONFIRMED")).toBe("Reserva confirmada");
    expect(statusHeading("CANCELLED")).toBe("Reserva cancelada");
    expect(statusHeading("REVIEW")).toBe("Reserva recibida");
  });

  it("formats departure times in the Salta timezone", () => {
    expect(formatDateTime("2026-06-01T12:00:00.000Z")).toMatch(/\b9:00\b/);
  });

  it("does not offer placeholder bank details when configuration is missing", () => {
    expect(getManualBankDetails({})).toBeNull();
    expect(getManualBankDetails({ MANUAL_PAYMENT_HOLDER: "Empresa", MANUAL_PAYMENT_BANK: "Banco", MANUAL_PAYMENT_CBU: "123" })).toBeNull();
    expect(getManualBankDetails({ MANUAL_PAYMENT_HOLDER: "Empresa", MANUAL_PAYMENT_BANK: "Banco", MANUAL_PAYMENT_ALIAS: "empresa.pagos" })).toMatchObject({ holder: "Empresa", alias: "empresa.pagos" });
  });
});

describe("reservation confirmation payment and badge labels", () => {
  it("shows the payment status in Spanish instead of the internal code", () => {
    expect(paymentLabel("PENDING")).toBe("Pendiente");
    expect(paymentLabel("APPROVED")).toBe("Pagado");
    expect(paymentLabel("REJECTED")).toBe("Comprobante rechazado");
    expect(paymentLabel(null)).toBe("Pendiente");
    expect(paymentLabel("ALGO_NUEVO")).toBe("Algo Nuevo");
  });

  it("gives every reservation status a badge and a tone", () => {
    expect(statusBadge("PENDING_PAYMENT")).toBe("Pago pendiente");
    expect(statusTone("PENDING_PAYMENT")).toBe("atencion");
    expect(statusBadge("CONFIRMED")).toBe("Confirmada");
    expect(statusTone("CONFIRMED")).toBe("ok");
    expect(statusTone("CANCELLED")).toBe("grave");
    expect(statusBadge("REVIEW")).toBe("Recibida");
  });
});

import { describe, expect, it } from "vitest";
import { getManualBankDetails } from "@/lib/payments/manual-bank-details";
import { formatDateTime, placesLabel, statusCopy, statusHeading } from "./page";

describe("reservation confirmation places label", () => {
  it("counts places without exposing seat numbers", () => {
    expect(placesLabel(1)).toBe("1 lugar");
    expect(placesLabel(2)).toBe("2 lugares");
    expect(placesLabel(0)).toBe("0 lugares");
  });
});

describe("reservation confirmation status copy", () => {
  it("keeps planned heading text for pending manual-payment reservations without saying they are fully paid", () => {
    expect(statusHeading("PENDING_PAYMENT")).toBe("Reserva confirmada");
    expect(statusCopy("PENDING_PAYMENT")).toContain("pago queda pendiente de confirmacion manual");
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

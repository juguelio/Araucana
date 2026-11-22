import { describe, expect, it } from "vitest";
import { politicaDeComprobante } from "./receipt-policy";

const pago = (status: string, hasReceipt = false, provider = "MANUAL") => ({ provider, status, hasReceipt });

describe("política del comprobante de un pago manual", () => {
  it("sin pago no hay nada que subir", () => {
    expect(politicaDeComprobante("PENDING_PAYMENT", null)).toBe("bloqueado");
    expect(politicaDeComprobante("PENDING_PAYMENT", undefined)).toBe("bloqueado");
  });

  it("mientras el pago espera revisión se sube o se reemplaza", () => {
    expect(politicaDeComprobante("PENDING_PAYMENT", pago("PENDING"))).toBe("subir");
    expect(politicaDeComprobante("PENDING_PAYMENT", pago("REJECTED"))).toBe("subir");
    expect(politicaDeComprobante("PENDING_PAYMENT", pago("PENDING", true))).toBe("reemplazar");
    expect(politicaDeComprobante("PENDING_PAYMENT", pago("REJECTED", true))).toBe("reemplazar");
  });

  it("con el pago ya registrado se adjunta el comprobante que llegó después", () => {
    expect(politicaDeComprobante("PENDING_PAYMENT", pago("APPROVED"))).toBe("adjuntar");
    expect(politicaDeComprobante("CONFIRMED", pago("APPROVED"))).toBe("adjuntar");
  });

  it("no se reemplaza un comprobante ya validado", () => {
    expect(politicaDeComprobante("PENDING_PAYMENT", pago("APPROVED", true))).toBe("bloqueado");
    expect(politicaDeComprobante("CONFIRMED", pago("APPROVED", true))).toBe("bloqueado");
  });

  it("una reserva cancelada no admite comprobantes nuevos", () => {
    expect(politicaDeComprobante("CANCELLED", pago("PENDING"))).toBe("bloqueado");
    expect(politicaDeComprobante("CANCELLED", pago("APPROVED"))).toBe("bloqueado");
  });

  it("otros proveedores de pago no usan este carril", () => {
    expect(politicaDeComprobante("PENDING_PAYMENT", pago("APPROVED", false, "OTHER"))).toBe("bloqueado");
  });

  it("la documentación de la tarifa sin cargo sigue igual", () => {
    expect(politicaDeComprobante("DOCUMENTATION_PENDING", pago("PENDING", false, "DISABILITY_DOCUMENT"))).toBe("subir");
    expect(politicaDeComprobante("DOCUMENTATION_PENDING", pago("PENDING", true, "DISABILITY_DOCUMENT"))).toBe("reemplazar");
    expect(politicaDeComprobante("DOCUMENTATION_PENDING", pago("APPROVED", false, "DISABILITY_DOCUMENT"))).toBe("bloqueado");
    expect(politicaDeComprobante("PENDING_PAYMENT", pago("PENDING", false, "DISABILITY_DOCUMENT"))).toBe("bloqueado");
  });
});

import { describe, expect, it } from "vitest";
import { estadoDeFila, etiquetaDeAccion } from "./estado-fila";

const base = {
  status: "PENDING_PAYMENT",
  paymentStatus: "PENDING",
  paymentProvider: "MANUAL",
  totalCents: 3000000,
  hasReceipt: false,
  receiptUploadedAt: null,
  passengerPhone: "+5492944000001"
};

describe("estadoDeFila: una etiqueta y una acción por reserva (listado del 20-nov)", () => {
  it("sin comprobante: «Por cobrar» y la acción es registrar el pago", () => {
    expect(estadoDeFila(base, { esAdmin: false })).toMatchObject({ etiqueta: "Por cobrar", tono: "atencion", accion: "registrar-pago" });
  });

  it("con comprobante subido: se valida (no se ofrece registrar otro pago)", () => {
    const estado = estadoDeFila({ ...base, hasReceipt: true, receiptUploadedAt: new Date() }, { esAdmin: false });
    expect(estado).toMatchObject({ etiqueta: "Comprobante por validar", accion: "validar-pago", validaPagoManual: true });
  });

  it("comprobante rechazado: lo marca grave y deja registrar el pago a mano", () => {
    expect(estadoDeFila({ ...base, paymentStatus: "REJECTED", hasReceipt: true }, { esAdmin: false })).toMatchObject({
      etiqueta: "Comprobante rechazado",
      tono: "grave",
      accion: "registrar-pago"
    });
  });

  it("pagada pero sin confirmar: la acción es confirmar", () => {
    expect(estadoDeFila({ ...base, paymentStatus: "APPROVED" }, { esAdmin: false })).toMatchObject({ etiqueta: "Pagada · sin confirmar", accion: "confirmar" });
  });

  it("confirmada y pagada: la acción es mandar el voucher por WhatsApp", () => {
    expect(estadoDeFila({ ...base, status: "CONFIRMED", paymentStatus: "APPROVED" }, { esAdmin: false })).toMatchObject({
      etiqueta: "Pagada",
      tono: "ok",
      accion: "whatsapp"
    });
  });

  it("sin teléfono no hay acción de WhatsApp", () => {
    expect(estadoDeFila({ ...base, status: "CONFIRMED", paymentStatus: "APPROVED", passengerPhone: " " }, { esAdmin: false }).accion).toBeNull();
  });

  it("cancelada: apagada y sin acción principal", () => {
    expect(estadoDeFila({ ...base, status: "CANCELLED" }, { esAdmin: false })).toMatchObject({ etiqueta: "Cancelada", tono: "normal", accion: null, cancelada: true });
  });

  it("tarifa sin cargo: la documentación la revisa sólo un admin", () => {
    const docs = { ...base, status: "DOCUMENTATION_PENDING", paymentProvider: "DISABILITY_DOCUMENT", hasReceipt: true, receiptUploadedAt: new Date() };
    expect(estadoDeFila(docs, { esAdmin: true })).toMatchObject({ etiqueta: "Documentación por revisar", accion: "aprobar-documentacion" });
    expect(estadoDeFila(docs, { esAdmin: false })).toMatchObject({ etiqueta: "Docs pendientes", canViewReceipt: false, puedeSubirComprobante: false });
  });
});

describe("etiquetaDeAccion: el botón de la fila dice qué hace", () => {
  it("«Confirmar» a secas se leía como confirmar el pago: ahora dice «Confirmar reserva»", () => {
    expect(etiquetaDeAccion("confirmar")).toBe("Confirmar reserva");
  });

  it("las demás acciones conservan el texto corto de la fila", () => {
    expect(etiquetaDeAccion("validar-pago")).toBe("Validar pago");
    expect(etiquetaDeAccion("aprobar-documentacion")).toBe("Revisar docs");
    expect(etiquetaDeAccion("registrar-pago")).toBe("Registrar pago");
    expect(etiquetaDeAccion("whatsapp")).toBe("WhatsApp");
  });

  it("sin acción no hay botón", () => {
    expect(etiquetaDeAccion(null)).toBeNull();
  });
});

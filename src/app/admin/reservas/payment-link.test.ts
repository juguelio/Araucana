import { describe, expect, it } from "vitest";
import { enlaceRegistrarPago } from "./payment-link";

const base = { status: "PENDING_PAYMENT", paymentStatus: "PENDING", paymentProvider: "MANUAL", totalCents: 1_200_000 };

describe("enlaceRegistrarPago", () => {
  it("una reserva con pago pendiente lleva a registrar el pago", () => {
    expect(enlaceRegistrarPago(base)).toBe(true);
  });

  it("una reserva sin pago creado también, mientras el total sea mayor a cero", () => {
    expect(enlaceRegistrarPago({ ...base, paymentStatus: null, paymentProvider: null })).toBe(true);
  });

  it("un comprobante rechazado se puede volver a registrar", () => {
    expect(enlaceRegistrarPago({ ...base, paymentStatus: "REJECTED" })).toBe(true);
  });

  it("con el pago aprobado ya no hay nada que registrar", () => {
    expect(enlaceRegistrarPago({ ...base, status: "CONFIRMED", paymentStatus: "APPROVED" })).toBe(false);
  });

  it("una reserva cancelada no ofrece registrar el pago", () => {
    expect(enlaceRegistrarPago({ ...base, status: "CANCELLED" })).toBe(false);
  });

  it("una reserva confirmada no muestra el link: la etiqueta no dice «Pago pendiente»", () => {
    expect(enlaceRegistrarPago({ ...base, status: "CONFIRMED" })).toBe(false);
  });

  it("la tarifa por discapacidad no se cobra", () => {
    expect(enlaceRegistrarPago({ ...base, paymentProvider: "DISABILITY_DOCUMENT" })).toBe(false);
  });

  it("sin total no hay pago que registrar", () => {
    expect(enlaceRegistrarPago({ ...base, totalCents: 0 })).toBe(false);
  });

  it("un pago de otro proveedor pendiente no se registra a mano", () => {
    expect(enlaceRegistrarPago({ ...base, paymentProvider: "PAYWAY" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { adminReservationSchema, createReservationSchema } from "./validation";

const pasajero = {
  firstName: "Ana",
  lastName: "Perez",
  email: "ana@example.com",
  phone: "2944512345",
  documentType: "DNI" as const,
  documentId: "30111222"
};

const reserva = (over: Record<string, unknown> = {}) => ({
  scheduleId: "salida-1",
  passengerCount: 1,
  passenger: pasajero,
  ...over
});

describe("validación de reservas con tarifas por edad", () => {
  it("no deja vender una reserva entera de menores de 4: alguien paga tarifa entera", () => {
    const todosSinCargo = createReservationSchema.safeParse(reserva({ passengerCount: 6, freeFareCount: 6 }));
    expect(todosSinCargo.success).toBe(false);
    if (!todosSinCargo.success) {
      expect(todosSinCargo.error.issues.map((i) => i.path.join("."))).toContain("freeFareCount");
    }
  });

  it("tampoco deja una reserva sólo de menores con media tarifa", () => {
    expect(createReservationSchema.safeParse(reserva({ passengerCount: 3, halfFareCount: 3 })).success).toBe(false);
  });

  it("acepta un adulto con dos menores sin cargo y uno con media tarifa", () => {
    const ok = createReservationSchema.safeParse(reserva({ passengerCount: 4, halfFareCount: 1, freeFareCount: 2 }));
    expect(ok.success).toBe(true);
  });

  it("acepta el caso mínimo: un adulto solo, o un adulto con un bebé", () => {
    expect(createReservationSchema.safeParse(reserva()).success).toBe(true);
    expect(createReservationSchema.safeParse(reserva({ passengerCount: 2, freeFareCount: 1 })).success).toBe(true);
  });

  it("sigue rechazando más menores que lugares", () => {
    expect(createReservationSchema.safeParse(reserva({ passengerCount: 2, halfFareCount: 2, freeFareCount: 1 })).success).toBe(false);
  });

  it("el alta del panel cumple la misma regla", () => {
    expect(adminReservationSchema.safeParse(reserva({ passengerCount: 3, freeFareCount: 3 })).success).toBe(false);
    expect(adminReservationSchema.safeParse(reserva({ passengerCount: 3, freeFareCount: 2 })).success).toBe(true);
  });

  it("la tarifa por discapacidad sigue siendo de un solo pasajero de tarifa entera", () => {
    expect(createReservationSchema.safeParse(reserva({ requestDisabilityFare: true })).success).toBe(true);
    expect(createReservationSchema.safeParse(reserva({ requestDisabilityFare: true, passengerCount: 2, freeFareCount: 1 })).success).toBe(true);
  });

  // Issue #122: el cliente pidió que el DNI sea obligatorio al cargar. Antes, desde el panel se podía
  // guardar una reserva sin documento y la orden de servicio del chofer salía con «—».
  it("el alta del panel exige el documento del pasajero", () => {
    const sinDocumento = adminReservationSchema.safeParse(
      reserva({ passenger: { ...pasajero, documentId: "" } })
    );

    expect(sinDocumento.success).toBe(false);
    if (!sinDocumento.success) {
      expect(sinDocumento.error.issues.map((issue) => issue.path.join("."))).toContain("passenger.documentId");
    }
  });

  it("el alta del panel acepta el DNI con puntos y lo guarda normalizado", () => {
    const conPuntos = adminReservationSchema.safeParse(
      reserva({ passenger: { ...pasajero, documentId: "32.123.456" } })
    );

    expect(conPuntos.success).toBe(true);
    if (conPuntos.success) {
      expect(conPuntos.data.passenger.documentId).toBe("32123456");
    }
  });

  it("el alta del panel sigue aceptando un pasaporte válido", () => {
    const pasaporte = adminReservationSchema.safeParse(
      reserva({ passenger: { ...pasajero, documentType: "Pasaporte", documentId: "A1234567" } })
    );

    expect(pasaporte.success).toBe(true);
  });
});

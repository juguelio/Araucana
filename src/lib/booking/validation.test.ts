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

  // 19-nov: el alta del panel vuelve a aceptar el DNI vacío —el mostrador no siempre lo tiene a mano—
  // y la reserva queda marcada «Falta documento» hasta que alguien lo complete. Si viene cargado, se
  // valida igual que siempre. El checkout público lo sigue exigiendo (#122).
  it("el alta del panel guarda la reserva sin documento y la deja marcada", () => {
    const sinDocumento = adminReservationSchema.safeParse(
      reserva({ passenger: { ...pasajero, documentId: "" } })
    );

    expect(sinDocumento.success).toBe(true);
    if (sinDocumento.success) {
      expect(sinDocumento.data.passenger.documentId).toBe("");
    }
  });

  it("sin documento igual se valida lo que venga cargado", () => {
    const dniCorto = adminReservationSchema.safeParse(
      reserva({ passenger: { ...pasajero, documentId: "123" } })
    );
    expect(dniCorto.success).toBe(false);
    if (!dniCorto.success) {
      expect(dniCorto.error.issues.map((issue) => issue.path.join("."))).toContain("passenger.documentId");
    }
  });

  it("la reserva web sigue exigiendo el documento", () => {
    expect(createReservationSchema.safeParse(reserva({ passenger: { ...pasajero, documentId: "" } })).success).toBe(false);
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

describe("carga desde el panel sin contacto (#241)", () => {
  it("acepta una reserva sin email ni teléfono y los guarda vacíos", () => {
    const sinContacto = adminReservationSchema.safeParse(
      reserva({ passenger: { ...pasajero, email: "", phone: "" } })
    );

    expect(sinContacto.success).toBe(true);
    if (sinContacto.success) {
      expect(sinContacto.data.passenger.email).toBe("");
      expect(sinContacto.data.passenger.phone).toBe("");
    }
  });

  it("si el email viene cargado, lo sigue validando", () => {
    const malo = adminReservationSchema.safeParse(
      reserva({ passenger: { ...pasajero, email: "ana@" } })
    );

    expect(malo.success).toBe(false);
  });

  it("si el teléfono viene cargado, lo sigue validando", () => {
    const malo = adminReservationSchema.safeParse(
      reserva({ passenger: { ...pasajero, phone: "12" } })
    );

    expect(malo.success).toBe(false);
  });

  it("los checkouts públicos siguen exigiendo email y teléfono", () => {
    expect(createReservationSchema.safeParse(reserva({ passenger: { ...pasajero, email: "" } })).success).toBe(false);
    expect(createReservationSchema.safeParse(reserva({ passenger: { ...pasajero, phone: "" } })).success).toBe(false);
  });
});

describe("errores por campo para el formulario del panel (#242)", () => {
  const campoDelError = (passenger: Record<string, unknown>) => {
    const parsed = adminReservationSchema.safeParse(reserva({ passenger: { ...pasajero, ...passenger } }));
    return parsed.success ? null : parsed.error.issues[0]?.path.at(-1);
  };

  it("el nombre vacío apunta al input `firstName`", () => {
    expect(campoDelError({ firstName: "" })).toBe("firstName");
  });

  it("un documento inválido apunta al input `documentId`", () => {
    expect(campoDelError({ documentId: "12" })).toBe("documentId");
  });

  it("un precio inválido queda identificado para marcarlo en el campo del precio", () => {
    // El esquema lo llama `overrideTotalCents`; el formulario lo muestra como `customPrice`.
    const parsed = adminReservationSchema.safeParse(reserva({ overrideTotalCents: null, passenger: pasajero }));
    if (parsed.success) throw new Error("el precio inválido debería fallar");
    expect(parsed.error.issues[0]?.path.at(-1)).toBe("overrideTotalCents");
  });
});

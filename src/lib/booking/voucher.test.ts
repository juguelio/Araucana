import { describe, expect, it } from "vitest";
import type { ReservationDetailDto } from "./types";
import {
  CANCELLATION_POLICY,
  absoluteUrl,
  buildVoucher,
  diaCalendario,
  documentoDelPasajero,
  estadoDelVoucher,
  importeDelVoucher,
  voucherMessage,
  voucherPath,
  whatsappShareUrl
} from "./voucher";

/** Reserva mínima: el voucher sólo lee estos campos, así que el resto va con valores fijos. */
function reserva(overrides: Partial<ReservationDetailDto> = {}): ReservationDetailDto {
  return {
    id: "res_1",
    code: "ARC-2611-ABCDEF0123456789ABCDEF0123456789",
    shortCode: "ABCD2345",
    bookingMode: "SEATED",
    passengerCount: 2,
    status: "CONFIRMED",
    totalCents: 4800000,
    total: 48000,
    currency: "ARS",
    createdAt: new Date("2026-11-10T12:00:00.000Z"),
    route: {
      id: "route_1",
      slug: "aeropuerto-chapelco-sma",
      from: "Aeropuerto Chapelco",
      to: "San Martín de los Andes",
      via: "Ruta 40",
      description: "Traslado",
      category: "aeropuerto",
      featured: false,
      durationMin: 40,
      priceCents: 2400000,
      price: 24000,
      currency: "ARS",
      bookingMode: "SEATED"
    },
    schedule: {
      id: "schedule_1",
      route: {} as ReservationDetailDto["route"],
      departureAt: new Date("2026-06-01T12:00:00.000Z"),
      arrivalAt: new Date("2026-06-01T13:00:00.000Z"),
      status: "OPEN",
      priceCents: 2400000,
      price: 24000,
      currency: "ARS"
    },
    passenger: {
      firstName: "Mercedes",
      lastName: "Utrera",
      email: "mercedes@example.com",
      phone: "+54 9 2974 046867",
      documentType: "DNI",
      documentId: "30111222"
    },
    seatNumber: null,
    payment: {
      provider: "manual_transfer",
      status: "APPROVED",
      amountCents: 2400000,
      amount: 24000,
      currency: "ARS"
    },
    ticket: null,
    ...overrides
  };
}

describe("políticas de cancelación del voucher", () => {
  it("trae los tramos de reintegro del ejemplo del cliente", () => {
    const texto = CANCELLATION_POLICY.join("\n");
    expect(texto).toContain("48 horas");
    expect(texto).toContain("90%");
    expect(texto).toContain("80%");
    expect(texto).toContain("50%");
    expect(texto).toContain("no tiene reintegros");
    expect(texto).toContain("Centro de Esquí");
  });
});

describe("buildVoucher", () => {
  it("toma fecha y horario de la salida en hora argentina", () => {
    const voucher = buildVoucher(reserva());
    expect(voucher.rows[0].fecha).toBe("01/06/2026");
    expect(voucher.rows[0].horario).toBe("09:00");
    expect(voucher.rows[0].inicio).toBe("Aeropuerto Chapelco");
    expect(voucher.rows[0].fin).toBe("San Martín de los Andes");
  });

  it("no corre al día anterior una fecha de calendario", () => {
    const voucher = buildVoucher(
      reserva({
        bookingMode: "CHAPELCO",
        chapelcoDetails: {
          serviceDate: new Date("2026-02-01T00:00:00.000Z"),
          ascentSlot: "09:00",
          pickupName: "Hotel Caupolicán",
          pickupAddress: "Belgrano 658",
          pickupLatitude: -40.15,
          pickupLongitude: -71.35,
          pickupNotes: "Entrada por el lobby"
        }
      })
    );
    expect(voucher.rows[0].fecha).toBe("01/02/2026");
    expect(voucher.rows[0].inicio).toContain("Hotel Caupolicán");
    expect(voucher.rows[0].fin).toBe("Cerro Chapelco");
    expect(voucher.rows[0].observaciones).toContain("Entrada por el lobby");
  });

  it("respeta el sentido del traslado de aeropuerto", () => {
    const voucher = buildVoucher(
      reserva({
        bookingMode: "AIRPORT",
        airportDetails: {
          flightNumber: "AR1657",
          direction: "ARRIVAL",
          serviceDate: new Date("2026-11-15T00:00:00.000Z"),
          pickupName: "Casa",
          pickupAddress: "Los Notros 123",
          flight: {
            scheduledAt: new Date("2026-11-15T15:45:00.000Z"),
            estimatedAt: null,
            status: "SCHEDULED"
          }
        }
      })
    );
    expect(voucher.rows[0].inicio).toBe("Aeropuerto Chapelco (CPC)");
    expect(voucher.rows[0].fin).toBe("Los Notros 123");
    expect(voucher.rows[0].fecha).toBe("15/11/2026");
    expect(voucher.rows[0].horario).toBe("12:45");
    expect(voucher.rows[0].observaciones).toContain("Vuelo AR1657");
  });

  it("calcula el saldo con lo efectivamente registrado y no con el total", () => {
    const voucher = buildVoucher(reserva({ totalCents: 4800000 }));
    expect(voucher.totalCents).toBe(4800000);
    expect(voucher.paidCents).toBe(2400000);
    expect(voucher.balanceCents).toBe(2400000);
  });

  it("no muestra importes en una reserva sin cargo por discapacidad", () => {
    const voucher = buildVoucher(
      reserva({
        totalCents: 0,
        payment: {
          provider: "disability_document",
          status: "APPROVED",
          amountCents: 0,
          amount: 0,
          currency: "ARS"
        }
      })
    );
    expect(voucher.noCharge).toBe(true);
    expect(voucher.totalCents).toBe(0);
    expect(voucher.balanceCents).toBe(0);
  });

  it("no deja saldo negativo si el pago supera el total", () => {
    const voucher = buildVoucher(
      reserva({
        totalCents: 100000,
        payment: { provider: "manual_transfer", status: "APPROVED", amountCents: 150000, amount: 1500, currency: "ARS" }
      })
    );
    expect(voucher.balanceCents).toBe(0);
  });

  it("trae los datos del pasajero y el derivado por", () => {
    const voucher = buildVoucher(reserva({ referredBy: "Voucher Sur" }));
    expect(voucher.passengerName).toBe("Mercedes Utrera");
    expect(voucher.document).toBe("DNI 30111222");
    expect(voucher.referredBy).toBe("Voucher Sur");
  });
});

describe("documento del pasajero en el voucher (#170)", () => {
  it("imprime tipo y número cuando la reserva lo tiene", () => {
    expect(buildVoucher(reserva()).document).toBe("DNI 30111222");
  });

  it("imprime «—» cuando la reserva anterior al DNI obligatorio lo tiene vacío", () => {
    const sinDocumento = buildVoucher(
      reserva({
        passenger: { ...reserva().passenger, documentType: "DNI", documentId: "" }
      })
    );
    expect(sinDocumento.document).toBe("—");
  });

  it("no inventa el tipo cuando el número viene sin tipo", () => {
    expect(documentoDelPasajero({ documentType: "", documentId: "30111222" })).toBe("30111222");
    expect(documentoDelPasajero({ documentType: "DNI", documentId: "   " })).toBe("—");
  });
});

describe("ida y vuelta en el voucher (#205)", () => {
  /** Una reserva de aeropuerto del viaje: el voucher sólo lee estos campos. */
  function tramo(overrides: {
    direction: "ARRIVAL" | "DEPARTURE";
    scheduledAt: string;
    flightNumber: string;
    code: string;
    shortCode: string;
    status?: string;
    totalCents?: number;
  }): ReservationDetailDto {
    return reserva({
      code: overrides.code,
      shortCode: overrides.shortCode,
      bookingMode: "AIRPORT",
      status: overrides.status ?? "CONFIRMED",
      totalCents: overrides.totalCents ?? 2400000,
      roundTripId: "19cbd714-0000-4000-8000-000000000000",
      airportDetails: {
        flightNumber: overrides.flightNumber,
        direction: overrides.direction,
        serviceDate: new Date(overrides.scheduledAt),
        pickupName: "Patagonia Plaza Hotel",
        pickupAddress: "Los Notros 123",
        flight: { scheduledAt: new Date(overrides.scheduledAt), estimatedAt: null, status: "SCHEDULED" }
      }
    });
  }

  const llegada = tramo({
    direction: "ARRIVAL",
    scheduledAt: "2026-11-18T19:05:00.000Z",
    flightNumber: "AR1658",
    code: "ARC-2611-479F2E07FE953CB7959469B1FC01D899",
    shortCode: "4ZQHGRKE",
    totalCents: 1200000
  });

  const salida = tramo({
    direction: "DEPARTURE",
    scheduledAt: "2026-11-20T16:50:00.000Z",
    flightNumber: "JA3184",
    code: "ARC-2611-1AA0C833E2BD0FAE73E4945A669E108E",
    shortCode: "KSRAMDMZ",
    totalCents: 1350000
  });

  it("imprime los dos tramos, ordenados por fecha, con llegada y salida", () => {
    const voucher = buildVoucher(llegada, { partner: salida });

    expect(voucher.rows).toHaveLength(2);
    expect(voucher.rows[0].tramo).toBe("Llegada");
    expect(voucher.rows[0].fecha).toBe("18/11/2026");
    expect(voucher.rows[0].horario).toBe("16:05");
    expect(voucher.rows[0].observaciones).toContain("Vuelo AR1658");

    expect(voucher.rows[1].tramo).toBe("Salida");
    expect(voucher.rows[1].fecha).toBe("20/11/2026");
    expect(voucher.rows[1].horario).toBe("13:50");
    expect(voucher.rows[1].observaciones).toContain("Vuelo JA3184");
    // El renglón del otro tramo dice de qué reserva es: es el dato que le falta al pasajero.
    expect(voucher.rows[1].observaciones).toContain("Reserva KSRAMDMZ");
  });

  it("ordena igual cuando el voucher abierto es el de la vuelta", () => {
    const voucher = buildVoucher(salida, { partner: llegada });

    expect(voucher.rows.map((row) => row.tramo)).toEqual(["Llegada", "Salida"]);
    expect(voucher.rows[0].observaciones).toContain("Reserva 4ZQHGRKE");
    // El renglón propio no se rotula con su propio código.
    expect(voucher.rows[1].observaciones).not.toContain("Reserva KSRAMDMZ");
  });

  it("mantiene los importes de la reserva abierta y avisa del otro tramo", () => {
    const voucher = buildVoucher(llegada, { partner: salida });

    expect(voucher.code).toBe(llegada.code);
    expect(voucher.totalCents).toBe(1200000);
    expect(voucher.roundTrip).toEqual({ code: salida.code, shortCode: "KSRAMDMZ", estado: "Confirmada" });
  });

  it("marca el tramo cancelado del viaje", () => {
    const cancelada = tramo({
      direction: "DEPARTURE",
      scheduledAt: "2026-11-20T16:50:00.000Z",
      flightNumber: "JA3184",
      code: salida.code,
      shortCode: salida.shortCode,
      status: "CANCELLED"
    });
    const voucher = buildVoucher(llegada, { partner: cancelada });

    expect(voucher.rows[1].observaciones).toContain("Cancelado");
    expect(voucher.roundTrip?.estado).toBe("Cancelada");
  });

  it("un tramo suelto sigue imprimiendo un solo renglón", () => {
    const voucher = buildVoucher(llegada);

    expect(voucher.rows).toHaveLength(1);
    expect(voucher.roundTrip).toBeNull();
    // En la reserva suelta no hay «otro tramo» que aclarar.
    expect(voucher.rows[0].observaciones).not.toContain("Reserva");
  });

  it("los servicios que no son del aeropuerto no llevan llegada ni salida", () => {
    const voucher = buildVoucher(reserva());

    expect(voucher.rows[0].tramo).toBeNull();
    expect(voucher.roundTrip).toBeNull();
  });
});

describe("link y mensaje del voucher", () => {
  it("arma el path con el código privado", () => {
    expect(voucherPath("ARC-2611-AAAA")).toBe("/reservas/ARC-2611-AAAA/voucher");
  });

  it("arma la URL absoluta sin duplicar la barra", () => {
    expect(absoluteUrl("/reservas/X/voucher", "https://araucana.example")).toBe("https://araucana.example/reservas/X/voucher");
    expect(absoluteUrl("/reservas/X/voucher", "https://araucana.example/")).toBe("https://araucana.example/reservas/X/voucher");
  });

  it("escribe el mensaje con el nombre, el código corto y el link", () => {
    const mensaje = voucherMessage({
      firstName: "Mercedes",
      shortCode: "ABCD-2345",
      url: "https://araucana.example/reservas/X/voucher"
    });
    expect(mensaje).toContain("Hola Mercedes");
    expect(mensaje).toContain("ABCD-2345");
    expect(mensaje).toContain("https://araucana.example/reservas/X/voucher");
  });

  it("usa un saludo neutro cuando no hay nombre", () => {
    expect(voucherMessage({ shortCode: "ABCD-2345", url: "u" }).startsWith("Hola, ")).toBe(true);
  });

  it("codifica el mensaje en el link de WhatsApp y devuelve null sin teléfono", () => {
    const link = whatsappShareUrl("+54 9 2974 046867", "Hola & chau");
    expect(link).toContain("https://wa.me/5492974046867?text=");
    expect(link).toContain(encodeURIComponent("Hola & chau"));
    expect(whatsappShareUrl("", "x")).toBeNull();
    expect(whatsappShareUrl(null, "x")).toBeNull();
  });
});

describe("formato de fechas del voucher", () => {
  it("lee las fechas de calendario en UTC", () => {
    expect(diaCalendario("2026-02-01T00:00:00.000Z")).toBe("01/02/2026");
  });

  it("traduce el estado de la reserva", () => {
    expect(estadoDelVoucher("CONFIRMED")).toBe("Confirmada");
    expect(estadoDelVoucher("CANCELLED")).toBe("Cancelada");
    expect(estadoDelVoucher("RARO")).toBe("RARO");
  });
});

// `Intl` separa el símbolo del número con un espacio duro (U+00A0): en el assert se normaliza para
// que el test hable de lo que importa —el código de moneda— y no del tipo de espacio.
const plano = (valor: string) => valor.replace(/\u00A0/g, " ");

describe("importeDelVoucher", () => {
  it("dice la moneda además del símbolo: el voucher circula fuera de la app", () => {
    expect(plano(importeDelVoucher(1200000, "ARS"))).toBe("$ 12.000 ARS");
  });

  it("no inventa el código cuando la reserva no lo trae", () => {
    expect(plano(importeDelVoucher(500000, ""))).toBe("$ 5.000 ARS");
    expect(plano(importeDelVoucher(500000, "pesos"))).toBe("$ 5.000 ARS");
  });

  it("respeta otra moneda si la reserva la tiene", () => {
    expect(importeDelVoucher(90000, "USD")).toContain("USD");
  });

  it("muestra el saldo en cero sin decimales de más", () => {
    expect(plano(importeDelVoucher(0, "ARS"))).toBe("$ 0 ARS");
  });
});

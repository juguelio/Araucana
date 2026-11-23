import { describe, expect, it } from "vitest";

import {
  annulServiceTicket,
  emitServiceTicket,
  ESTADO_ANULADO,
  ESTADO_EMITIDO,
  findServiceTicketByDisplayNumber,
  type ServiceTicketRecord,
  type TicketTransactionClient
} from "./service-tickets";

type FakeDb = {
  tx: TicketTransactionClient;
  tickets: ServiceTicketRecord[];
  counter: { nextNumber: number };
};

/**
 * Contador en memoria con la misma semántica que `UPDATE … RETURNING`: la fila se incrementa
 * antes de devolver el número, así que dos llamadas concurrentes no pueden leer el mismo valor.
 */
function fakeDb(options: { nextNumber?: number; series?: string } = {}): FakeDb {
  const counter = { nextNumber: options.nextNumber ?? 1 };
  const knownSeries = options.series ?? "W";
  const tickets: ServiceTicketRecord[] = [];

  const tx: TicketTransactionClient = {
    async $queryRaw<T>(_query: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      const series = String(values[0] ?? "");
      if (series !== knownSeries) return [] as unknown as T;
      const number = counter.nextNumber;
      counter.nextNumber += 1;
      return [{ id: "tkserie_w", series, number }] as unknown as T;
    },
    serviceTicket: {
      async findUnique({ where }) {
        if (where.reservationId) return tickets.find((t) => t.reservationId === where.reservationId) ?? null;
        if (where.series_number) {
          return (
            tickets.find((t) => t.series === where.series_number!.series && t.number === where.series_number!.number) ??
            null
          );
        }
        if (where.id) return tickets.find((t) => t.id === where.id) ?? null;
        return null;
      },
      async create({ data }) {
        const record = {
          annulledAt: null,
          annulledById: null,
          annulledByName: null,
          annulReason: null,
          createdAt: new Date("2026-11-23T01:00:00Z"),
          updatedAt: new Date("2026-11-23T01:00:00Z"),
          issuedById: null,
          issuedByName: null,
          departureAt: null,
          paymentMethod: null,
          currency: "ARS",
          issuedAt: new Date("2026-11-23T01:00:00Z"),
          status: ESTADO_EMITIDO,
          ...data
        } as unknown as ServiceTicketRecord;
        tickets.push(record);
        return record;
      },
      async update({ where, data }) {
        const index = tickets.findIndex((t) => t.id === where.id);
        if (index === -1) throw new Error("no existe");
        tickets[index] = { ...tickets[index], ...(data as Partial<ServiceTicketRecord>) };
        return tickets[index];
      }
    }
  };

  return { tx, tickets, counter };
}

const reserva = {
  bookingMode: "SEATED",
  origin: "San Martín de los Andes",
  destination: "Hua Hum",
  serviceDate: new Date("2027-01-05T00:00:00Z"),
  departureAt: new Date("2027-01-05T11:30:00Z"),
  fareCents: 1200000,
  currency: "ARS"
};

describe("emisión del boleto numerado", () => {
  it("emite el primer boleto de la serie web como W001", async () => {
    const db = fakeDb();
    const boleto = await emitServiceTicket(db.tx, { reservationId: "r1", ...reserva });

    expect(boleto?.displayNumber).toBe("W001");
    expect(boleto?.status).toBe(ESTADO_EMITIDO);
    expect(boleto?.number).toBe(1);
    expect(boleto?.origin).toBe("San Martín de los Andes");
    expect(db.counter.nextNumber).toBe(2);
  });

  it("continúa el correlativo entre reservas", async () => {
    const db = fakeDb({ nextNumber: 41 });
    const primero = await emitServiceTicket(db.tx, { reservationId: "r1", ...reserva });
    const segundo = await emitServiceTicket(db.tx, { reservationId: "r2", ...reserva });

    expect(primero?.displayNumber).toBe("W041");
    expect(segundo?.displayNumber).toBe("W042");
  });

  it("no consume dos números para la misma reserva", async () => {
    const db = fakeDb();
    const primero = await emitServiceTicket(db.tx, { reservationId: "r1", ...reserva });
    const repetido = await emitServiceTicket(db.tx, { reservationId: "r1", ...reserva });

    expect(repetido?.id).toBe(primero?.id);
    expect(db.tickets).toHaveLength(1);
    expect(db.counter.nextNumber).toBe(2);
  });

  it("da números distintos cuando dos emisiones llegan juntas", async () => {
    const db = fakeDb();
    const emitidos = await Promise.all([
      emitServiceTicket(db.tx, { reservationId: "r1", ...reserva }),
      emitServiceTicket(db.tx, { reservationId: "r2", ...reserva }),
      emitServiceTicket(db.tx, { reservationId: "r3", ...reserva })
    ]);

    expect(emitidos.map((boleto) => boleto?.displayNumber)).toEqual(["W001", "W002", "W003"]);
    expect(new Set(emitidos.map((boleto) => boleto?.displayNumber)).size).toBe(3);
  });

  it("no emite boleto numerado para aeropuerto ni Chapelco", async () => {
    const db = fakeDb();
    expect(await emitServiceTicket(db.tx, { reservationId: "a1", ...reserva, bookingMode: "AIRPORT" })).toBeNull();
    expect(await emitServiceTicket(db.tx, { reservationId: "c1", ...reserva, bookingMode: "CHAPELCO" })).toBeNull();
    expect(db.tickets).toHaveLength(0);
    expect(db.counter.nextNumber).toBe(1);
  });

  it("guarda quién emitió y con qué medio de pago", async () => {
    const db = fakeDb();
    const boleto = await emitServiceTicket(db.tx, {
      reservationId: "r1",
      ...reserva,
      paymentMethod: "EFECTIVO",
      issuedById: "u1",
      issuedByName: "Quique"
    });

    expect(boleto?.issuedByName).toBe("Quique");
    expect(boleto?.paymentMethod).toBe("EFECTIVO");
  });

  it("no emite un boleto sin origen ni destino", async () => {
    const db = fakeDb();
    await expect(emitServiceTicket(db.tx, { reservationId: "r1", ...reserva, origin: "  " })).rejects.toThrow(
      /origen y destino/
    );
    expect(db.counter.nextNumber).toBe(1);
  });

  it("falla si la serie no existe en vez de inventar un número", async () => {
    const db = fakeDb({ series: "X" });
    await expect(emitServiceTicket(db.tx, { reservationId: "r1", ...reserva })).rejects.toThrow(/"W"/);
    expect(db.tickets).toHaveLength(0);
  });
});

describe("anulación del boleto", () => {
  it("conserva el número y registra motivo, fecha y usuario", async () => {
    const db = fakeDb();
    await emitServiceTicket(db.tx, { reservationId: "r1", ...reserva });
    await emitServiceTicket(db.tx, { reservationId: "r2", ...reserva });

    const anulado = await annulServiceTicket(db.tx, {
      reservationId: "r1",
      reason: "El pasajero no viajó",
      annulledById: "u1",
      annulledByName: "Quique",
      now: new Date("2026-11-23T02:00:00Z")
    });

    expect(anulado.status).toBe(ESTADO_ANULADO);
    expect(anulado.displayNumber).toBe("W001");
    expect(anulado.annulReason).toBe("El pasajero no viajó");
    expect(anulado.annulledByName).toBe("Quique");

    // El siguiente boleto emitido no reutiliza el número anulado.
    const siguiente = await emitServiceTicket(db.tx, { reservationId: "r3", ...reserva });
    expect(siguiente?.displayNumber).toBe("W003");
  });

  it("exige un motivo", async () => {
    const db = fakeDb();
    await emitServiceTicket(db.tx, { reservationId: "r1", ...reserva });
    await expect(annulServiceTicket(db.tx, { reservationId: "r1", reason: "   " })).rejects.toThrow(/motivo/);
  });

  it("no cambia nada si el boleto ya estaba anulado", async () => {
    const db = fakeDb();
    await emitServiceTicket(db.tx, { reservationId: "r1", ...reserva });
    const primera = await annulServiceTicket(db.tx, { reservationId: "r1", reason: "no viajó" });
    const segunda = await annulServiceTicket(db.tx, { reservationId: "r1", reason: "otro motivo" });

    expect(segunda.annulReason).toBe(primera.annulReason);
  });

  it("avisa si la reserva no tiene boleto", async () => {
    const db = fakeDb();
    await expect(annulServiceTicket(db.tx, { reservationId: "fantasma", reason: "x" })).rejects.toThrow(/no tiene boleto/);
  });
});

describe("búsqueda por el número que muestra el pasajero", () => {
  it("encuentra el boleto con el texto del pasajero", async () => {
    const db = fakeDb();
    await emitServiceTicket(db.tx, { reservationId: "r1", ...reserva });

    expect((await findServiceTicketByDisplayNumber(db.tx, " w001 "))?.reservationId).toBe("r1");
  });

  it("devuelve null si el texto no es un número de boleto", async () => {
    const db = fakeDb();
    expect(await findServiceTicketByDisplayNumber(db.tx, "ARC-1234")).toBeNull();
  });
});

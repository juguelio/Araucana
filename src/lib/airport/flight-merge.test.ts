import { beforeEach, expect, it, vi } from "vitest";
import { unificarFilasDeVuelo } from "./flight-merge";

const db = vi.hoisted(() => ({
  findMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), $queryRaw: vi.fn()
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    flightObservation: { findMany: async () => [] },
    $transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({
      $queryRaw: db.$queryRaw, flight: db, flightEvent: { findMany: async () => [] }
    })
  }
}));

const horario = new Date("2026-10-03T17:00:00Z");
const consulta = new Date("2026-10-03T16:00:00Z");
const publicado = {
  id: "publicado", number: "JA3182", direction: "ARRIVAL", source: "JA_OFICIAL",
  origin: "AEP", destination: "CPC", scheduledAt: horario, updatedAt: horario,
  status: "SCHEDULED", lastCheckedAt: null, estimatedAt: null, actualAt: null
};
const tablero = {
  ...publicado, id: "tablero", number: "WJ3182", source: "FIDS", scheduledAt: consulta,
  lastCheckedAt: consulta, origin: "Buenos Aires", status: "CANCELLED"
};
beforeEach(() => {
  vi.clearAllMocks();
  db.deleteMany.mockResolvedValue({ count: 1 });
});

it.each(["tablero", "publicado"])("conserva la reserva en %s, el horario publicado y la cancelación operativa", async (conReserva) => {
  db.findMany.mockResolvedValue([publicado, tablero].map(f => ({
    ...f, _count: { reservations: Number(f.id === conReserva), assignments: 0 }
  })));
  const descartado = conReserva === "tablero" ? "publicado" : "tablero";
  await unificarFilasDeVuelo(["tablero", "publicado"], [descartado]);
  expect(db.deleteMany.mock.calls[0][0].where).toEqual({
    id: descartado, reservations: { none: {} }, assignments: { none: {} }
  });
  expect(db.update.mock.calls[0][0]).toMatchObject({
    where: { id: conReserva },
    data: { scheduledAt: horario, source: "JA_OFICIAL", origin: "AEP", status: "CANCELLED", lastCheckedAt: consulta }
  });
});

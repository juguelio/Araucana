import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeparturePassengerInput } from "./validation";

const mocks = {
  transaction: vi.fn(),
  findUniqueSheet: vi.fn(),
  lockSheet: vi.fn(),
  findUniqueReservation: vi.fn(),
  upsertSheet: vi.fn()
};

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    departureSheet: {
      findUnique: (...args: unknown[]) => mocks.findUniqueSheet(...args),
      upsert: (...args: unknown[]) => mocks.upsertSheet(...args)
    },
    reservation: { findUnique: (...args: unknown[]) => mocks.findUniqueReservation(...args) },
    $transaction: (...args: unknown[]) => mocks.transaction(...args)
  }
}));

const { DepartureSheetError, ensureDepartureSheet, getDepartureSheetByToken, submitDepartureSheetPassenger } = await import("./repository");

const TOKEN = "PLN-0123456789ABCDEF0123456789ABCDEF";

const pasajero: DeparturePassengerInput = {
  firstName: "Ana",
  lastName: "Pérez",
  documentType: "DNI",
  documentNumber: "30111222",
  sex: "F",
  birthDate: new Date("1985-04-12T15:00:00.000Z"),
  nationality: "Argentina",
  occupation: null,
  residenceCountry: null
};

function fakeTx({
  sheet = { id: "planilla-1", token: TOKEN, isOpen: true, kind: "DUT" },
  existing = null,
  maxPosition = 0
}: {
  sheet?: { id: string; token: string; isOpen: boolean; kind: string } | null;
  existing?: { id: string } | null;
  maxPosition?: number;
} = {}) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "pax-nuevo", ...data }));
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "pax-existente", ...data }));

  return {
    create,
    update,
    tx: {
      $queryRaw: (...args: unknown[]) => mocks.lockSheet(...args),
      departureSheet: { findUnique: async () => sheet },
      departureSheetPassenger: {
        findUnique: async () => existing,
        aggregate: async () => ({ _max: { position: maxPosition } }),
        create,
        update
      }
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    const { tx } = fakeTx();
    return callback(tx);
  });
});

describe("link de la planilla de una reserva", () => {
  it("crea el link la primera vez, atado a la reserva", async () => {
    mocks.findUniqueReservation.mockResolvedValue({ id: "res-1" });
    mocks.upsertSheet.mockResolvedValue({ id: "planilla-1", token: TOKEN });

    const sheet = await ensureDepartureSheet("arc-2611-abc", "DUT", "user-1");

    expect(mocks.findUniqueReservation).toHaveBeenCalledWith({
      where: { code: "ARC-2611-ABC" },
      select: { id: true }
    });
    expect(mocks.upsertSheet).toHaveBeenCalledWith({
      where: { reservationId_kind: { reservationId: "res-1", kind: "DUT" } },
      update: {},
      create: expect.objectContaining({
        reservationId: "res-1",
        kind: "DUT",
        token: expect.stringMatching(/^PLN-[A-F0-9]{32}$/),
        createdBy: "user-1"
      })
    });
    expect(sheet).toMatchObject({ id: "planilla-1" });
  });

  it("reusa el link si la planilla ya existía", async () => {
    mocks.findUniqueReservation.mockResolvedValue({ id: "res-1" });
    mocks.upsertSheet.mockResolvedValue({ id: "planilla-1", token: TOKEN });

    await ensureDepartureSheet("ARC-2611-ABC", "PROVINCIA");

    expect(mocks.upsertSheet).toHaveBeenCalledWith({
      where: { reservationId_kind: { reservationId: "res-1", kind: "PROVINCIA" } },
      update: {},
      create: expect.objectContaining({ kind: "PROVINCIA" })
    });
  });

  it("no genera link para una reserva que no existe", async () => {
    mocks.findUniqueReservation.mockResolvedValue(null);

    await expect(ensureDepartureSheet("ARC-2611-NADA", "DUT")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.upsertSheet).not.toHaveBeenCalled();
  });
});

describe("link público de la planilla", () => {
  it("no consulta la base con un token mal formado", async () => {
    await expect(getDepartureSheetByToken("PLN-CORTO")).resolves.toBeNull();
    expect(mocks.findUniqueSheet).not.toHaveBeenCalled();
  });

  it("busca por token normalizado en mayúsculas", async () => {
    mocks.findUniqueSheet.mockResolvedValue({ id: "planilla-1" });

    await getDepartureSheetByToken(TOKEN.toLowerCase());

    expect(mocks.findUniqueSheet).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: TOKEN } })
    );
  });

  it("rechaza el alta con un token mal formado", async () => {
    await expect(submitDepartureSheetPassenger("PLN-CORTO", pasajero)).rejects.toBeInstanceOf(DepartureSheetError);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("alta de un pasajero desde el link", () => {
  it("no acepta datos si la planilla está cerrada", async () => {
    const { tx } = fakeTx({ sheet: { id: "planilla-1", token: TOKEN, isOpen: false, kind: "DUT" } });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx));

    await expect(submitDepartureSheetPassenger(TOKEN, pasajero)).rejects.toMatchObject({ code: "CLOSED" });
  });

  it("asigna el Nº siguiente al último cargado", async () => {
    const { tx, create } = fakeTx({ maxPosition: 4 });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx));

    const result = await submitDepartureSheetPassenger(TOKEN, pasajero);

    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ sheetId: "planilla-1", position: 5 }) });
    expect(result.updated).toBe(false);
  });

  it("actualiza la fila si el documento ya está en la planilla", async () => {
    const { tx, create, update } = fakeTx({ existing: { id: "pax-existente" } });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx));

    const result = await submitDepartureSheetPassenger(TOKEN, { ...pasajero, firstName: "Ana María" });

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: "pax-existente" },
      data: expect.objectContaining({ firstName: "Ana María" })
    });
    expect(result.updated).toBe(true);
  });

  it("bloquea la planilla antes de contar los pasajeros", async () => {
    const { tx } = fakeTx({ maxPosition: 1 });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx));

    await submitDepartureSheetPassenger(TOKEN, pasajero);

    expect(mocks.lockSheet).toHaveBeenCalled();
  });
});

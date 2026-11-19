import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  admin: vi.fn(),
  manage: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({
  getCurrentReservationsUserOrRedirect: m.user,
  getCurrentAdminOrRedirect: m.admin
}));
vi.mock("@/lib/payments/receipt-upload", () => ({ uploadReservationReceipt: vi.fn() }));
vi.mock("@/lib/payments/receipt-storage", () => ({ validateReceiptFile: vi.fn(() => null) }));
vi.mock("@/lib/booking/repository", () => ({
  BookingError: class BookingError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
  reviewDisabilityDocument: vi.fn(),
  approveManualPayment: vi.fn(),
  rejectManualPayment: vi.fn(),
  createWebReservation: vi.fn()
}));
vi.mock("@/lib/booking/admin-management", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/booking/admin-management")>()),
  manageReservation: m.manage
}));

import { BookingError } from "@/lib/booking/repository";
import { updateReservationAction } from "./actions";

const code = "ARC-2611-TEST";
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};
const initial = { status: "idle" as const, message: "", fieldErrors: {} };

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "user-1", name: "Vale", email: "vale@example.com", role: "SECRETARY" });
  m.manage.mockResolvedValue({ receiptPath: null });
});

describe("editar la cantidad y los adicionales desde el panel (#267)", () => {
  it("manda la cantidad y el equipaje al comando de edición", async () => {
    await updateReservationAction(initial, form({
      code,
      passengerCount: "3",
      sportsLuggageCount: "2",
      acknowledgeTotalChange: "on"
    }));

    expect(m.manage).toHaveBeenCalledWith(code, expect.objectContaining({
      operation: "edit",
      passengerCount: 3,
      sportsLuggageCount: 2,
      acknowledgeTotalChange: true
    }), expect.objectContaining({ id: "user-1" }));
  });

  it("devuelve en el campo de la cantidad el error de cupo", async () => {
    m.manage.mockRejectedValue(new BookingError("CAPACITY_FULL", "No hay lugar en esa salida: quedan 2 lugares."));

    const result = await updateReservationAction(initial, form({ code, passengerCount: "5" }));

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { passengerCount: "No hay lugar en esa salida: quedan 2 lugares." }
    });
  });

  it("no manda al servidor una cantidad imposible", async () => {
    const result = await updateReservationAction(initial, form({ code, passengerCount: "0" }));

    expect(result).toMatchObject({ status: "error", fieldErrors: { passengerCount: expect.stringContaining("al menos un pasajero") } });
    expect(m.manage).not.toHaveBeenCalled();
  });

  it("sin cambios no llama a la edición", async () => {
    const result = await updateReservationAction(initial, form({ code }));

    expect(result).toMatchObject({ status: "error", message: "No hay cambios para guardar." });
    expect(m.manage).not.toHaveBeenCalled();
  });
});

describe("editar menores, bajada y nombre del lugar", () => {
  it("manda los campos nuevos al comando, la bajada aunque esté vacía", async () => {
    await updateReservationAction(initial, form({
      code, halfFareCount: "1", freeFareCount: "0", dropoffStop: "", pickupName: "Hostería del Lago"
    }));

    expect(m.manage).toHaveBeenCalledWith(code, expect.objectContaining({
      operation: "edit", halfFareCount: 1, freeFareCount: 0, dropoffStop: "", pickupName: "Hostería del Lago"
    }), expect.anything());
  });

  it("devuelve el error de menores en su campo y el de la parada en la bajada", async () => {
    m.manage.mockRejectedValueOnce(new BookingError("INVALID_PASSENGER_COUNT", "Tiene que haber al menos un pasajero de tarifa entera."));
    expect(await updateReservationAction(initial, form({ code, halfFareCount: "2" })))
      .toMatchObject({ fieldErrors: { halfFareCount: expect.stringContaining("tarifa entera") } });

    m.manage.mockRejectedValueOnce(new BookingError("STOP_NOT_AVAILABLE", "Esa parada no está entre las paradas con tarifa de la ruta."));
    expect(await updateReservationAction(initial, form({ code, dropoffStop: "Junín" })))
      .toMatchObject({ fieldErrors: { dropoffStop: expect.stringContaining("parada") } });
  });
});

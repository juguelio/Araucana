import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteUnoccupiedFlight } from "./flight-cleanup";

const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  deleteMany: vi.fn(),
  transaction: vi.fn()
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lock.mockResolvedValue([{ id: "flight" }]);
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (run) => run({
    $queryRaw: mocks.lock,
    flight: { deleteMany: mocks.deleteMany }
  }));
});

describe("deleteUnoccupiedFlight", () => {
  it("bloquea la fila antes de comprobar las relaciones y borrar", async () => {
    expect(await deleteUnoccupiedFlight("flight")).toBe(1);
    const [sql, id] = mocks.lock.mock.calls[0];
    expect(sql.join("?")).toContain('FROM "Flight" WHERE id = ? FOR UPDATE');
    expect(id).toBe("flight");
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteMany.mock.invocationCallOrder[0]);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "ReadCommitted" });
  });

  it("revisa reservas y combis en una sentencia posterior al bloqueo", async () => {
    await deleteUnoccupiedFlight("flight");
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { id: "flight", reservations: { none: {} }, assignments: { none: {} } }
    });
  });

  it("no borra si otra transacción dejó una reserva o combi", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    expect(await deleteUnoccupiedFlight("flight")).toBe(0);
  });

  it("tolera que otro sync ya haya borrado la fila", async () => {
    mocks.lock.mockResolvedValue([]);
    expect(await deleteUnoccupiedFlight("flight")).toBe(0);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("propaga un fallo del bloqueo sin intentar borrar", async () => {
    mocks.lock.mockRejectedValue(new Error("lock timeout"));
    await expect(deleteUnoccupiedFlight("flight")).rejects.toThrow("lock timeout");
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});

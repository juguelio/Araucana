import { beforeEach, expect, it, vi } from "vitest";
import { addTripPayment, saveTrip } from "./actions";
import { emptyLeg, tripPaymentTotals, type PaymentInput } from "@/lib/special-trips/data";

const db = vi.hoisted(() => ({
  lock: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  audit: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      $queryRaw: db.lock,
      specialTrip: { findUnique: db.findUnique, update: db.update, create: db.create },
      user: { count: async () => 0, findMany: async () => [] },
      vehicle: { count: async () => 0, findMany: async () => [] }
    })
  }
}));
vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: async () => ({ id: "operador" }) }));
vi.mock("@/lib/audit/entity", () => ({ recordEntityAudit: db.audit, listChange: () => null }));
vi.mock("@/lib/special-trips/conflicts", () => ({
  lockFleet: async () => {}, fleetConflicts: async () => [], conflictKey: () => "", recordAcceptance: async () => {}
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));

const operationId = "05b75170-fdfc-45a7-9874-cb57ffeed2d5";
const deposit: PaymentInput = { date: "", amount: "300.00", note: "Seña importada" };

function paymentForm(amount: string, currency = "ARS") {
  const data = new FormData();
  data.set("date", "2026-11-22");
  data.set("kind", "PAYMENT");
  data.set("currency", currency);
  data.set("amount", amount);
  data.set("note", "");
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  db.findUnique.mockResolvedValue({ client: "Grupo", currency: "ARS", totalCents: 100_000, payments: [deposit] });
});

it("guarda un viaje de varios días con recorridos, contacto y seña", async () => {
  db.create.mockResolvedValue({ id: "viaje", client: "Grupo" });
  const legs = [
    { ...emptyLeg, origin: "San Martín", destination: "Lago Puelo", stops: "El Bolsón\nCerro Radal" },
    { ...emptyLeg, origin: "Lago Puelo", destination: "El Hoyo", points: [
      { name: "Puerto Patriada", date: "2026-12-02", amount: "12500,50" },
      { name: "Cascada Corbata Blanca", date: "", amount: "" }
    ] },
    { ...emptyLeg, origin: "El Hoyo", destination: "San Martín" }
  ];
  const payments = [{ date: "2026-11-22", amount: "300.00", kind: "DEPOSIT", note: "" }];
  const form = new FormData();
  for (const [key, value] of Object.entries({
    client: "Grupo", contactName: "Ana", contactPhone: "+54 9 2944 123456", serviceDate: "2026-12-01",
    endDate: "2026-12-04", status: "PENDING", billingMode: "FIXED", currency: "ARS", total: "1000",
    legs: JSON.stringify(legs), assignments: "[]", payments: JSON.stringify(payments)
  })) form.set(key, value);

  await expect(saveTrip(null, null, {}, form)).rejects.toThrow("?guardado=1");
  expect(db.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    contactName: "Ana", contactPhone: "+54 9 2944 123456", serviceDate: new Date("2026-12-01T00:00:00Z"),
    endDate: new Date("2026-12-04T00:00:00Z"), totalCents: 100_000, legs, payments
  }) });
  expect(tripPaymentTotals(100_000, db.create.mock.calls[0][0].data.payments).balance).toBe(70_000);
});

it("agrega un pago al saldo de una seña importada sin sobrescribirla", async () => {
  await expect(addTripPayment("viaje", operationId, {}, paymentForm("700"))).rejects.toThrow("?cobro=1#facturacion");
  expect(db.lock).toHaveBeenCalledBefore(db.findUnique);
  expect(db.update).toHaveBeenCalledWith({ where: { id: "viaje" }, data: { payments: [
    deposit, { id: operationId, kind: "PAYMENT", date: "2026-11-22", amount: "700.00", note: "" }
  ] } });
  const payments = db.update.mock.calls[0][0].data.payments;
  expect(tripPaymentTotals(100_000, payments)).toEqual({ paid: 100_000, balance: 0 });
});

it("rechaza un pago excesivo o que quedó abierto con una moneda vieja", async () => {
  await expect(addTripPayment("viaje", operationId, {}, paymentForm("700,01"))).resolves.toEqual({ error: "El cobro supera el saldo pendiente." });
  await expect(addTripPayment("viaje", operationId, {}, paymentForm("10", "USD"))).resolves.toEqual({ error: "La moneda del viaje cambió. Volvé a abrir la ficha." });
  expect(db.update).not.toHaveBeenCalled();
});

it("tolera repetir la misma operación después de que ya se registró", async () => {
  db.findUnique.mockResolvedValue({ client: "Grupo", currency: "ARS", totalCents: 100_000, payments: [
    deposit, { id: operationId, kind: "PAYMENT", date: "2026-11-22", amount: "700.00", note: "" }
  ] });
  await expect(addTripPayment("viaje", operationId, {}, paymentForm("700"))).rejects.toThrow("?cobro=1#facturacion");
  expect(db.update).not.toHaveBeenCalled();
  expect(db.audit).not.toHaveBeenCalled();
});

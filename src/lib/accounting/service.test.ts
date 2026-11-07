import { describe, expect, it } from "vitest";
import {
  buildAccountingReport,
  createMonthPeriod,
  createRangePeriod,
  parseAccountingEntryInput,
  reservationToIncome
} from "./service";
import type { AccountingExpenseRecord, AccountingReservationRecord } from "./types";

const vehicle = { id: "veh-1", name: "Araucana 24" };
const route = { from: "San Martin", to: "Bariloche" };
const schedule = { id: "sched-1", vehicle, route };

function reservation(overrides: Partial<AccountingReservationRecord>): AccountingReservationRecord {
  return {
    id: "res-1",
    code: "ARC-1",
    status: "PENDING_PAYMENT",
    totalCents: 100_000,
    currency: "ARS",
    createdAt: new Date("2026-05-03T12:00:00.000Z"),
    payment: null,
    schedule,
    ...overrides
  };
}

function expense(overrides: Partial<AccountingExpenseRecord>): AccountingExpenseRecord {
  return {
    id: "entry-1",
    category: "FUEL",
    amountCents: 50_000,
    currency: "ARS",
    occurredAt: new Date("2026-05-04T12:00:00.000Z"),
    salaryPeriod: null,
    notes: null,
    vehicle,
    user: null,
    ...overrides
  };
}

describe("accounting service", () => {
  it("creates an inclusive month period", () => {
    const period = createMonthPeriod("2026-05");

    expect(period.from.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(period.to.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(period.label).toBe("Mayo 2026");
  });

  it("creates an inclusive custom range period", () => {
    const period = createRangePeriod("2026-05-10", "2026-05-12");

    expect(period.from.toISOString()).toBe("2026-05-10T00:00:00.000Z");
    expect(period.to.toISOString()).toBe("2026-05-13T00:00:00.000Z");
  });

  it("turns approved payments into automatic income", () => {
    const income = reservationToIncome(reservation({
      payment: {
        status: "APPROVED",
        updatedAt: new Date("2026-05-05T09:00:00.000Z")
      }
    }));

    expect(income).toMatchObject({
      id: "res-1",
      source: "reservation",
      amountCents: 100_000,
      vehicleId: "veh-1",
      vehicleName: "Araucana 24",
      description: "ARC-1 · San Martin a Bariloche"
    });
    expect(income?.occurredAt.toISOString()).toBe("2026-05-05T09:00:00.000Z");
  });

  it("turns confirmed reservations without approved payments into automatic income", () => {
    const income = reservationToIncome(reservation({ status: "CONFIRMED" }));

    expect(income?.occurredAt.toISOString()).toBe("2026-05-03T12:00:00.000Z");
  });

  it("excludes pending or cancelled reservations without approved payments", () => {
    expect(reservationToIncome(reservation({ status: "PENDING_PAYMENT" }))).toBeNull();
    expect(reservationToIncome(reservation({ status: "CANCELLED" }))).toBeNull();
  });

  it("builds totals and report groups", () => {
    const report = buildAccountingReport({
      reservations: [
        reservation({
          id: "res-1",
          totalCents: 120_000,
          payment: { status: "APPROVED", updatedAt: new Date("2026-05-03T12:00:00.000Z") }
        }),
        reservation({
          id: "res-2",
          status: "PENDING_PAYMENT",
          totalCents: 80_000
        })
      ],
      expenses: [
        expense({ id: "fuel", category: "FUEL", amountCents: 40_000 }),
        expense({
          id: "salary",
          category: "DRIVER_SALARY",
          amountCents: 70_000,
          vehicle: null,
          user: { id: "user-1", name: "Chofer", email: "chofer@araucana.com", role: "DRIVER" }
        })
      ]
    });

    expect(report.totals).toEqual({
      incomeCents: 120_000,
      expenseCents: 110_000,
      balanceCents: 10_000
    });
    expect(report.incomeByVehicle).toEqual([
      { id: "veh-1", label: "Araucana 24", amountCents: 120_000, currency: "ARS" }
    ]);
    expect(report.expensesByVehicle).toEqual([
      { id: "veh-1", label: "Araucana 24", amountCents: 40_000, currency: "ARS" }
    ]);
    expect(report.expensesByCategory).toEqual([
      { id: "DRIVER_SALARY", label: "Sueldo chofer", amountCents: 70_000, currency: "ARS" },
      { id: "FUEL", label: "Nafta", amountCents: 40_000, currency: "ARS" }
    ]);
    expect(report.salariesByPerson).toEqual([
      { id: "user-1", label: "Chofer", amountCents: 70_000, currency: "ARS" }
    ]);
  });

  it("no suma monedas distintas dentro de un mismo grupo", () => {
    const report = buildAccountingReport({
      reservations: [],
      expenses: [
        expense({ id: "entry-ars", category: "FUEL", amountCents: 50_000, currency: "ARS" }),
        expense({ id: "entry-usd", category: "FUEL", amountCents: 30_000, currency: "USD" })
      ]
    });

    expect(report.expensesByCategory).toEqual([
      { id: "FUEL", label: "Nafta", amountCents: 50_000, currency: "ARS" },
      { id: "FUEL", label: "Nafta", amountCents: 30_000, currency: "USD" }
    ]);
    expect(report.expensesByVehicle).toEqual([
      { id: "veh-1", label: "Araucana 24", amountCents: 50_000, currency: "ARS" },
      { id: "veh-1", label: "Araucana 24", amountCents: 30_000, currency: "USD" }
    ]);
  });

  it("validates salary payments with user and monthly period", () => {
    const parsed = parseAccountingEntryInput({
      category: "DRIVER_SALARY",
      amount: "125000",
      occurredAt: "2026-05-10",
      userId: "user-1",
      salaryPeriod: "2026-05"
    });

    expect(parsed).toMatchObject({
      category: "DRIVER_SALARY",
      amountCents: 12_500_000,
      userId: "user-1",
      salaryPeriod: "2026-05"
    });
  });

  it("rejects invalid accounting entries", () => {
    expect(() => parseAccountingEntryInput({
      category: "DRIVER_SALARY",
      amount: "0",
      occurredAt: "",
      userId: "",
      salaryPeriod: ""
    })).toThrow("Ingresa un monto mayor a cero.");

    expect(() => parseAccountingEntryInput({
      category: "FUEL",
      amount: "10000",
      occurredAt: "not-a-date"
    })).toThrow("Ingresa una fecha valida.");
  });
});

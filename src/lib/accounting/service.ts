import { prisma } from "@/lib/db/prisma";
import { createMonthPeriod, createRangePeriod, isWithinPeriod } from "./period";
import {
  ACCOUNTING_CATEGORIES,
  ACCOUNTING_CATEGORY_LABELS,
  type AccountingCategory,
  type AccountingEntryInput,
  type AccountingExpenseRecord,
  type AccountingGroup,
  type AccountingPeriod,
  type AccountingReport,
  type AccountingReservationRecord
} from "./types";

export { createMonthPeriod, createRangePeriod };

const SALARY_CATEGORIES = new Set<AccountingCategory>(["SECRETARY_SALARY", "DRIVER_SALARY"]);

function isAccountingCategory(value: string): value is AccountingCategory {
  return ACCOUNTING_CATEGORIES.includes(value as AccountingCategory);
}

function parseCurrencyToCents(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Ingresa un monto mayor a cero.");
  }

  return Math.round(amount * 100);
}

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (!value || Number.isNaN(date.getTime())) {
    throw new Error("Ingresa una fecha valida.");
  }

  return date;
}

function formatPerson(user: AccountingExpenseRecord["user"]) {
  return user?.name || user?.email || "Sin usuario";
}

function groupAdd(
  groups: Map<string, AccountingGroup>,
  id: string,
  label: string,
  amountCents: number,
  currency: string
) {
  // La clave incluye la moneda: nunca se suman pesos con dólares.
  const moneda = currency || "ARS";
  const clave = `${id}\u001f${moneda}`;
  const current = groups.get(clave);

  if (current) {
    current.amountCents += amountCents;
    return;
  }

  groups.set(clave, { id, label, amountCents, currency: moneda });
}

function sortedGroups(groups: Map<string, AccountingGroup>) {
  return Array.from(groups.values()).sort((left, right) => {
    if (right.amountCents !== left.amountCents) {
      return right.amountCents - left.amountCents;
    }

    return left.label.localeCompare(right.label, "es");
  });
}

export function reservationToIncome(reservation: AccountingReservationRecord) {
  const approvedPayment = reservation.payment?.status === "APPROVED" ? reservation.payment : null;
  const isConfirmed = reservation.status === "CONFIRMED";

  if (reservation.totalCents === 0 || (!approvedPayment && !isConfirmed)) {
    return null;
  }

  return {
    id: reservation.id,
    source: "reservation" as const,
    code: reservation.code,
    description: `${reservation.code} · ${reservation.schedule?.route.from ?? reservation.route?.from ?? "Ruta"} a ${
      reservation.schedule?.route.to ?? reservation.route?.to ?? "sin datos"
    }`,
    amountCents: reservation.totalCents,
    currency: reservation.currency,
    occurredAt: approvedPayment ? approvedPayment.updatedAt : reservation.createdAt,
    vehicleId: reservation.schedule?.vehicle.id ?? "sin-nave",
    vehicleName: reservation.schedule?.vehicle.name ?? "Sin nave asignada"
  };
}

export function buildAccountingReport(input: {
  reservations: AccountingReservationRecord[];
  expenses: AccountingExpenseRecord[];
  period?: AccountingPeriod;
}): AccountingReport {
  const period = input.period;
  const incomes = input.reservations
    .map(reservationToIncome)
    .filter((income): income is NonNullable<ReturnType<typeof reservationToIncome>> => {
      return Boolean(income && (!period || isWithinPeriod(income.occurredAt, period)));
    });

  const expenses = period
    ? input.expenses.filter((entry) => isWithinPeriod(entry.occurredAt, period))
    : input.expenses;

  const incomeByVehicle = new Map<string, AccountingGroup>();
  const expensesByVehicle = new Map<string, AccountingGroup>();
  const expensesByCategory = new Map<string, AccountingGroup>();
  const salariesByPerson = new Map<string, AccountingGroup>();

  let incomeCents = 0;
  let expenseCents = 0;

  for (const income of incomes) {
    incomeCents += income.amountCents;
    groupAdd(incomeByVehicle, income.vehicleId, income.vehicleName, income.amountCents, income.currency);
  }

  for (const expense of expenses) {
    expenseCents += expense.amountCents;

    if (expense.vehicle) {
      groupAdd(expensesByVehicle, expense.vehicle.id, expense.vehicle.name, expense.amountCents, expense.currency);
    }

    const category = isAccountingCategory(expense.category) ? expense.category : "OTHER";
    groupAdd(expensesByCategory, category, ACCOUNTING_CATEGORY_LABELS[category], expense.amountCents, expense.currency);

    if (SALARY_CATEGORIES.has(category) && expense.user) {
      groupAdd(salariesByPerson, expense.user.id, formatPerson(expense.user), expense.amountCents, expense.currency);
    }
  }

  return {
    incomes,
    expenses,
    totals: {
      incomeCents,
      expenseCents,
      balanceCents: incomeCents - expenseCents
    },
    incomeByVehicle: sortedGroups(incomeByVehicle),
    expensesByVehicle: sortedGroups(expensesByVehicle),
    expensesByCategory: sortedGroups(expensesByCategory),
    salariesByPerson: sortedGroups(salariesByPerson)
  };
}

export function parseAccountingEntryInput(input: {
  category?: string;
  amount?: string;
  occurredAt?: string;
  vehicleId?: string;
  userId?: string;
  salaryPeriod?: string;
  notes?: string;
}): AccountingEntryInput {
  const category = input.category?.trim() ?? "";

  if (!isAccountingCategory(category)) {
    throw new Error("Elegí una categoria valida.");
  }

  const parsed: AccountingEntryInput = {
    category,
    amountCents: parseCurrencyToCents(input.amount ?? ""),
    currency: "ARS",
    occurredAt: parseDate(input.occurredAt ?? ""),
    vehicleId: input.vehicleId?.trim() || undefined,
    userId: input.userId?.trim() || undefined,
    salaryPeriod: input.salaryPeriod?.trim() || undefined,
    notes: input.notes?.trim() || undefined
  };

  if (SALARY_CATEGORIES.has(category)) {
    if (!parsed.userId) {
      throw new Error("Elegí a quien se le paga el sueldo.");
    }

    if (!parsed.salaryPeriod || !/^\d{4}-\d{2}$/.test(parsed.salaryPeriod)) {
      throw new Error("Elegí el periodo del sueldo.");
    }
  }

  return parsed;
}

export async function createAccountingEntry(input: AccountingEntryInput) {
  return prisma.accountingEntry.create({
    data: input
  });
}

export async function getAccountingReport(options: {
  period: AccountingPeriod;
  vehicleId?: string;
}) {
  const [reservations, expenses] = await Promise.all([
    prisma.reservation.findMany({
      // Sólo las del período, con la misma fecha que usa reservationToIncome: la aprobación del pago
      // o, si se confirmó sin pago aprobado, la creación. Antes traía todas las reservas confirmadas
      // de la historia y filtraba acá: crece con cada temporada. El filtro de buildAccountingReport sigue.
      where: {
        OR: [
          {
            payment: {
              status: "APPROVED",
              updatedAt: { gte: options.period.from, lt: options.period.to }
            }
          },
          {
            status: "CONFIRMED",
            createdAt: { gte: options.period.from, lt: options.period.to },
            OR: [{ payment: { is: null } }, { payment: { status: { not: "APPROVED" } } }]
          }
        ],
        ...(options.vehicleId ? { schedule: { vehicleId: options.vehicleId } } : {})
      },
      include: {
        payment: {
          select: {
            status: true,
            updatedAt: true
          }
        },
        route: {
          select: {
            from: true,
            to: true
          }
        },
        schedule: {
          include: {
            vehicle: {
              select: {
                id: true,
                name: true
              }
            },
            route: {
              select: {
                from: true,
                to: true
              }
            }
          }
        }
      }
    }),
    prisma.accountingEntry.findMany({
      where: {
        occurredAt: {
          gte: options.period.from,
          lt: options.period.to
        },
        ...(options.vehicleId ? { vehicleId: options.vehicleId } : {})
      },
      orderBy: {
        occurredAt: "desc"
      },
      include: {
        vehicle: {
          select: {
            id: true,
            name: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    })
  ]);

  return buildAccountingReport({
    reservations,
    expenses,
    period: options.period
  });
}

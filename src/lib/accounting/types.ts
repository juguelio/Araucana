export const ACCOUNTING_CATEGORIES = [
  "SECRETARY_SALARY",
  "DRIVER_SALARY",
  "REPAIR",
  "FUEL",
  "INSURANCE",
  "TOLL",
  "CLEANING",
  "OTHER"
] as const;

export type AccountingCategory = (typeof ACCOUNTING_CATEGORIES)[number];

export const ACCOUNTING_CATEGORY_LABELS: Record<AccountingCategory, string> = {
  SECRETARY_SALARY: "Sueldo secretaria",
  DRIVER_SALARY: "Sueldo chofer",
  REPAIR: "Arreglo",
  FUEL: "Nafta",
  INSURANCE: "Seguro",
  TOLL: "Peaje",
  CLEANING: "Limpieza",
  OTHER: "Otros"
};

export const EXPENSE_CATEGORIES = [
  "REPAIR",
  "FUEL",
  "INSURANCE",
  "TOLL",
  "CLEANING",
  "OTHER"
] as const satisfies AccountingCategory[];

export type AccountingPeriod = {
  from: Date;
  to: Date;
  label: string;
};

export type AccountingReservationRecord = {
  id: string;
  code: string;
  status: string;
  totalCents: number;
  currency: string;
  createdAt: Date;
  payment: {
    status: string;
    updatedAt: Date;
  } | null;
  route?: {
    from: string;
    to: string;
  } | null;
  schedule: {
    id: string;
    vehicle: {
      id: string;
      name: string;
    };
    route: {
      from: string;
      to: string;
    };
  } | null;
};

export type AccountingExpenseRecord = {
  id: string;
  category: string;
  amountCents: number;
  currency: string;
  occurredAt: Date;
  salaryPeriod: string | null;
  notes: string | null;
  vehicle: {
    id: string;
    name: string;
  } | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    role: string;
  } | null;
};

export type AccountingIncomeItem = {
  id: string;
  source: "reservation";
  code: string;
  description: string;
  amountCents: number;
  currency: string;
  occurredAt: Date;
  vehicleId: string;
  vehicleName: string;
};

export type AccountingGroup = {
  id: string;
  label: string;
  amountCents: number;
  /** Los importes de monedas distintas no se suman: cada grupo lleva la suya. */
  currency: string;
};

export type AccountingReport = {
  incomes: AccountingIncomeItem[];
  expenses: AccountingExpenseRecord[];
  totals: {
    incomeCents: number;
    expenseCents: number;
    balanceCents: number;
  };
  incomeByVehicle: AccountingGroup[];
  expensesByVehicle: AccountingGroup[];
  expensesByCategory: AccountingGroup[];
  salariesByPerson: AccountingGroup[];
};

export type AccountingEntryInput = {
  category: AccountingCategory;
  amountCents: number;
  currency: string;
  occurredAt: Date;
  vehicleId?: string;
  userId?: string;
  salaryPeriod?: string;
  notes?: string;
};

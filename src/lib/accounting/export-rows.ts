import { ACCOUNTING_CATEGORY_LABELS, type AccountingCategory, type AccountingReport } from "./types";

/**
 * Armado de las hojas del Excel contable, sin dependencias de escritura: filas planas
 * con el formato de cada celda. Así se testea la lógica (centavos, monedas, fechas y el
 * criterio de cada hoja) sin generar un .xlsx.
 */

export type CellFormat = "money" | "date" | "int" | "text";

export type ExportCell = {
  v: string | number | Date | null;
  /** El formato va por celda, no por columna: el Resumen mezcla fechas e importes. */
  fmt?: CellFormat;
};

export type ExportSheet = {
  name: string;
  header: string[] | null;
  widths: number[];
  rows: ExportCell[][];
  /** Alineación a la derecha para las columnas de importes. */
  rightColumns: number[];
};

export type ExportMeta = {
  periodLabel: string;
  from: Date;
  to: Date;
  vehicleName?: string | null;
  generatedAt: Date;
};

export const SALARY_CATEGORIES: AccountingCategory[] = ["SECRETARY_SALARY", "DRIVER_SALARY"];

/**
 * Criterio real de `getAccountingReport`: entra una reserva si el pago está aprobado
 * **o** si la reserva está confirmada. No es caja cobrada y el importe es el total de
 * la reserva, no el del pago. Va escrito en el archivo para que no se lea como recaudación.
 */
export const INCOME_CRITERION =
  "Los ingresos incluyen reservas confirmadas o con pago aprobado, y el importe es el total de la reserva (no el monto del pago). No representan caja efectivamente cobrada.";

export function centsToAmount(cents: number) {
  return Math.round(cents) / 100;
}

const money = (cents: number): ExportCell => ({ v: centsToAmount(cents), fmt: "money" });
const date = (value: Date): ExportCell => ({
  v: new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())),
  fmt: "date"
});
const int = (value: number): ExportCell => ({ v: value, fmt: "int" });
const text = (value: string | null | undefined): ExportCell => ({ v: value ?? "" });

function categoria(value: string) {
  return ACCOUNTING_CATEGORY_LABELS[value as AccountingCategory] ?? value;
}

type Totales = { currency: string; incomeCents: number; expenseCents: number; count: number };

/** Totales por moneda: la pantalla suma todas las monedas juntas, el archivo no. */
export function totalsByCurrency(report: AccountingReport): Totales[] {
  const mapa = new Map<string, Totales>();
  const agregar = (currency: string, campo: "incomeCents" | "expenseCents", amountCents: number) => {
    const clave = currency || "ARS";
    const actual = mapa.get(clave) ?? { currency: clave, incomeCents: 0, expenseCents: 0, count: 0 };
    actual[campo] += amountCents;
    actual.count += 1;
    mapa.set(clave, actual);
  };

  for (const income of report.incomes) agregar(income.currency, "incomeCents", income.amountCents);
  for (const expense of report.expenses) agregar(expense.currency, "expenseCents", expense.amountCents);

  return [...mapa.values()].sort((a, b) => a.currency.localeCompare(b.currency, "es"));
}

/** Ingresos y egresos por nave, sin mezclar monedas. */
export function totalsByVehicleAndCurrency(report: AccountingReport) {
  const mapa = new Map<
    string,
    { vehicle: string; currency: string; incomeCents: number; expenseCents: number; movements: number }
  >();

  const fila = (vehicleId: string, vehicleName: string, currency: string) => {
    const clave = `${vehicleId}\u001f${currency || "ARS"}`;
    const actual = mapa.get(clave) ?? {
      vehicle: vehicleName,
      currency: currency || "ARS",
      incomeCents: 0,
      expenseCents: 0,
      movements: 0
    };
    mapa.set(clave, actual);
    return actual;
  };

  for (const income of report.incomes) {
    const actual = fila(income.vehicleId, income.vehicleName, income.currency);
    actual.incomeCents += income.amountCents;
    actual.movements += 1;
  }

  for (const expense of report.expenses) {
    const actual = fila(expense.vehicle?.id ?? "sin-nave", expense.vehicle?.name ?? "Sin nave asignada", expense.currency);
    actual.expenseCents += expense.amountCents;
    actual.movements += 1;
  }

  return [...mapa.values()].sort((a, b) => {
    if (a.vehicle !== b.vehicle) return a.vehicle.localeCompare(b.vehicle, "es");
    return a.currency.localeCompare(b.currency, "es");
  });
}

function persona(expense: AccountingReport["expenses"][number]) {
  return expense.user?.name || expense.user?.email || "Sin usuario";
}

export function buildExportSheets(report: AccountingReport, meta: ExportMeta): ExportSheet[] {
  const totales = totalsByCurrency(report);
  const monedas = totales.map((fila) => fila.currency);

  const resumen: ExportCell[][] = [
    [text("Período"), text(meta.periodLabel)],
    [text("Desde"), date(meta.from)],
    [text("Hasta"), date(new Date(meta.to.getTime() - 1))],
    [text("Nave"), text(meta.vehicleName || "Todas")],
    [text("Generado"), { v: new Date(meta.generatedAt), fmt: "date" }],
    [],
    [text("Moneda"), text("Ingresos"), text("Egresos"), text("Saldo"), text("Movimientos")],
    ...(totales.length > 0
      ? totales.map((fila) => [
          text(fila.currency),
          money(fila.incomeCents),
          money(fila.expenseCents),
          money(fila.incomeCents - fila.expenseCents),
          int(fila.count)
        ])
      : [[text("ARS"), money(0), money(0), money(0), int(0)]]),
    []
  ];

  if (monedas.length > 1) {
    resumen.push([
      text("Atención"),
      text(
        `El período tiene ${monedas.length} monedas (${monedas.join(", ")}). Esta hoja no las suma entre sí; la pantalla sí lo hace.`
      )
    ]);
  }

  resumen.push([text("Criterio de ingresos"), text(INCOME_CRITERION)]);

  const ingresos: ExportCell[][] = report.incomes
    .slice()
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((income) => [
      date(income.occurredAt),
      text(income.code),
      text(income.description),
      text(income.vehicleName),
      money(income.amountCents),
      text(income.currency || "ARS")
    ]);

  const gastos: ExportCell[][] = report.expenses
    .slice()
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((expense) => [
      date(expense.occurredAt),
      text(categoria(expense.category)),
      text(expense.vehicle?.name ?? "Sin nave asignada"),
      text(expense.user ? persona(expense) : ""),
      money(expense.amountCents),
      text(expense.currency || "ARS"),
      text(expense.salaryPeriod ?? ""),
      text(expense.notes ?? "")
    ]);

  const sueldosMapa = new Map<
    string,
    { person: string; currency: string; total: number; pagos: number; periodos: Set<string> }
  >();
  for (const expense of report.expenses) {
    if (!SALARY_CATEGORIES.includes(expense.category as AccountingCategory)) continue;
    const currency = expense.currency || "ARS";
    const clave = `${expense.user?.id ?? "sin-usuario"}\u001f${currency}`;
    const actual = sueldosMapa.get(clave) ?? {
      person: persona(expense),
      currency,
      total: 0,
      pagos: 0,
      periodos: new Set<string>()
    };
    actual.total += expense.amountCents;
    actual.pagos += 1;
    if (expense.salaryPeriod) actual.periodos.add(expense.salaryPeriod);
    sueldosMapa.set(clave, actual);
  }

  const sueldos: ExportCell[][] = [...sueldosMapa.values()]
    .sort((a, b) => b.total - a.total)
    .map((fila) => [
      text(fila.person),
      money(fila.total),
      text(fila.currency),
      int(fila.pagos),
      text([...fila.periodos].sort().join(", "))
    ]);

  const porNave: ExportCell[][] = totalsByVehicleAndCurrency(report).map((fila) => [
    text(fila.vehicle),
    money(fila.incomeCents),
    money(fila.expenseCents),
    money(fila.incomeCents - fila.expenseCents),
    text(fila.currency),
    int(fila.movements)
  ]);

  return [
    {
      name: "Resumen",
      header: null,
      widths: [24, 22, 18, 18, 14],
      rows: resumen,
      rightColumns: [1, 2, 3, 4]
    },
    {
      name: "Ingresos",
      header: ["Fecha", "Reserva", "Descripción", "Nave", "Importe", "Moneda"],
      widths: [12, 32, 52, 26, 14, 10],
      rows: ingresos,
      rightColumns: [4]
    },
    {
      name: "Gastos",
      header: ["Fecha", "Categoría", "Nave", "Persona", "Importe", "Moneda", "Período sueldo", "Observaciones"],
      widths: [12, 20, 26, 24, 14, 10, 16, 44],
      rows: gastos,
      rightColumns: [4]
    },
    {
      name: "Sueldos",
      header: ["Persona", "Total", "Moneda", "Pagos", "Períodos"],
      widths: [30, 16, 10, 10, 24],
      rows: sueldos,
      rightColumns: [1, 3]
    },
    {
      name: "Por nave",
      header: ["Nave", "Ingresos", "Egresos", "Saldo", "Moneda", "Movimientos"],
      widths: [30, 16, 16, 16, 10, 13],
      rows: porNave,
      rightColumns: [1, 2, 3, 5]
    }
  ];
}

/** Nombre del archivo: el período, sin acentos ni espacios. */
export function exportFileName(meta: ExportMeta) {
  const limpiar = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();

  const periodo = limpiar(meta.periodLabel) || "periodo";
  const nave = meta.vehicleName ? `-${limpiar(meta.vehicleName)}` : "";

  return `araucana-contabilidad-${periodo}${nave}.xlsx`;
}

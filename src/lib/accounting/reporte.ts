/**
 * Reportes (26-nov): lo que Contabilidad no responde. Contabilidad es el trabajo del mes (cargar,
 * pagar, revisar); Reportes es mirar el período entero y compararlo:
 *
 * - el resultado por nave (lo que entró menos lo que se gastó en esa nave), con los ingresos sin nave y
 *   los gastos generales (sueldos, seguros, etc. sin nave) en renglones aparte para que los totales
 *   cierren con las cifras de arriba;
 * - la variación contra el período anterior de la misma duración;
 * - las rutas que más facturan.
 *
 * Nunca suma monedas distintas: cada renglón y cada total es de una sola moneda.
 */
import { createRangePeriod } from "./period";
import type { AccountingGroup, AccountingIncomeItem, AccountingPeriod, AccountingReport } from "./types";
import { lugarCorto } from "./secciones";

export const SIN_NAVE = "sin-nave";
export const GASTOS_GENERALES = "gastos-generales";

export type FilaDeNave = {
  /** El id de la nave, o `sin-nave` (ingresos sin nave) / `gastos-generales` (egresos sin nave). */
  id: string;
  nave: string;
  moneda: string;
  ingresosCents: number;
  gastosCents: number;
  resultadoCents: number;
  /** Resultado sobre ingresos, en %; null si no hubo ingresos. */
  margen: number | null;
};

export type TotalDeMoneda = { moneda: string; ingresosCents: number; gastosCents: number; resultadoCents: number; margen: number | null };

const margenDe = (ingresos: number, resultado: number) => (ingresos > 0 ? Math.round((resultado / ingresos) * 1000) / 10 : null);

/**
 * Una fila por nave y moneda, con lo que entró y lo que se gastó en ella. Primero las naves (mejor
 * resultado arriba), después «Sin nave asignada» y «Gastos generales». Los gastos generales son los
 * egresos del período sin nave: así la suma de la columna da el total de egresos.
 */
export function resultadoPorNave(report: Pick<AccountingReport, "incomeByVehicle" | "expensesByVehicle" | "expenses">): FilaDeNave[] {
  const filas = new Map<string, FilaDeNave>();
  const fila = (id: string, nave: string, moneda: string) => {
    const clave = `${id}\u001f${moneda}`;
    const existente = filas.get(clave);
    if (existente) return existente;
    const nueva: FilaDeNave = { id, nave, moneda, ingresosCents: 0, gastosCents: 0, resultadoCents: 0, margen: null };
    filas.set(clave, nueva);
    return nueva;
  };

  for (const grupo of report.incomeByVehicle) {
    const id = grupo.id === SIN_NAVE ? SIN_NAVE : grupo.id;
    fila(id, id === SIN_NAVE ? "Sin nave asignada" : grupo.label, grupo.currency || "ARS").ingresosCents += grupo.amountCents;
  }
  for (const grupo of report.expensesByVehicle) {
    fila(grupo.id, grupo.label, grupo.currency || "ARS").gastosCents += grupo.amountCents;
  }
  for (const egreso of report.expenses) {
    if (!egreso.vehicle) fila(GASTOS_GENERALES, "Gastos generales (sin nave)", egreso.currency || "ARS").gastosCents += egreso.amountCents;
  }

  const lugar = (f: FilaDeNave) => (f.id === SIN_NAVE ? 1 : f.id === GASTOS_GENERALES ? 2 : 0);
  return [...filas.values()]
    .map((f) => {
      const resultadoCents = f.ingresosCents - f.gastosCents;
      return { ...f, resultadoCents, margen: margenDe(f.ingresosCents, resultadoCents) };
    })
    .sort((a, b) => lugar(a) - lugar(b) || a.moneda.localeCompare(b.moneda) || b.resultadoCents - a.resultadoCents || a.nave.localeCompare(b.nave, "es"));
}

/** Los totales por moneda de esas filas (cierran con Ingresos y Egresos del período). */
export function totalesPorMoneda(filas: readonly FilaDeNave[]): TotalDeMoneda[] {
  const porMoneda = new Map<string, TotalDeMoneda>();
  for (const f of filas) {
    const total = porMoneda.get(f.moneda) ?? { moneda: f.moneda, ingresosCents: 0, gastosCents: 0, resultadoCents: 0, margen: null };
    total.ingresosCents += f.ingresosCents;
    total.gastosCents += f.gastosCents;
    porMoneda.set(f.moneda, total);
  }
  return [...porMoneda.values()]
    .map((t) => ({ ...t, resultadoCents: t.ingresosCents - t.gastosCents, margen: margenDe(t.ingresosCents, t.ingresosCents - t.gastosCents) }))
    .sort((a, b) => (a.moneda === "ARS" ? -1 : b.moneda === "ARS" ? 1 : a.moneda.localeCompare(b.moneda)));
}

const DIA = 24 * 60 * 60 * 1000;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const clave = (fecha: Date) => fecha.toISOString().slice(0, 10);

/**
 * El período anterior para comparar: si es un mes entero, el mes anterior; si es un rango, los mismos
 * días inmediatamente antes (del 10 al 16 → del 3 al 9). `esMes` se pasa explícito: un rango que
 * cubre un mes calendario (1/11–30/11) también termina el día 1 del mes siguiente, pero debe comparar
 * contra la misma cantidad de días, no contra el mes anterior.
 */
export function periodoAnterior(periodo: AccountingPeriod, esMes = esMesCalendario(periodo)): AccountingPeriod & { nombre: string } {
  if (esMes) {
    const from = new Date(Date.UTC(periodo.from.getUTCFullYear(), periodo.from.getUTCMonth() - 1, 1));
    const nombre = MESES[from.getUTCMonth()];
    return { from, to: periodo.from, label: `${nombre[0].toUpperCase()}${nombre.slice(1)} ${from.getUTCFullYear()}`, nombre };
  }
  const largo = periodo.to.getTime() - periodo.from.getTime();
  const anterior = createRangePeriod(clave(new Date(periodo.from.getTime() - largo)), clave(new Date(periodo.from.getTime() - DIA)));
  const dias = Math.round(largo / DIA);
  return { ...anterior, nombre: `los ${dias} días anteriores` };
}

function esMesCalendario(periodo: AccountingPeriod) {
  return periodo.from.getUTCDate() === 1 && periodo.to.getUTCDate() === 1
    && (periodo.to.getUTCMonth() - periodo.from.getUTCMonth() + 12) % 12 === 1;
}

/** Cuánto cambió, en % redondeado; null si antes no hubo nada para comparar. */
export function variacion(actualCents: number, anteriorCents: number): number | null {
  if (!anteriorCents) return null;
  return Math.round(((actualCents - anteriorCents) / Math.abs(anteriorCents)) * 100);
}

/**
 * La línea de comparación de una cifra: «octubre: $ 1.000 (+20 %)». Sin base, «sin datos en octubre».
 * Con un salto de más de 999 % (un mes casi vacío) se muestra sólo el monto: el porcentaje no dice nada.
 */
export function textoDeVariacion(actualCents: number, anteriorCents: number, nombre: string, formato: (cents: number) => string) {
  if (!anteriorCents) return actualCents ? `sin datos en ${nombre}` : null;
  const v = variacion(actualCents, anteriorCents)!;
  const parte = v === 0 ? " (igual)" : Math.abs(v) > 999 ? "" : ` (${v > 0 ? "+" : "−"}${Math.abs(v)} %)`;
  return `${nombre}: ${formato(anteriorCents)}${parte}`;
}

export type RutaFacturada = { ruta: string; moneda: string; reservas: number; ingresosCents: number };

/**
 * Las rutas que más facturan en el período, por moneda, con cuántas reservas. Se cortan `cuantas`
 * por moneda: ordenar todo junto por centavos compararía importes de monedas distintas y podría
 * dejar afuera una ruta en USD sólo porque hay muchas rutas en ARS.
 */
export function rutasQueMasFacturan(ingresos: readonly Pick<AccountingIncomeItem, "routeFrom" | "routeTo" | "currency" | "amountCents">[], cuantas = 6): RutaFacturada[] {
  const porRuta = new Map<string, RutaFacturada>();
  for (const ingreso of ingresos) {
    const ruta = `${lugarCorto(ingreso.routeFrom)} → ${lugarCorto(ingreso.routeTo)}`;
    const moneda = ingreso.currency || "ARS";
    const k = `${ruta}\u001f${moneda}`;
    const actual = porRuta.get(k) ?? { ruta, moneda, reservas: 0, ingresosCents: 0 };
    actual.reservas += 1;
    actual.ingresosCents += ingreso.amountCents;
    porRuta.set(k, actual);
  }
  const porMoneda = new Map<string, RutaFacturada[]>();
  for (const fila of porRuta.values()) {
    porMoneda.set(fila.moneda, [...(porMoneda.get(fila.moneda) ?? []), fila]);
  }
  return [...porMoneda.entries()]
    .sort(([a], [b]) => (a === "ARS" ? -1 : b === "ARS" ? 1 : a.localeCompare(b)))
    .flatMap(([, filas]) => filas
      .sort((a, b) => b.ingresosCents - a.ingresosCents || a.ruta.localeCompare(b.ruta, "es"))
      .slice(0, cuantas));
}

/** La parte de cada grupo sobre el total de su moneda, en % (para las barras). */
export function conParte<T extends Pick<AccountingGroup, "amountCents" | "currency">>(grupos: readonly T[]): (T & { parte: number })[] {
  const totales = new Map<string, number>();
  for (const g of grupos) totales.set(g.currency, (totales.get(g.currency) ?? 0) + g.amountCents);
  return grupos.map((g) => ({ ...g, parte: Math.round((g.amountCents / Math.max(1, totales.get(g.currency) ?? 0)) * 100) }));
}

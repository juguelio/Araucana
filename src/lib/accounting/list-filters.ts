import { ordenarEnMemoria, type OrdenDeListado } from "@/lib/admin/list-order";
import { createDayPeriod, createMonthPeriod, createRangePeriod, createWeekPeriod } from "./period";
import type { AccountingIncomeItem, AccountingPeriod } from "./types";
import type { EstadoDeSueldo, FilaDeSueldo } from "./sueldos";

/** Texto sin tildes ni mayúsculas, para comparar "Perez" con "Pérez". */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Filtros de las listas de Contabilidad. El mes sigue siendo la unidad de los sueldos; los ingresos
 * se pueden mirar por mes, semana, día o un rango elegido. Nada de esto toca la base: se resuelve
 * sobre lo que ya devolvió el informe del período.
 */

export const TAMANOS_DE_PAGINA = [25, 50, 100] as const;
export const TAMANO_DE_PAGINA = 25;

export function leerTamanoDePagina(valor: string | string[] | undefined) {
  const n = typeof valor === "string" ? Number(valor) : NaN;
  return TAMANOS_DE_PAGINA.includes(n as (typeof TAMANOS_DE_PAGINA)[number]) ? n : TAMANO_DE_PAGINA;
}

export type VistaDeIngresos = "mes" | "semana" | "dia" | "rango";
export const VISTAS_DE_INGRESOS: readonly VistaDeIngresos[] = ["mes", "semana", "dia", "rango"];

export type PeriodoDeIngresos = {
  vista: VistaDeIngresos;
  period: AccountingPeriod;
  /** Valores para volver a dibujar los controles sin perder el período que se está mirando. */
  mes: string;
  semana: string;
  dia: string;
  desde: string;
  hasta: string;
};

function clave(fecha: Date) {
  return fecha.toISOString().slice(0, 10);
}

function claveDeMes(fecha: Date) {
  return fecha.toISOString().slice(0, 7);
}

function leerVista(valor: string | string[] | undefined): VistaDeIngresos {
  return typeof valor === "string" && VISTAS_DE_INGRESOS.includes(valor as VistaDeIngresos)
    ? (valor as VistaDeIngresos)
    : "mes";
}

export function periodoDeIngresos(params: Record<string, string | string[] | undefined>): PeriodoDeIngresos {
  const vista = leerVista(params.vista);
  const mesBase = typeof params.month === "string" ? params.month : undefined;
  const period =
    vista === "semana"
      ? createWeekPeriod(typeof params.semana === "string" ? params.semana : undefined)
      : vista === "dia"
        ? createDayPeriod(typeof params.dia === "string" ? params.dia : undefined)
        : vista === "rango"
          ? createRangePeriod(
              typeof params.desde === "string" ? params.desde : undefined,
              typeof params.hasta === "string" ? params.hasta : undefined
            )
          : createMonthPeriod(mesBase);

  return {
    vista,
    period,
    mes: claveDeMes(period.from),
    semana: vista === "semana" ? clave(period.from) : clave(period.from),
    dia: vista === "dia" ? clave(period.from) : clave(period.from),
    desde: clave(period.from),
    hasta: clave(new Date(period.to.getTime() - 24 * 60 * 60 * 1000))
  };
}

export const COLUMNAS_DE_INGRESOS = [
  { id: "fecha", etiqueta: "Fecha" },
  { id: "reserva", etiqueta: "Reserva" },
  { id: "chofer", etiqueta: "Chofer" },
  { id: "ruta", etiqueta: "Ruta" },
  { id: "nave", etiqueta: "Nave" },
  { id: "monto", etiqueta: "Monto" },
  { id: "estado", etiqueta: "Estado" }
] as const;

export type ColumnaDeIngreso = (typeof COLUMNAS_DE_INGRESOS)[number]["id"];
export const COLUMNAS_DE_INGRESOS_POR_DEFECTO = COLUMNAS_DE_INGRESOS.map((columna) => columna.id);

export function leerColumnasDeIngresos(valor: string | string[] | undefined): ColumnaDeIngreso[] {
  const texto = Array.isArray(valor) ? valor.join(",") : valor;
  if (typeof texto !== "string" || !texto) return [...COLUMNAS_DE_INGRESOS_POR_DEFECTO];
  const validas = new Set(COLUMNAS_DE_INGRESOS.map((columna) => columna.id));
  const pedidas = new Set(texto.split(",").filter((id): id is ColumnaDeIngreso => validas.has(id as ColumnaDeIngreso)));
  return pedidas.size ? COLUMNAS_DE_INGRESOS.filter((columna) => pedidas.has(columna.id)).map((columna) => columna.id) : [...COLUMNAS_DE_INGRESOS_POR_DEFECTO];
}

export const ORDEN_DE_INGRESOS = ["fecha", "reserva", "chofer", "ruta", "nave", "monto", "estado"] as const;
export type OrdenDeIngreso = (typeof ORDEN_DE_INGRESOS)[number];
export const ORDEN_DE_INGRESOS_POR_DEFECTO: OrdenDeListado<OrdenDeIngreso> = { columna: "fecha", direccion: "desc" };

export function filtrarIngresos(
  ingresos: readonly AccountingIncomeItem[],
  filtros: { q?: string; driverId?: string }
) {
  const texto = normalizar(filtros.q ?? "");
  return ingresos.filter((ingreso) => {
    if (filtros.driverId) {
      const id = ingreso.driverId ?? "sin-chofer";
      if (id !== filtros.driverId) return false;
    }
    if (!texto) return true;
    return [ingreso.code, ingreso.driverName, ingreso.routeLabel, ingreso.vehicleName, ingreso.description]
      .filter(Boolean)
      .some((campo) => normalizar(String(campo)).includes(texto));
  });
}

export function ordenarIngresos(ingresos: readonly AccountingIncomeItem[], orden: OrdenDeListado<OrdenDeIngreso>) {
  return ordenarEnMemoria(ingresos, orden, {
    fecha: (ingreso) => ingreso.occurredAt,
    reserva: (ingreso) => ingreso.code,
    chofer: (ingreso) => ingreso.driverName ?? "Sin chofer",
    ruta: (ingreso) => ingreso.routeLabel,
    nave: (ingreso) => ingreso.vehicleName,
    // Monedas distintas no se comparan entre sí: primero la moneda, después el importe.
    monto: (ingreso) => `${ingreso.currency} ${String(ingreso.amountCents).padStart(15, "0")}`,
    estado: (ingreso) => `${ingreso.status} ${ingreso.paymentStatus ?? ""}`
  });
}

export type FiltrosDeLiquidacion = {
  q?: string;
  rol?: "todos" | "DRIVER" | "SECRETARY";
  estado?: "todos" | EstadoDeSueldo;
};

export type EstadoDeSueldoFiltro = NonNullable<FiltrosDeLiquidacion["estado"]>;

export function filtrarLiquidaciones(filas: readonly FilaDeSueldo[], filtros: FiltrosDeLiquidacion) {
  const texto = normalizar(filtros.q ?? "");
  return filas.filter((fila) => {
    if (filtros.rol && filtros.rol !== "todos" && fila.rol !== filtros.rol) return false;
    if (filtros.estado && filtros.estado !== "todos" && fila.estado !== filtros.estado) return false;
    if (!texto) return true;
    return normalizar(fila.nombre).includes(texto);
  });
}

export const ORDEN_DE_LIQUIDACIONES = ["persona", "dias", "salidas", "horas", "sueldo", "pagado", "falta", "estado"] as const;
export type OrdenDeLiquidacion = (typeof ORDEN_DE_LIQUIDACIONES)[number];
export const ORDEN_DE_LIQUIDACIONES_POR_DEFECTO: OrdenDeListado<OrdenDeLiquidacion> = { columna: "persona", direccion: "asc" };

export function ordenarLiquidaciones(filas: readonly FilaDeSueldo[], orden: OrdenDeListado<OrdenDeLiquidacion>) {
  return ordenarEnMemoria(filas, orden, {
    persona: (fila) => fila.nombre,
    dias: (fila) => fila.base?.dias ?? null,
    salidas: (fila) => fila.base?.salidas ?? null,
    horas: (fila) => fila.base?.horas ?? null,
    // Monedas distintas no se comparan entre sí: primero la moneda, después el importe.
    sueldo: (fila) => fila.sueldoCents === null ? null : `${fila.moneda} ${String(fila.sueldoCents).padStart(15, "0")}`,
    pagado: (fila) => `${fila.moneda} ${String(fila.pagadoCents).padStart(15, "0")}`,
    falta: (fila) => fila.pendienteCents === null ? null : `${fila.moneda} ${String(fila.pendienteCents).padStart(15, "0")}`,
    estado: (fila) => fila.estado
  });
}

export const COLUMNAS_DE_LIQUIDACIONES = [
  { id: "persona", etiqueta: "Persona" },
  { id: "dias", etiqueta: "Días" },
  { id: "salidas", etiqueta: "Salidas" },
  { id: "horas", etiqueta: "Horas" },
  { id: "sueldo", etiqueta: "Sueldo" },
  { id: "pagado", etiqueta: "Pagado" },
  { id: "falta", etiqueta: "Falta" },
  { id: "estado", etiqueta: "Estado" }
] as const;

export type ColumnaDeLiquidacion = (typeof COLUMNAS_DE_LIQUIDACIONES)[number]["id"];
export const COLUMNAS_DE_LIQUIDACIONES_POR_DEFECTO = COLUMNAS_DE_LIQUIDACIONES.map((columna) => columna.id);

export function leerColumnasDeLiquidaciones(valor: string | string[] | undefined): ColumnaDeLiquidacion[] {
  const texto = Array.isArray(valor) ? valor.join(",") : valor;
  if (typeof texto !== "string" || !texto) return [...COLUMNAS_DE_LIQUIDACIONES_POR_DEFECTO];
  const validas = new Set(COLUMNAS_DE_LIQUIDACIONES.map((columna) => columna.id));
  const pedidas = new Set(texto.split(",").filter((id): id is ColumnaDeLiquidacion => validas.has(id as ColumnaDeLiquidacion)));
  return pedidas.size
    ? COLUMNAS_DE_LIQUIDACIONES.filter((columna) => pedidas.has(columna.id)).map((columna) => columna.id)
    : [...COLUMNAS_DE_LIQUIDACIONES_POR_DEFECTO];
}

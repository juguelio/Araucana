/**
 * Sueldos del mes (Contabilidad, 25-nov): por cada chofer y secretaria, lo pactado (el sueldo
 * mensual de su ficha), lo pagado para ese período (los pagos cuyo `salaryPeriod` es el mes, aunque
 * se hayan pagado a principio del mes siguiente) y lo que falta. Para los choferes suma la base de
 * días, salidas y horas de servicio público (`resumenPorChofer`).
 *
 * No es una liquidación: no inventa valor de hora, plus ni descuentos (fuera de alcance de #456).
 * Nunca compara montos de monedas distintas: un pago en pesos no descuenta un sueldo en dólares.
 */

export type PersonaConSueldo = {
  id: string;
  nombre: string;
  rol: "DRIVER" | "SECRETARY";
  activo: boolean;
  sueldoCents: number | null;
  moneda: string;
};

export type PagoDeSueldo = { userId: string; amountCents: number; currency: string };

export type BaseDeChofer = { driverId: string; dias: number; salidas: number; horas: number };

export type EstadoDeSueldo = "pagado" | "parcial" | "pendiente" | "de-mas" | "sin-sueldo";

export type FilaDeSueldo = {
  userId: string;
  nombre: string;
  rol: "DRIVER" | "SECRETARY";
  activo: boolean;
  moneda: string;
  sueldoCents: number | null;
  pagadoCents: number;
  /** Pagos en otra moneda que la del sueldo: se muestran aparte, no descuentan. */
  pagosEnOtraMoneda: { currency: string; amountCents: number }[];
  pagos: number;
  pendienteCents: number | null;
  estado: EstadoDeSueldo;
  base: Omit<BaseDeChofer, "driverId"> | null;
};

export const ETIQUETA_ESTADO_SUELDO: Record<EstadoDeSueldo, string> = {
  pagado: "Pagado",
  parcial: "Pago parcial",
  pendiente: "Pendiente",
  "de-mas": "Pagado de más",
  "sin-sueldo": "Sin sueldo en la ficha"
};

export function estadoDeSueldo(sueldoCents: number | null, pagadoCents: number): EstadoDeSueldo {
  if (!sueldoCents) return "sin-sueldo";
  if (pagadoCents === 0) return "pendiente";
  if (pagadoCents < sueldoCents) return "parcial";
  if (pagadoCents > sueldoCents) return "de-mas";
  return "pagado";
}

/**
 * Una fila por persona activa, más las inactivas que tuvieron pagos o salidas ese mes (alguien que
 * se fue a mitad de mes también se liquida). Orden: lo que falta pagar primero, después por nombre.
 */
export function sueldosDelMes(personas: readonly PersonaConSueldo[], pagos: readonly PagoDeSueldo[], base: readonly BaseDeChofer[]): FilaDeSueldo[] {
  const basePorChofer = new Map(base.map((b) => [b.driverId, b]));
  const pagosPorPersona = new Map<string, PagoDeSueldo[]>();
  for (const pago of pagos) pagosPorPersona.set(pago.userId, [...(pagosPorPersona.get(pago.userId) ?? []), pago]);

  const filas = personas
    .filter((persona) => persona.activo || pagosPorPersona.has(persona.id) || basePorChofer.has(persona.id))
    .map((persona): FilaDeSueldo => {
      const moneda = persona.moneda || "ARS";
      const suyos = pagosPorPersona.get(persona.id) ?? [];
      const pagadoCents = suyos.filter((pago) => (pago.currency || "ARS") === moneda).reduce((total, pago) => total + pago.amountCents, 0);
      const otras = new Map<string, number>();
      for (const pago of suyos) {
        const currency = pago.currency || "ARS";
        if (currency !== moneda) otras.set(currency, (otras.get(currency) ?? 0) + pago.amountCents);
      }
      const sueldoCents = persona.sueldoCents && persona.sueldoCents > 0 ? persona.sueldoCents : null;
      const delChofer = persona.rol === "DRIVER" ? basePorChofer.get(persona.id) : undefined;
      return {
        userId: persona.id,
        nombre: persona.nombre,
        rol: persona.rol,
        activo: persona.activo,
        moneda,
        sueldoCents,
        pagadoCents,
        pagosEnOtraMoneda: [...otras].map(([currency, amountCents]) => ({ currency, amountCents })),
        pagos: suyos.length,
        pendienteCents: sueldoCents === null ? null : Math.max(0, sueldoCents - pagadoCents),
        estado: estadoDeSueldo(sueldoCents, pagadoCents),
        base: persona.rol === "DRIVER" ? { dias: delChofer?.dias ?? 0, salidas: delChofer?.salidas ?? 0, horas: delChofer?.horas ?? 0 } : null
      };
    });

  const urgencia: Record<EstadoDeSueldo, number> = { pendiente: 0, parcial: 1, "sin-sueldo": 2, "de-mas": 3, pagado: 4 };
  return filas.sort((a, b) => urgencia[a.estado] - urgencia[b.estado] || a.nombre.localeCompare(b.nombre, "es"));
}

export type TotalDeSueldos = { moneda: string; pactadoCents: number; pagadoCents: number; pendienteCents: number; personasPendientes: number };

/** Totales por moneda: lo pactado, lo pagado y lo que falta, y cuántas personas tienen algo pendiente. */
export function totalesDeSueldos(filas: readonly FilaDeSueldo[]): TotalDeSueldos[] {
  const porMoneda = new Map<string, TotalDeSueldos>();
  for (const fila of filas) {
    const total = porMoneda.get(fila.moneda) ?? { moneda: fila.moneda, pactadoCents: 0, pagadoCents: 0, pendienteCents: 0, personasPendientes: 0 };
    total.pactadoCents += fila.sueldoCents ?? 0;
    total.pagadoCents += fila.pagadoCents;
    total.pendienteCents += fila.pendienteCents ?? 0;
    if ((fila.pendienteCents ?? 0) > 0) total.personasPendientes += 1;
    porMoneda.set(fila.moneda, total);
  }
  return [...porMoneda.values()].sort((a, b) => a.moneda.localeCompare(b.moneda, "es"));
}

/** «2026-11» → «2026-10» / «2026-12». */
export function mesVecino(mes: string, paso: number) {
  const [anio, numero] = mes.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, numero - 1 + paso, 1));
  return fecha.toISOString().slice(0, 7);
}

/** La fecha por defecto de un pago o egreso cargado mirando un mes: hoy si es este mes; si no, el último día de ese mes. */
export function fechaPorDefecto(mes: string, hoy: string) {
  if (hoy.startsWith(mes)) return hoy;
  const [anio, numero] = mes.split("-").map(Number);
  return new Date(Date.UTC(anio, numero, 0)).toISOString().slice(0, 10);
}

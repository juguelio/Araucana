/**
 * Vencimientos de la flota: revisión técnica, RTO y póliza.
 *
 * La operación necesita ver *antes* que una unidad quede inhabilitada: la temporada se vende con
 * meses de anticipación y una VTV vencida deja la combi parada. Nada de esto bloquea reservas por
 * sí solo — es información para decidir.
 */

export type ComplianceLevel = "vencido" | "proximo" | "ok";

export const DIAS_ALERTA = 90;

export type Vencimiento = {
  tipo: "Técnica" | "RTO" | "Póliza";
  fecha: Date | null;
  dias: number | null;
  level: ComplianceLevel | null;
};

const MS_DIA = 24 * 3600 * 1000;

/** Días completos hasta el vencimiento (negativo = ya venció). Compara por día calendario. */
export function diasHasta(fecha: Date | null | undefined, hoy: Date = new Date()): number | null {
  if (!fecha) return null;
  const a = Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const b = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((a - b) / MS_DIA);
}

export function complianceLevel(fecha: Date | null | undefined, hoy: Date = new Date(), alerta = DIAS_ALERTA): ComplianceLevel | null {
  const dias = diasHasta(fecha, hoy);
  if (dias === null) return null;
  if (dias < 0) return "vencido";
  if (dias <= alerta) return "proximo";
  return "ok";
}

/** "Vencido hace 3 días" · "Vence hoy" · "Vence en 21 días" · "Al día". */
export function complianceLabel(fecha: Date | null | undefined, hoy: Date = new Date(), alerta = DIAS_ALERTA): string {
  const dias = diasHasta(fecha, hoy);
  if (dias === null) return "Sin dato";
  if (dias < 0) return `Vencido hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "día" : "días"}`;
  if (dias === 0) return "Vence hoy";
  if (dias <= alerta) return `Vence en ${dias} ${dias === 1 ? "día" : "días"}`;
  return "Al día";
}

/** dd/mm/aaaa sin depender del locale del servidor. */
export function formatoFecha(fecha: Date | null | undefined): string {
  if (!fecha) return "—";
  const d = String(fecha.getDate()).padStart(2, "0");
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${fecha.getFullYear()}`;
}

export type UnidadConVencimientos = {
  technicalInspectionDueAt?: Date | null;
  rtoDueAt?: Date | null;
  policyDueAt?: Date | null;
};

/** Los tres papeles de una unidad, en el orden en que se controlan. */
export function vencimientosDe(unidad: UnidadConVencimientos, hoy: Date = new Date()): Vencimiento[] {
  const filas: Array<[Vencimiento["tipo"], Date | null | undefined]> = [
    ["Técnica", unidad.technicalInspectionDueAt],
    ["RTO", unidad.rtoDueAt],
    ["Póliza", unidad.policyDueAt]
  ];
  return filas.map(([tipo, fecha]) => ({
    tipo,
    fecha: fecha ?? null,
    dias: diasHasta(fecha ?? null, hoy),
    level: complianceLevel(fecha ?? null, hoy)
  }));
}

/** El vencimiento más urgente de la unidad (para pintar el estado en la lista). */
export function peorVencimiento(unidad: UnidadConVencimientos, hoy: Date = new Date()): Vencimiento | null {
  const conFecha = vencimientosDe(unidad, hoy).filter((v) => v.fecha);
  if (conFecha.length === 0) return null;
  return conFecha.reduce((peor, actual) => ((actual.dias ?? 0) < (peor.dias ?? 0) ? actual : peor));
}

/** Cuenta por nivel, para los indicadores del panel. */
export function resumenVencimientos(unidades: UnidadConVencimientos[], hoy: Date = new Date()) {
  let vencidos = 0;
  let proximos = 0;
  for (const unidad of unidades) {
    for (const v of vencimientosDe(unidad, hoy)) {
      if (v.level === "vencido") vencidos += 1;
      else if (v.level === "proximo") proximos += 1;
    }
  }
  return { vencidos, proximos };
}

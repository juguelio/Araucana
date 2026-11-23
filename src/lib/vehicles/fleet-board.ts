import { diasHasta } from "./compliance";
import type { NaveDelListado } from "./fleet-table";

/**
 * Tablero general de flota (pedido de Quique): una fila por unidad con antigüedad, RTO/técnica y
 * póliza, para ver la flota entera sin entrar vehículo por vehículo.
 *
 * La cadencia de la técnica/RTO no se inventa: en Neuquén es cada 6 meses hasta los 10 años,
 * cada 3 meses entre 10 y 15, y a los 15 la unidad deja de estar habilitada para pasajeros.
 * La antigüedad sale de la fecha de adquisición; si falta, del año modelo (marcada como estimada).
 */

export const DIAS_AVISO_FLOTA = 30;
export const EDAD_LIMITE_PASAJEROS = 15;
export const EDAD_LIMITE_PROVINCIA = 13;

export type NaveDeFlota = NaveDelListado & {
  acquiredAt: Date | null;
  publicTransport: boolean;
  kind: string;
  notes: string | null;
};

export type EdadDeNave = { anios: number; estimada: boolean };

/** Años cumplidos desde la adquisición; si no hay fecha, desde el año modelo (estimada). */
export function edadDeNave(nave: Pick<NaveDeFlota, "acquiredAt" | "year">, hoy: Date = new Date()): EdadDeNave | null {
  if (nave.acquiredAt) {
    const anios = hoy.getUTCFullYear() - nave.acquiredAt.getUTCFullYear();
    const antesDelCumple =
      hoy.getUTCMonth() < nave.acquiredAt.getUTCMonth() ||
      (hoy.getUTCMonth() === nave.acquiredAt.getUTCMonth() && hoy.getUTCDate() < nave.acquiredAt.getUTCDate());
    return { anios: Math.max(0, anios - (antesDelCumple ? 1 : 0)), estimada: false };
  }
  if (nave.year) return { anios: Math.max(0, hoy.getUTCFullYear() - nave.year), estimada: true };
  return null;
}

export type CadenciaTecnica = "6 meses" | "3 meses" | "sin habilitación";

/** La técnica/RTO que corresponde según la antigüedad (Neuquén, transporte de pasajeros). */
export function cadenciaTecnica(edad: number | null): CadenciaTecnica | null {
  if (edad === null) return null;
  if (edad >= EDAD_LIMITE_PASAJEROS) return "sin habilitación";
  if (edad >= 10) return "3 meses";
  return "6 meses";
}

/** Hasta los 13 años puede salir a otra provincia; después queda limitada a Neuquén. */
export function puedeSalirDeNeuquen(edad: number | null): boolean | null {
  if (edad === null) return null;
  return edad < EDAD_LIMITE_PROVINCIA;
}

export type NivelPapel = "vencido" | "proximo" | "ok" | "sin-dato";
export type PapelDeFlota = { tipo: "RTO" | "Técnica" | "Póliza"; fecha: Date | null; dias: number | null; nivel: NivelPapel };

/** Los tres papeles con el aviso de 30 días que pidió Quique. */
export function papelesDeNave(nave: NaveDeFlota, hoy: Date = new Date()): PapelDeFlota[] {
  const filas: Array<[PapelDeFlota["tipo"], Date | null]> = [
    ["RTO", nave.rtoDueAt ?? null],
    ["Técnica", nave.technicalInspectionDueAt ?? null],
    ["Póliza", nave.policyDueAt ?? null]
  ];
  return filas.map(([tipo, fecha]) => {
    const dias = diasHasta(fecha, hoy);
    const nivel: NivelPapel =
      dias === null ? "sin-dato" : dias < 0 ? "vencido" : dias <= DIAS_AVISO_FLOTA ? "proximo" : "ok";
    return { tipo, fecha, dias, nivel };
  });
}

export type FiltroFlota = {
  tipo: string;
  papel: "" | "vencido" | "proximo" | "ok";
  edad: "" | "0-10" | "10-15" | "15+";
  uso: "" | "publico" | "interno" | "no-habilitada";
};

export function leerFiltroFlota(params: { tipo?: string; papel?: string; edad?: string; uso?: string } = {}): FiltroFlota {
  const tipo = ["BUS", "CAMIONETA", "UTILITARIO"].includes(params.tipo ?? "") ? (params.tipo as string) : "";
  const papel = ["vencido", "proximo", "ok"].includes(params.papel ?? "") ? (params.papel as FiltroFlota["papel"]) : "";
  const edad = ["0-10", "10-15", "15+"].includes(params.edad ?? "") ? (params.edad as FiltroFlota["edad"]) : "";
  const uso = ["publico", "interno", "no-habilitada"].includes(params.uso ?? "") ? (params.uso as FiltroFlota["uso"]) : "";
  return { tipo, papel, edad, uso };
}

/** Filtros del tablero: tipo, estado de papeles, antigüedad y uso. */
export function filtrarNaves<T extends NaveDeFlota>(naves: readonly T[], filtro: FiltroFlota, hoy: Date = new Date()): T[] {
  return naves.filter((nave) => {
    if (filtro.tipo && nave.kind !== filtro.tipo) return false;

    if (filtro.uso === "publico" && !nave.publicTransport) return false;
    if (filtro.uso === "interno" && (nave.publicTransport || nave.kind !== "UTILITARIO")) return false;
    if (filtro.uso === "no-habilitada" && nave.isActive) return false;

    const edad = edadDeNave(nave, hoy)?.anios ?? null;
    if (filtro.edad && edad !== null) {
      if (filtro.edad === "0-10" && edad >= 10) return false;
      if (filtro.edad === "10-15" && (edad < 10 || edad >= 15)) return false;
      if (filtro.edad === "15+" && edad < 15) return false;
    }
    if (filtro.edad && edad === null) return false;

    if (filtro.papel) {
      const papeles = papelesDeNave(nave, hoy);
      if (filtro.papel === "vencido" && !papeles.some((p) => p.nivel === "vencido")) return false;
      if (filtro.papel === "proximo" && !papeles.some((p) => p.nivel === "proximo")) return false;
      if (filtro.papel === "ok" && papeles.some((p) => p.nivel === "vencido" || p.nivel === "proximo")) return false;
    }

    return true;
  });
}

export type ResumenFlota = {
  total: number;
  publico: number;
  vencidos: number;
  porVencer: number;
  proximasA15: number;
};

export function resumenFlota(naves: readonly NaveDeFlota[], hoy: Date = new Date()): ResumenFlota {
  let vencidos = 0;
  let porVencer = 0;
  let proximasA15 = 0;
  for (const nave of naves) {
    const papeles = papelesDeNave(nave, hoy);
    if (papeles.some((p) => p.nivel === "vencido")) vencidos += 1;
    else if (papeles.some((p) => p.nivel === "proximo")) porVencer += 1;
    const edad = edadDeNave(nave, hoy)?.anios ?? null;
    if (edad !== null && edad >= EDAD_LIMITE_PASAJEROS - 1) proximasA15 += 1;
  }
  return {
    total: naves.length,
    publico: naves.filter((nave) => nave.publicTransport).length,
    vencidos,
    porVencer,
    proximasA15
  };
}

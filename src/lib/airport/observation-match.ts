import { airportLocalDay } from "./data-quality";
import { jetSmartCanonicalNumber } from "./flights";

/**
 * Asociador de lecturas de fuentes con vuelos (modo sombra).
 *
 * Cada fuente nombra el mismo vuelo a su manera: el tablero publica JA3182 y AirLabs WJ3182, un
 * código compartido llega con el número de quien lo vende y no de quien lo opera, y el horario cambia
 * entre fuentes. Hoy cada caso se arregla con un parche en el sync; esto define una sola identidad:
 *
 *   aerolínea que opera + número canónico + día local (UTC−3) + sentido
 *
 * Parte pura: no toca red ni base. Por ahora sólo se usa para registrar qué fila habría elegido
 * y compararlo con lo que hizo el sync; no decide nada sobre `Flight`.
 */

export type NivelDeAsociacion = "CODIGO_COMPARTIDO" | "EXACTO" | "CERCANIA" | "SIN_VUELO" | "AMBIGUO" | "SIN_DATOS";

export type LecturaDeVuelo = {
  direction: string;
  rawNumber: string;
  /** Vuelo que opera de verdad cuando la lectura es un código compartido (`cs_flight_iata`). */
  codeshareOf?: string | null;
  airline?: string | null;
  origin?: string | null;
  scheduledAt: Date | null;
  /** Día local AAAA-MM-DD; si falta, se deriva del horario. */
  localDay?: string | null;
};

export type FilaCandidata = {
  id: string;
  number: string;
  airline: string | null;
  origin: string;
  direction: string;
  scheduledAt: Date;
};

export type Asociacion = {
  flightId: string | null;
  nivel: NivelDeAsociacion;
  clave: string | null;
  canonicalNumber: string;
  /** Filas en conflicto cuando hay más de una para el mismo vuelo: es un duplicado. */
  ids: string[];
};

/** Ventana del nivel por cercanía: un cambio de horario entre fuentes, no otro servicio. */
export const VENTANA_CERCANIA_MIN = 30;

/** "wj 3182" → "JA3182"; "ar1652" → "AR1652". */
export function numeroCanonico(raw: string): string {
  const limpio = raw.replace(/\s+/g, "").toUpperCase();
  return jetSmartCanonicalNumber(limpio) ?? limpio;
}

/** Código IATA de la aerolínea a partir del número ya canónico (los dos primeros caracteres). */
export function aerolineaDelNumero(numero: string): string | null {
  const match = /^([A-Z0-9]{2})\d/.exec(numero);
  return match ? match[1] : null;
}

function aerolineaCanonica(code: string | null | undefined, numero: string): string | null {
  const desdeNumero = aerolineaDelNumero(numero);
  if (desdeNumero) return desdeNumero;
  const c = (code ?? "").trim().toUpperCase();
  if (!c) return null;
  if (c === "WJ") return "JA";
  if (c === "AJB") return "AJ";
  return c;
}

/** Códigos con los que las fuentes nombran a la misma aerolínea ("WJ" y "JA" son JetSMART). */
const EQUIVALENTES: Record<string, string[]> = { JA: ["JA", "WJ"], WJ: ["JA", "WJ"], AJ: ["AJ", "AJB"], AJB: ["AJ", "AJB"] };

export function aerolineasEquivalentes(code: string | null | undefined): string[] {
  const c = (code ?? "").trim().toUpperCase();
  if (!c) return [];
  return EQUIVALENTES[c] ?? [c];
}

export function claveDeVuelo(aerolinea: string | null, numero: string, dia: string, sentido: string): string {
  return `${aerolinea ?? "?"}|${numero}|${dia}|${sentido}`;
}

/**
 * Origen comparable sólo si los dos tienen el mismo formato: AirLabs da IATA ("AEP") y el tablero
 * da ciudad ("Buenos Aires"). Con formatos distintos no se puede decidir y no se usa para descartar.
 */
function origenesIncompatibles(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim().toUpperCase();
  const y = (b ?? "").trim().toUpperCase();
  if (!x || !y || x === "—" || y === "—") return false;
  const esIata = (s: string) => /^[A-Z]{3}$/.test(s);
  if (esIata(x) !== esIata(y)) return false;
  return x !== y;
}

export function asociarLectura(lectura: LecturaDeVuelo, filas: readonly FilaCandidata[]): Asociacion {
  const esCodigoCompartido = Boolean(lectura.codeshareOf?.trim());
  const canonicalNumber = numeroCanonico(esCodigoCompartido ? lectura.codeshareOf! : lectura.rawNumber);
  const dia = lectura.localDay ?? (lectura.scheduledAt ? airportLocalDay(lectura.scheduledAt) : null);
  if (!dia) return { flightId: null, nivel: "SIN_DATOS", clave: null, canonicalNumber, ids: [] };

  const aerolinea = aerolineaCanonica(esCodigoCompartido ? null : lectura.airline, canonicalNumber);
  const clave = claveDeVuelo(aerolinea, canonicalNumber, dia, lectura.direction);
  const delDia = filas.filter((f) => f.direction === lectura.direction && airportLocalDay(f.scheduledAt) === dia);

  // Mismo vuelo: mismo número canónico ese día y sentido, aunque el horario haya cambiado.
  const exactas = delDia.filter((f) => numeroCanonico(f.number) === canonicalNumber);
  if (exactas.length === 1) {
    return { flightId: exactas[0].id, nivel: esCodigoCompartido ? "CODIGO_COMPARTIDO" : "EXACTO", clave, canonicalNumber, ids: [exactas[0].id] };
  }
  if (exactas.length > 1) {
    return { flightId: null, nivel: "AMBIGUO", clave, canonicalNumber, ids: exactas.map((f) => f.id) };
  }

  // Sin número igual: la misma aerolínea, del mismo origen, en la ventana. Nunca otra aerolínea:
  // el AJ325 de Neuquén no es el AR1657 de Aeroparque aunque estén a 25 minutos.
  if (!lectura.scheduledAt || !aerolinea) {
    return { flightId: null, nivel: "SIN_VUELO", clave, canonicalNumber, ids: [] };
  }
  const ventana = VENTANA_CERCANIA_MIN * 60000;
  const cercanas = delDia.filter(
    (f) =>
      aerolineaCanonica(f.airline, numeroCanonico(f.number)) === aerolinea &&
      !origenesIncompatibles(f.origin, lectura.origin) &&
      Math.abs(f.scheduledAt.getTime() - lectura.scheduledAt!.getTime()) <= ventana
  );
  if (cercanas.length === 1) {
    return { flightId: cercanas[0].id, nivel: "CERCANIA", clave, canonicalNumber, ids: [cercanas[0].id] };
  }
  if (cercanas.length > 1) {
    return { flightId: null, nivel: "AMBIGUO", clave, canonicalNumber, ids: cercanas.map((f) => f.id) };
  }
  return { flightId: null, nivel: "SIN_VUELO", clave, canonicalNumber, ids: [] };
}

/** Resultados del sync que no aplican la lectura a ninguna fila y no son una pérdida. */
const DESCARTES_ESPERADOS = new Set(["DESCARTADO_CODIGO_COMPARTIDO", "REPETIDO_EN_TABLERO", "SIN_FECHA"]);

/**
 * Diferencia entre lo que hizo el sync y lo que habría hecho el asociador, en palabras del operador.
 * null = coinciden.
 */
export function discrepancia(
  sync: { outcome: string; flightId: string | null },
  asociacion: Asociacion
): string | null {
  if (asociacion.nivel === "AMBIGUO") {
    return `${asociacion.ids.length} filas para el mismo vuelo ${asociacion.canonicalNumber} (repetido)`;
  }
  if (sync.flightId && asociacion.flightId && sync.flightId !== asociacion.flightId) {
    return `el sync la aplicó a ${sync.flightId} y por identidad corresponde a ${asociacion.flightId}`;
  }
  if (sync.flightId && !asociacion.flightId && asociacion.nivel !== "SIN_DATOS") {
    return `el sync la aplicó a ${sync.flightId} pero no hay vuelo ${asociacion.canonicalNumber} ese día`;
  }
  if (!sync.flightId && !asociacion.flightId && sync.outcome === "DESCARTADO_GEMELO") {
    return `descartada por cercanía con otro vuelo: ${asociacion.canonicalNumber} no quedó en la grilla`;
  }
  if (!sync.flightId && !asociacion.flightId && !DESCARTES_ESPERADOS.has(sync.outcome) && asociacion.nivel !== "SIN_DATOS") {
    return `${asociacion.canonicalNumber} no quedó en la grilla (${sync.outcome})`;
  }
  return null;
}

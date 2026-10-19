import { getSetting, setSetting } from "@/lib/settings/app-settings";
import { syncAirportFlights, type SyncSummary } from "./sync";

/**
 * Frescura del día en curso.
 *
 * El plan free de AirLabs publica **sólo el día en curso**: el horario de hoy no se puede
 * proyectar, hay que pedirlo. Sin una corrida programada, el pasajero que abre el checkout un
 * lunes a la mañana veía el patrón proyectado —"Horario estimado"— en vez del horario real.
 *
 * Acá se resuelve sin depender de un cron: cuando alguien mira los vuelos de HOY y el dato está
 * viejo, se sincroniza antes de listar. Con dos topes para no comerse la cuota del plan free
 * (1000 consultas/mes):
 *
 *   - `AIRPORT_REFRESH_MINUTES` (30 por defecto): si el dato tiene menos, se usa el que está.
 *   - `AIRPORT_REFRESH_MAX_PER_DAY` (12 por defecto): tope de corridas por día.
 *
 * 12 corridas × 2 consultas (arribos y salidas) = 24/día ≈ 720/mes. Si el negocio necesita más
 * frescura que eso, hay que pasar a un plan pago: el tope es de la API, no del código.
 */

export const LAST_SYNC_SETTING = "airport.lastSync";

export function minutosMinimos(): number {
  const n = Number(process.env.AIRPORT_REFRESH_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export function corridasPorDia(): number {
  const n = Number(process.env.AIRPORT_REFRESH_MAX_PER_DAY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 12;
}

/** Día en curso en hora argentina: el aeropuerto y los pasajeros viven en UTC-3. */
export function diaEnArgentina(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export type SyncState = { at: string | null; dia: string | null; corridas: number };

export type Decision = { refrescar: boolean; motivo: string };

/**
 * Decisión pura (sin red ni base): ¿hace falta pedirle el día a la API?
 *
 * Sólo el día en curso: los días futuros salen de la proyección y pedirlos gastaría cuota al
 * pedo, porque el plan free ignora el parámetro `date` y devuelve siempre hoy.
 */
export function decidirRefresco(
  estado: SyncState,
  dia: string,
  ahora: Date,
  topes: { minutos: number; maxPorDia: number } = { minutos: minutosMinimos(), maxPorDia: corridasPorDia() }
): Decision {
  if (dia !== diaEnArgentina(ahora)) {
    return { refrescar: false, motivo: "no es el día en curso" };
  }

  if (estado.dia === dia && estado.corridas >= topes.maxPorDia) {
    return { refrescar: false, motivo: "presupuesto diario agotado" };
  }

  if (estado.at) {
    const transcurrido = ahora.getTime() - new Date(estado.at).getTime();
    if (Number.isFinite(transcurrido) && transcurrido >= 0 && transcurrido < topes.minutos * 60000) {
      return { refrescar: false, motivo: "dato reciente" };
    }
  }

  return { refrescar: true, motivo: estado.at ? "dato viejo" : "sin corrida previa" };
}

export function parseState(raw: string | null): SyncState {
  if (!raw) {
    return { at: null, dia: null, corridas: 0 };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      at: typeof parsed.at === "string" ? parsed.at : null,
      dia: typeof parsed.dia === "string" ? parsed.dia : null,
      corridas: typeof parsed.corridas === "number" && Number.isFinite(parsed.corridas) ? parsed.corridas : 0
    };
  } catch {
    return { at: null, dia: null, corridas: 0 };
  }
}

export type Frescura = { sincronizado: boolean; motivo: string; resumen?: SyncSummary };

/** Una sola corrida por proceso, aunque entren diez visitas al mismo tiempo. */
let enCurso: Promise<Frescura> | null = null;

/**
 * Garantiza que los vuelos de `dia` sean datos reales y no una proyección vieja.
 * Nunca rompe: si AirLabs falla, devuelve el motivo y el front sigue con lo que hay en la base.
 */
export async function asegurarVuelosRealesDelDia(dia: string, ahora: Date = new Date()): Promise<Frescura> {
  const decision = decidirRefresco(parseState(await getSetting(LAST_SYNC_SETTING)), dia, ahora);

  if (!decision.refrescar) {
    return { sincronizado: false, motivo: decision.motivo };
  }

  if (enCurso) {
    return enCurso;
  }

  enCurso = (async () => {
    // Se anota el intento ANTES de salir: la consulta se gasta igual, falle o no.
    const previo = parseState(await getSetting(LAST_SYNC_SETTING));
    const corridas = previo.dia === dia ? previo.corridas + 1 : 1;
    await setSetting(LAST_SYNC_SETTING, JSON.stringify({ at: ahora.toISOString(), dia, corridas }));

    try {
      const resumen = await syncAirportFlights({ days: 1 });
      return { sincronizado: true, motivo: decision.motivo, resumen };
    } catch (error) {
      return { sincronizado: false, motivo: error instanceof Error ? error.message : "error al sincronizar" };
    } finally {
      enCurso = null;
    }
  })();

  return enCurso;
}

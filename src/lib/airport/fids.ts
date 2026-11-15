import type { FlightDirection } from "./provider";

/** Un tercero colgado no puede colgar la pantalla del aeropuerto (se llama al renderizar /reservar). */
const EXTERNAL_TIMEOUT_MS = 8_000;

/**
 * Tablero del aeropuerto (FIDS) como fuente de datos.
 *
 * Por qué existe: AirLabs no cubre a todas las aerolíneas que operan en CPC (American Jet, por
 * ejemplo, no está). El aeropuerto sí publica un tablero propio, en vivo, con sus vuelos y sus
 * estados, y ese tablero incluye a las que la API no tiene. Se usa como fuente **complementaria**:
 * los vuelos que ya vienen de la API no se pisan (se evitan códigos compartidos por cercanía de
 * horario) y los que no están en la API se cargan desde acá.
 *
 * Parte pura: `parseFidsBoard` no toca red, así se testea con el HTML real como fixture.
 */

export const FIDS_BASE = "https://fids.aeropuertochapelco.com/P26";
export const FIDS_PAGES: Record<FlightDirection, string> = {
  ARRIVAL: `${FIDS_BASE}/arrp24.php`,
  DEPARTURE: `${FIDS_BASE}/parp24.php`
};

export type FidsFlight = {
  /** Código de la aerolínea tal como lo publica el tablero ("JA", "AR", "AJ"). */
  airlineCode: string;
  /** Nombre completo, que el tablero trae en el alt de la imagen. */
  airlineName: string | null;
  /** Número completo, sin espacios ("JA3183"). */
  number: string;
  city: string;
  /** "13:14" (hora publicada) */
  scheduled: string;
  /** "12:52" (estima) o null */
  estimated: string | null;
  statusText: string;
  statusClass: string;
};

const HTML_ENTITIES: Record<string, string> = { "&amp;": "&", "&nbsp;": " ", "&#39;": "'", "&quot;": '"' };

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

function campo(bloque: string, clase: string): string | null {
  const m = bloque.match(new RegExp(`<div class="${clase}[^"]*"[^>]*>([\\s\\S]*?)</div>`));
  return m ? text(m[1]) : null;
}

/** Extrae los vuelos del HTML del tablero (versión de escritorio: un `<li class="dl">` por vuelo). */
export function parseFidsBoard(html: string): FidsFlight[] {
  const salida: FidsFlight[] = [];
  const bloques = html.split(/<li class="dl">/i).slice(1);

  for (const bruto of bloques) {
    const bloque = bruto.split(/<li class="dl">/i)[0];
    const c2 = campo(bloque, "c2");
    const c3 = campo(bloque, "c3");
    const c4 = campo(bloque, "c4");

    if (!c2 || !c4) continue;
    const codigo = c2.match(/^([A-Z0-9]{2})\s+(\d+)/i);
    if (!codigo) continue;

    const img = bloque.match(/<img[^>]*alt="([^"]*)"/i);
    const estima = campo(bloque, "c5");
    // El tablero publica "00:00hs" cuando todavía no tiene una estima: no es medianoche, es un
    // hueco. Guardarla como 00:00 corría el vuelo doce horas y ensuciaba el corte y la recorrida.
    const horaEstimada = (estima ?? "").replace(/hs$/i, "").trim();
    const estado = bloque.match(/<span class="estado-vuelo\s*([a-z-]*)">([^<]*)</i);

    salida.push({
      airlineCode: codigo[1].toUpperCase(),
      airlineName: img ? text(img[1]) || null : null,
      number: `${codigo[1].toUpperCase()}${codigo[2]}`,
      city: c3 ?? "",
      scheduled: c4.replace(/hs$/i, "").trim(),
      estimated: horaEstimada && horaEstimada !== "00:00" ? horaEstimada : null,
      statusText: estado ? text(estado[2]) : "—",
      statusClass: estado ? estado[1].toLowerCase() : ""
    });
  }

  return salida;
}

/** Trae y parsea el tablero. Nunca lanza: si falla, devuelve el error y la lista vacía. */
export async function fetchFidsBoard(direction: FlightDirection): Promise<{ flights: FidsFlight[]; error: string | null }> {
  try {
    const res = await fetch(FIDS_PAGES[direction], { cache: "no-store", signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) });
    if (!res.ok) return { flights: [], error: `tablero HTTP ${res.status}` };
    return { flights: parseFidsBoard(await res.text()), error: null };
  } catch (e) {
    return { flights: [], error: e instanceof Error ? e.message : "error de red" };
  }
}

/**
 * Desde qué hora de la tarde el tablero empieza a publicar los primeros vuelos del día siguiente.
 * Antes de esa hora, cualquier hora que figure en el tablero es de hoy.
 */
const HORA_DESDE_LA_QUE_EL_TABLERO_ADELANTA = 18;

/** Hasta qué hora se considera que un vuelo es de los primeros del día. */
const ULTIMA_HORA_DE_LA_MADRUGADA = 9;

/**
 * Fecha local (UTC-3) a la que corresponde un horario del tablero.
 *
 * El tablero publica la hora sin fecha, así que la fecha se infiere — y esa inferencia escribe en
 * la grilla que el pasajero puede reservar, así que tiene que ser conservadora.
 *
 * Antes la regla era «una hora que ya pasó hace más de 6 h es del día siguiente». Un sábado a las
 * 19:47 el tablero todavía listaba el JA3183 de las 12:22 con su estado «Aterrizó» (7 h 25 antes),
 * y el sync marcó como aterrizado el vuelo del **domingo**: el panel lo mostraba como «ya pasó»
 * el domingo a la mañana, antes de que el avión despegara.
 *
 * Ahora sólo se adelanta el día en el único caso en que el tablero lo hace: de noche, con los
 * primeros vuelos de la madrugada siguiente. Y un vuelo que ya aterrizó es siempre de hoy.
 */
export function fechaDelTablero(
  hora: string,
  ahora: Date = new Date(),
  estado?: "SCHEDULED" | "DELAYED" | "EN_ROUTE" | "LANDED" | "CANCELLED" | "DIVERTED"
): string | null {
  if (!/^\d{1,2}:\d{2}$/.test(hora)) return null;
  const [h, m] = hora.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  const local = new Date(ahora.getTime() - 3 * 3600 * 1000);
  const base = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m));

  // Un vuelo que ya aterrizó no puede ser de mañana: es de hoy, por más horas que hayan pasado.
  if (estado === "LANDED") return base.toISOString().slice(0, 10);

  const horaActual = local.getUTCHours() + local.getUTCMinutes() / 60;
  const esDeNoche = horaActual >= HORA_DESDE_LA_QUE_EL_TABLERO_ADELANTA;
  const esPrimerVueloDelDia = h < ULTIMA_HORA_DE_LA_MADRUGADA;
  if (esDeNoche && esPrimerVueloDelDia) base.setUTCDate(base.getUTCDate() + 1);

  return base.toISOString().slice(0, 10);
}

/**
 * El tablero etiqueta lo que ve en el aeropuerto ("Pre Embarque", "En horario") sin decir cuántos
 * minutos de demora hay. Si la estima se corre 30 min o más del horario, el vuelo está demorado
 * aunque el tablero no lo diga: el estado sale de los horarios.
 */
export function estadoSegunHorario(
  estado: "SCHEDULED" | "DELAYED" | "EN_ROUTE" | "LANDED" | "CANCELLED" | "DIVERTED",
  scheduledAt: Date,
  estimatedAt: Date | null,
  umbralMin = 30
): typeof estado {
  if (estado !== "SCHEDULED" || !estimatedAt) return estado;
  const minutos = Math.round((estimatedAt.getTime() - scheduledAt.getTime()) / 60000);
  return minutos >= umbralMin ? "DELAYED" : estado;
}

/**
 * Estado del tablero → estado nuestro, a partir del texto visible.
 *
 * La clase CSS no entra en la cuenta: puede estar desactualizada y describir otro momento del
 * vuelo. El 15/11 el tablero publicaba «En Vuelo» con la clase `arribado`, así que un avión en el
 * aire figuraba aterrizado. Ninguna clase visual prueba un estado operacional.
 */
export function mapFidsStatus(f: FidsFlight): "SCHEDULED" | "DELAYED" | "EN_ROUTE" | "LANDED" | "CANCELLED" | "DIVERTED" {
  const t = f.statusText.toLowerCase();
  if (t.includes("cancel")) return "CANCELLED";
  if (t.includes("desviad")) return "DIVERTED";
  if (t.includes("aterriz") || t.includes("arribad")) return "LANDED";
  if (t.includes("vuelo") || t.includes("despeg") || t.includes("en vuelo")) return "EN_ROUTE";
  if (t.includes("demorad") || t.includes("retrasad") || t.includes("atrasad")) return "DELAYED";
  return "SCHEDULED";
}

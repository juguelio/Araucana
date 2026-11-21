import { prisma } from "@/lib/db/prisma";

/** Ventana por defecto y máximo permitido tanto en la página como en la API. */
export const VENTANA_RECORRIDO_HORAS = 8;
export const MAX_HORAS_RECORRIDO = 24;
/** Límite global, no por chofer. Se prioriza lo reciente; la API avisa si falta historial. */
export const MAX_MUESTRAS_RECORRIDO = 50_000;
export const MAX_PUNTOS_RECORRIDO = 400;
export const DISTANCIA_MINIMA_METROS = 25;
export const MAX_PAUSA_RECORRIDO_MS = 10 * 60 * 1000;
/**
 * Umbral conservador para transporte terrestre: >180 km/h inferidos entre reportes es un salto
 * de GPS, no una distancia recorrida. También se corta ante movimiento con tiempo transcurrido 0.
 * Es una heurística de visualización, no un odómetro ni evidencia de velocidad del chofer.
 */
export const MAX_VELOCIDAD_RECORRIDO_KMH = 180;

export type MuestraCruda = {
  id?: string;
  driverId: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  driver: { name: string | null };
  vehicle: { name: string; internalNumber: string | null };
};

export type PuntoRecorrido = {
  /** [lat, lng], como los quiere Leaflet. */
  punto: [number, number];
  at: string;
};

export type Recorrido = {
  /** Identifica el inicio del segmento; independiente del orden de entrada y del recorte visual. */
  id: string;
  driverId: string;
  driverName: string | null;
  vehicleId: string;
  internalNumber: string | null;
  vehicleName: string;
  puntos: PuntoRecorrido[];
  /** Aproximación tras filtrar ruido, ANTES de reducir puntos para dibujar. Nunca incluye cortes. */
  metros: number;
  ultimaSenal: string;
  /** Muestras válidas del segmento, antes del filtrado de ruido y recorte visual. */
  muestras: number;
};

export type OpcionesRecorrido = { maxPuntos?: number; distanciaMinimaMetros?: number };
export type ResultadoRecorridos = { recorridos: Recorrido[]; horas: number; truncado: boolean };

/** Inválidos/ausentes usan 8 h; valores finitos se redondean y acotan a 1..24 h. */
export function acotarHoras(horas: unknown = VENTANA_RECORRIDO_HORAS): number {
  const numero = typeof horas === "number" ? horas
    : typeof horas === "string" && horas.trim() !== "" ? Number(horas) : NaN;
  return Number.isFinite(numero)
    ? Math.min(MAX_HORAS_RECORRIDO, Math.max(1, Math.round(numero)))
    : VENTANA_RECORRIDO_HORAS;
}

const RADIO_TIERRA_M = 6_371_000;

/** Distancia entre dos coordenadas, en metros (haversine). */
export function distanciaMetros(a: [number, number], b: [number, number]): number {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}

function fechaValida(muestra: MuestraCruda): boolean {
  return muestra.recordedAt instanceof Date && Number.isFinite(muestra.recordedAt.getTime());
}

function muestraValida(muestra: MuestraCruda): boolean {
  return fechaValida(muestra) && typeof muestra.driverId === "string" && muestra.driverId.trim() !== "" &&
    typeof muestra.vehicleId === "string" && muestra.vehicleId.trim() !== "" &&
    Number.isFinite(muestra.latitude) && Math.abs(muestra.latitude) <= 90 &&
    Number.isFinite(muestra.longitude) && Math.abs(muestra.longitude) <= 180;
}

/** Desempate determinista incluso en fixtures/importaciones sin id persistido. */
function claveMuestra(muestra: MuestraCruda): string {
  return JSON.stringify([muestra.driverId, muestra.vehicleId, muestra.recordedAt.toISOString(),
    muestra.id ?? null, muestra.latitude, muestra.longitude]);
}

function compararMuestras(a: MuestraCruda, b: MuestraCruda): number {
  return a.recordedAt.getTime() - b.recordedAt.getTime() || claveMuestra(a).localeCompare(claveMuestra(b));
}

function puntoDe(muestra: MuestraCruda): PuntoRecorrido {
  return { punto: [muestra.latitude, muestra.longitude], at: muestra.recordedAt.toISOString() };
}

/** Lista ya ordenada y válida. El endpoint se preserva incluso si cae dentro del umbral de ruido. */
function filtrarRuido(muestras: MuestraCruda[], distanciaMinima: number): PuntoRecorrido[] {
  const filtrados: PuntoRecorrido[] = [];
  for (let i = 0; i < muestras.length; i += 1) {
    const punto = puntoDe(muestras[i]);
    const anterior = filtrados.at(-1);
    if (!anterior || distanciaMetros(anterior.punto, punto.punto) >= distanciaMinima ||
      (i === muestras.length - 1 && (anterior.at !== punto.at ||
        anterior.punto[0] !== punto.punto[0] || anterior.punto[1] !== punto.punto[1]))) {
      filtrados.push(punto);
    }
  }
  return filtrados;
}

function opcionesValidas(opciones: OpcionesRecorrido) {
  const { maxPuntos = MAX_PUNTOS_RECORRIDO, distanciaMinimaMetros = DISTANCIA_MINIMA_METROS } = opciones;
  return {
    maxPuntos: Number.isFinite(maxPuntos) ? Math.max(2, Math.min(MAX_PUNTOS_RECORRIDO, Math.floor(maxPuntos))) : MAX_PUNTOS_RECORRIDO,
    distanciaMinimaMetros: Number.isFinite(distanciaMinimaMetros) ? Math.max(0, distanciaMinimaMetros) : DISTANCIA_MINIMA_METROS
  };
}

function recortarPuntos(puntos: PuntoRecorrido[], maxPuntos: number): PuntoRecorrido[] {
  if (puntos.length <= maxPuntos) return puntos;
  const paso = (puntos.length - 1) / (maxPuntos - 1);
  return Array.from({ length: maxPuntos }, (_, i) => puntos[Math.round(i * paso)]);
}

/** Para un segmento: sanea, ordena, filtra ruido y recorta conservando salida y última señal. */
export function depurarPuntos(muestras: MuestraCruda[], opciones: OpcionesRecorrido = {}): PuntoRecorrido[] {
  const { maxPuntos, distanciaMinimaMetros } = opcionesValidas(opciones);
  const ordenadas = muestras.filter(muestraValida).sort(compararMuestras);
  return recortarPuntos(filtrarRuido(ordenadas, distanciaMinimaMetros), maxPuntos);
}

export function metrosDeRecorrido(puntos: PuntoRecorrido[]): number {
  let total = 0;
  for (let i = 1; i < puntos.length; i += 1) total += distanciaMetros(puntos[i - 1].punto, puntos[i].punto);
  return Math.round(total);
}

function hayCorte(anterior: MuestraCruda, actual: MuestraCruda): boolean {
  if (anterior.vehicleId !== actual.vehicleId) return true;
  const ms = actual.recordedAt.getTime() - anterior.recordedAt.getTime();
  if (ms > MAX_PAUSA_RECORRIDO_MS) return true;
  const metros = distanciaMetros([anterior.latitude, anterior.longitude], [actual.latitude, actual.longitude]);
  return ms <= 0 ? metros > 0 : metros * 3600 / ms > MAX_VELOCIDAD_RECORRIDO_KMH;
}

/**
 * Un elemento por tramo continuo de chofer+vehículo; un cambio de vehículo, hueco, salto o coordenada
 * inválida corta la línea. No se unen visitas posteriores a la misma unidad. Los puntos solitarios
 * se conservan con 0 metros para no perder la última señal; no constituyen una línea por sí solos.
 */
export function construirRecorridos(muestras: MuestraCruda[], opciones: OpcionesRecorrido = {}): Recorrido[] {
  const { maxPuntos, distanciaMinimaMetros } = opcionesValidas(opciones);
  const porChofer = new Map<string, MuestraCruda[]>();
  for (const muestra of muestras) {
    // Una fecha ilegible no tiene posición temporal fiable; no puede ordenarse ni serializarse.
    if (!fechaValida(muestra) || typeof muestra.driverId !== "string" || !muestra.driverId.trim()) continue;
    const lista = porChofer.get(muestra.driverId);
    if (lista) lista.push(muestra);
    else porChofer.set(muestra.driverId, [muestra]);
  }

  const recorridos: Recorrido[] = [];
  function agregar(segmento: MuestraCruda[]) {
    if (!segmento.length) return;
    const ultima = segmento[segmento.length - 1];
    const depurados = filtrarRuido(segmento, distanciaMinimaMetros);
    recorridos.push({
      id: claveMuestra(segmento[0]),
      driverId: ultima.driverId,
      driverName: ultima.driver?.name?.trim() || null,
      vehicleId: ultima.vehicleId,
      internalNumber: ultima.vehicle?.internalNumber?.trim() || null,
      vehicleName: ultima.vehicle?.name?.trim() || "",
      puntos: recortarPuntos(depurados, maxPuntos),
      metros: metrosDeRecorrido(depurados),
      ultimaSenal: ultima.recordedAt.toISOString(),
      muestras: segmento.length
    });
  }
  for (const lista of porChofer.values()) {
    let segmento: MuestraCruda[] = [];
    for (const muestra of lista.sort(compararMuestras)) {
      if (!muestraValida(muestra)) {
        agregar(segmento);
        segmento = [];
        continue;
      }
      const anterior = segmento.at(-1);
      if (anterior && hayCorte(anterior, muestra)) {
        agregar(segmento);
        segmento = [];
      }
      segmento.push(muestra);
    }
    agregar(segmento);
  }
  return recorridos.sort((a, b) => b.metros - a.metros || a.id.localeCompare(b.id));
}

const SELECT_MUESTRA = {
  id: true, driverId: true, vehicleId: true, latitude: true, longitude: true, recordedAt: true,
  driver: { select: { name: true } },
  vehicle: { select: { name: true, internalNumber: true } }
} as const;

/** Una fila extra detecta truncamiento sin un COUNT ni una lectura ilimitada. */
export async function cargarRecorridosResultado(
  horas: number = VENTANA_RECORRIDO_HORAS,
  ahora: Date = new Date()
): Promise<ResultadoRecorridos> {
  const acotadas = acotarHoras(horas);
  const desde = new Date(ahora.getTime() - acotadas * 60 * 60 * 1000);
  const muestras = await prisma.driverLocationSample.findMany({
    where: { recordedAt: { gte: desde, lte: ahora } },
    select: SELECT_MUESTRA,
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: MAX_MUESTRAS_RECORRIDO + 1
  });
  return {
    recorridos: construirRecorridos(muestras.slice(0, MAX_MUESTRAS_RECORRIDO)),
    horas: acotadas,
    truncado: muestras.length > MAX_MUESTRAS_RECORRIDO
  };
}

/** Compatibilidad con la página server: la API usa el resultado completo para avisar truncamiento. */
export async function cargarRecorridos(
  horas: number = VENTANA_RECORRIDO_HORAS,
  ahora: Date = new Date()
): Promise<Recorrido[]> {
  return (await cargarRecorridosResultado(horas, ahora)).recorridos;
}

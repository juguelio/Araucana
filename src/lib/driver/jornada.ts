import { distanciaMetros, DISTANCIA_MINIMA_METROS, MAX_PAUSA_RECORRIDO_MS, MAX_VELOCIDAD_RECORRIDO_KMH } from "./recorrido";

/**
 * Resumen de la jornada de cada unidad: qué hizo hoy, no dónde está ahora.
 *
 * El mapa en vivo contesta «dónde está». Lo que el dueño de la empresa pregunta al cerrar el día es
 * otra cosa: cuántos kilómetros hizo cada unidad, cuánto estuvo en movimiento, dónde se quedó parada y
 * si hubo algo raro (sin señal, exceso de velocidad, saltos de GPS). Eso es lo que se factura y lo que
 * se audita, y sale del mismo `DriverLocationSample` que ya guarda la app del chofer: no hace falta
 * una tabla nueva ni un proceso en background.
 *
 * Los cruces con la realidad (qué es «exceso» en estas rutas, si una parada de 40 minutos es normal)
 * son decisiones del cliente: acá viven como constantes visibles y el texto de la pantalla muestra el
 * número que se está aplicando.
 */

/** Una parada cuenta como tal desde este umbral; abajo de eso es trámite en la puerta. */
export const PARADA_MINIMA_MINUTOS = 5;

/**
 * Límite de velocidad que se marca como exceso. Es un valor conservador para rutas de montaña; el
 * cliente tiene que confirmarlo (o dar uno por unidad) antes de que esto se use para sancionar.
 */
export const LIMITE_VELOCIDAD_KMH = 80;

/** Pasado este rato sin reportar, la unidad deja de considerarse «en vivo». */
export const MINUTOS_SIN_SENAL = 10;

/** Un salto mayor a esto entre dos reportes no es un viaje: es GPS perdido o cambio de unidad. */
export const SALTO_MAXIMO_METROS = 3_000;

/**
 * Un hueco más largo que esto no es «se quedó sin señal en medio del servicio»: es el rato entre dos
 * servicios (la unidad espera en la base y el chofer apaga el envío). No se cuenta como detenida ni
 * como un corte que haya que revisar.
 */
export const MAX_HUECO_CONFIABLE_MINUTOS = 60;

export type MuestraDeJornada = {
  driverId: string;
  driverName?: string | null;
  vehicleId: string;
  vehicleName?: string | null;
  internalNumber?: string | null;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  isStopped: boolean;
  stoppedDurationSeconds: number;
  reportedSpeedKmh: number | null;
  inferredSpeedKmh: number | null;
};

export type Parada = {
  desde: string;
  hasta: string;
  minutos: number;
  latitude: number;
  longitude: number;
};

export type JornadaDeUnidad = {
  clave: string;
  driverId: string;
  driverName: string | null;
  vehicleId: string;
  vehicleName: string;
  internalNumber: string | null;
  km: number;
  minutosEnMovimiento: number;
  minutosDetenido: number;
  velocidadMaximaKmh: number | null;
  velocidadMaximaEn: string | null;
  velocidadMaximaPunto: [number, number] | null;
  primeraSenal: string;
  ultimaSenal: string;
  ultimaPosicion: [number, number];
  muestras: number;
  paradas: Parada[];
  /** Huecos de más de 10 minutos entre dos reportes: la unidad estuvo fuera del mapa un rato. */
  huecos: number;
};

export type TipoDeAlerta = "sin-senal" | "exceso-de-velocidad" | "sin-actividad" | "senal-dudosa";

export type AlertaDeJornada = {
  tipo: TipoDeAlerta;
  severidad: "alta" | "media" | "baja";
  driverId: string;
  vehicleId: string;
  /** Texto listo para pantalla, con el número que la dispara. */
  texto: string;
  /** Hora (ISO) del evento que disparó la alerta, cuando aplica. */
  ocurrioEn?: string | null;
  /** Coordenadas del evento (exceso de velocidad o última posición con señal). */
  latitude?: number | null;
  longitude?: number | null;
};

export type ResumenDelDia = {
  jornadas: JornadaDeUnidad[];
  alertas: AlertaDeJornada[];
  totales: { km: number; minutosEnMovimiento: number; minutosDetenido: number; unidades: number; muestras: number };
};

const MINUTO_MS = 60_000;

function redondear(valor: number, decimales = 0) {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

function claveDe(muestra: MuestraDeJornada) {
  return `${muestra.driverId}::${muestra.vehicleId}`;
}

function horaArgentina(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires"
  });
}

/** Un reporte vale si tiene coordenadas usables y una fecha real: sin eso no hay jornada que contar. */
function muestraValida(muestra: MuestraDeJornada) {
  return (
    Number.isFinite(muestra.latitude) &&
    Number.isFinite(muestra.longitude) &&
    Math.abs(muestra.latitude) <= 90 &&
    Math.abs(muestra.longitude) <= 180 &&
    muestra.recordedAt instanceof Date &&
    Number.isFinite(muestra.recordedAt.getTime())
  );
}

/**
 * Distancia del día. Usa el mismo criterio que el mapa: descarta el temblor del GPS quieto (<25 m),
 * y no suma saltos imposibles (más de 3 km o a una velocidad que ningún vehículo alcanza) — si no,
 * un solo reporte perdido infla el kilometraje que después se factura.
 */
function kilometros(ordenadas: MuestraDeJornada[]) {
  let metros = 0;
  for (let i = 1; i < ordenadas.length; i += 1) {
    const anterior = ordenadas[i - 1];
    const actual = ordenadas[i];
    const ms = actual.recordedAt.getTime() - anterior.recordedAt.getTime();
    const distancia = distanciaMetros(
      [anterior.latitude, anterior.longitude],
      [actual.latitude, actual.longitude]
    );
    if (distancia < DISTANCIA_MINIMA_METROS) continue;
    if (distancia > SALTO_MAXIMO_METROS) continue;
    if (ms > 0 && (distancia * 3_600) / ms > MAX_VELOCIDAD_RECORRIDO_KMH) continue;
    metros += distancia;
  }
  return redondear(metros / 1000, 1);
}

/** Corre una parada mientras los reportes digan «detenida»; un reporte en movimiento la corta. */
function paradas(ordenadas: MuestraDeJornada[]): Parada[] {
  const encontradas: Parada[] = [];
  let inicio: MuestraDeJornada | null = null;
  let ultima: MuestraDeJornada | null = null;

  const cerrar = () => {
    if (!inicio || !ultima) return;
    const minutos = redondear((ultima.recordedAt.getTime() - inicio.recordedAt.getTime()) / MINUTO_MS);
    if (minutos >= PARADA_MINIMA_MINUTOS) {
      encontradas.push({
        desde: inicio.recordedAt.toISOString(),
        hasta: ultima.recordedAt.toISOString(),
        minutos,
        latitude: inicio.latitude,
        longitude: inicio.longitude
      });
    }
    inicio = null;
    ultima = null;
  };

  for (let i = 0; i < ordenadas.length; i += 1) {
    const muestra = ordenadas[i];
    if (muestra.isStopped) {
      inicio ??= muestra;
      ultima = muestra;
    } else {
      cerrar();
    }
  }
  cerrar();
  return encontradas;
}

/** Minutos de cada tramo entre reportes, separando lo que se movió de lo que estuvo quieto. */
function tiempos(ordenadas: MuestraDeJornada[]) {
  let enMovimiento = 0;
  let detenido = 0;
  let huecos = 0;

  for (let i = 1; i < ordenadas.length; i += 1) {
    const anterior = ordenadas[i - 1];
    const actual = ordenadas[i];
    const ms = actual.recordedAt.getTime() - anterior.recordedAt.getTime();
    if (ms <= 0) continue;
    const minutos = ms / MINUTO_MS;
    // Entre servicios no se cuenta nada: ni movimiento, ni parada, ni corte.
    if (minutos > MAX_HUECO_CONFIABLE_MINUTOS) continue;
    if (actual.isStopped && anterior.isStopped) {
      // Quieta de punta a punta: aunque el teléfono haya perdido señal, estuvo detenida ese rato.
      detenido += minutos;
      continue;
    }
    if (ms > MAX_PAUSA_RECORRIDO_MS) {
      huecos += 1;
      continue;
    }
    if (actual.isStopped) detenido += minutos;
    else enMovimiento += minutos;
  }

  return { enMovimiento: redondear(enMovimiento), detenido: redondear(detenido), huecos };
}

function picoDeVelocidad(ordenadas: MuestraDeJornada[]): {
  kmh: number | null;
  en: string | null;
  punto: [number, number] | null;
} {
  let maxima: number | null = null;
  let en: string | null = null;
  let punto: [number, number] | null = null;
  for (const muestra of ordenadas) {
    const velocidad = muestra.reportedSpeedKmh ?? muestra.inferredSpeedKmh;
    if (velocidad == null || !Number.isFinite(velocidad)) continue;
    if (velocidad > MAX_VELOCIDAD_RECORRIDO_KMH) continue;
    if (maxima == null || velocidad > maxima) {
      maxima = velocidad;
      en = muestra.recordedAt.toISOString();
      punto = [muestra.latitude, muestra.longitude];
    }
  }
  return { kmh: maxima == null ? null : redondear(maxima), en, punto };
}

/**
 * Arma una jornada por chofer+unidad. Se agrupa por unidad y no sólo por chofer porque el resumen se
 * usa para facturar el vehículo: si dos choferes se turnaron la misma nave, son dos jornadas distintas.
 */
export function armarJornadas(muestras: MuestraDeJornada[]): JornadaDeUnidad[] {
  const grupos = new Map<string, MuestraDeJornada[]>();
  for (const muestra of muestras) {
    if (!muestraValida(muestra)) continue;
    if (!muestra.driverId?.trim() || !muestra.vehicleId?.trim()) continue;
    const clave = claveDe(muestra);
    const lista = grupos.get(clave);
    if (lista) lista.push(muestra);
    else grupos.set(clave, [muestra]);
  }

  const jornadas: JornadaDeUnidad[] = [];
  for (const [clave, lista] of grupos) {
    const ordenadas = [...lista].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    const primera = ordenadas[0];
    const ultima = ordenadas.at(-1)!;
    const { enMovimiento, detenido, huecos } = tiempos(ordenadas);
    const pico = picoDeVelocidad(ordenadas);
    jornadas.push({
      clave,
      driverId: primera.driverId,
      driverName: primera.driverName?.trim() || null,
      vehicleId: primera.vehicleId,
      vehicleName: primera.vehicleName?.trim() || "",
      internalNumber: primera.internalNumber?.trim() || null,
      km: kilometros(ordenadas),
      minutosEnMovimiento: enMovimiento,
      minutosDetenido: detenido,
      velocidadMaximaKmh: pico.kmh,
      velocidadMaximaEn: pico.en,
      velocidadMaximaPunto: pico.punto,
      primeraSenal: primera.recordedAt.toISOString(),
      ultimaSenal: ultima.recordedAt.toISOString(),
      ultimaPosicion: [ultima.latitude, ultima.longitude],
      muestras: ordenadas.length,
      paradas: paradas(ordenadas),
      huecos
    });
  }

  return jornadas.sort((a, b) => b.km - a.km || (a.driverName ?? "").localeCompare(b.driverName ?? ""));
}

function nombreDe(jornada: JornadaDeUnidad) {
  const unidad = jornada.internalNumber ?? jornada.vehicleName;
  return jornada.driverName ? `${jornada.driverName} · ${unidad}` : unidad;
}

/**
 * Alertas que piden una decisión del operador. Se generan sólo con lo que el sistema sabe: no se
 * inventan infracciones ni se comparan contra un límite que el cliente no confirmó — el texto dice
 * el número aplicado para que se pueda discutir.
 *
 * `esHoy`: cuando se consulta un día pasado, no tiene sentido decir «dejó de reportar hace 1400 min»;
 * ese día ya cerró. Para días cerrados sólo quedan excesos, cortes en medio de la jornada y unidades
 * que reportaron sin moverse.
 */
export function alertasDeJornadas(
  jornadas: JornadaDeUnidad[],
  opciones: { ahora?: Date; limiteVelocidadKmh?: number; minutosSinSenal?: number; esHoy?: boolean } = {}
): AlertaDeJornada[] {
  const ahora = opciones.ahora ?? new Date();
  const limite = opciones.limiteVelocidadKmh ?? LIMITE_VELOCIDAD_KMH;
  const sinSenal = opciones.minutosSinSenal ?? MINUTOS_SIN_SENAL;
  const esHoy = opciones.esHoy ?? true;
  const alertas: AlertaDeJornada[] = [];

  for (const jornada of jornadas) {
    const minutosDesdeLaUltima = Math.round((ahora.getTime() - new Date(jornada.ultimaSenal).getTime()) / MINUTO_MS);

    if (esHoy && minutosDesdeLaUltima > sinSenal) {
      const duracion = minutosDesdeLaUltima < 60 ? `${minutosDesdeLaUltima} min` : minutosAHoras(minutosDesdeLaUltima);
      const pos = jornada.ultimaPosicion ?? null;
      alertas.push({
        tipo: "sin-senal",
        severidad: minutosDesdeLaUltima >= 30 ? "alta" : "media",
        driverId: jornada.driverId,
        vehicleId: jornada.vehicleId,
        ocurrioEn: jornada.ultimaSenal,
        latitude: pos ? pos[0] : null,
        longitude: pos ? pos[1] : null,
        texto: `${nombreDe(jornada)} sin señal desde las ${horaArgentina(jornada.ultimaSenal)} (dejó de reportar hace ${duracion})`
      });
    }

    if (jornada.velocidadMaximaKmh != null && jornada.velocidadMaximaKmh > limite) {
      const pos = jornada.velocidadMaximaPunto ?? jornada.ultimaPosicion ?? null;
      const cuando = jornada.velocidadMaximaEn ? ` a las ${horaArgentina(jornada.velocidadMaximaEn)}` : "";
      alertas.push({
        tipo: "exceso-de-velocidad",
        severidad: jornada.velocidadMaximaKmh > limite + 20 ? "alta" : "media",
        driverId: jornada.driverId,
        vehicleId: jornada.vehicleId,
        ocurrioEn: jornada.velocidadMaximaEn ?? jornada.ultimaSenal,
        latitude: pos ? pos[0] : null,
        longitude: pos ? pos[1] : null,
        texto: `${nombreDe(jornada)} llegó a ${jornada.velocidadMaximaKmh} km/h${cuando} (límite ${limite})`
      });
    }

    if (jornada.muestras > 1 && jornada.km < 0.5 && jornada.minutosEnMovimiento < 5) {
      const pos = jornada.ultimaPosicion ?? null;
      alertas.push({
        tipo: "sin-actividad",
        severidad: "baja",
        driverId: jornada.driverId,
        vehicleId: jornada.vehicleId,
        ocurrioEn: jornada.ultimaSenal,
        latitude: pos ? pos[0] : null,
        longitude: pos ? pos[1] : null,
        texto: `${nombreDe(jornada)} reportó todo el día sin moverse del lugar`
      });
    }

    if (jornada.huecos >= 3) {
      alertas.push({
        tipo: "senal-dudosa",
        severidad: "media",
        driverId: jornada.driverId,
        vehicleId: jornada.vehicleId,
        ocurrioEn: jornada.ultimaSenal,
        texto: `${nombreDe(jornada)} tuvo ${jornada.huecos} cortes de señal en el día`
      });
    }
  }

  const orden: Record<AlertaDeJornada["severidad"], number> = { alta: 0, media: 1, baja: 2 };
  return alertas.sort((a, b) => orden[a.severidad] - orden[b.severidad] || a.texto.localeCompare(b.texto));
}

export function resumirDia(
  muestras: MuestraDeJornada[],
  opciones: { ahora?: Date; esHoy?: boolean } = {}
): ResumenDelDia {
  const jornadas = armarJornadas(muestras);
  return {
    jornadas,
    alertas: alertasDeJornadas(jornadas, opciones),
    totales: {
      unidades: jornadas.length,
      km: redondear(jornadas.reduce((total, jornada) => total + jornada.km, 0), 1),
      minutosEnMovimiento: jornadas.reduce((total, jornada) => total + jornada.minutosEnMovimiento, 0),
      minutosDetenido: jornadas.reduce((total, jornada) => total + jornada.minutosDetenido, 0),
      muestras: jornadas.reduce((total, jornada) => total + jornada.muestras, 0)
    }
  };
}

/**
 * Rango UTC del día calendario argentino. Las columnas son `timestamp without time zone` y la app
 * escribe UTC; pedir «el día 20» con los bordes en UTC devuelve el día equivocado a partir de las 21.
 */
export function rangoDelDia(fecha: string | Date, husoMinutos = -180): { desde: Date; hasta: Date } | null {
  const texto = typeof fecha === "string" ? fecha : fecha.toISOString().slice(0, 10);
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) return null;
  const [, anio, mes, dia] = partes.map(Number);
  const inicioLocal = Date.UTC(anio, mes - 1, dia, 0, 0, 0);
  const comprobacion = new Date(inicioLocal);
  if (comprobacion.getUTCFullYear() !== anio || comprobacion.getUTCMonth() !== mes - 1 || comprobacion.getUTCDate() !== dia) {
    return null;
  }
  const desde = new Date(inicioLocal - husoMinutos * MINUTO_MS);
  return { desde, hasta: new Date(desde.getTime() + 24 * 60 * MINUTO_MS) };
}

/** Fecha del día argentino para una hora dada, en el formato que usa el input de fecha. */
export function fechaLocal(instante: Date, husoMinutos = -180) {
  return new Date(instante.getTime() + husoMinutos * MINUTO_MS).toISOString().slice(0, 10);
}

export function minutosAHoras(minutos: number) {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

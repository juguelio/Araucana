import type { FlotaEnVivo, NaveEnVivo } from "./en-vivo";
import { minutosAHoras } from "./jornada";

/**
 * Servicios del día cruzados con la unidad asignada.
 *
 * El tablero (`/admin/salidas-del-dia`) dice qué hay que cubrir y permite asignar nave y chofer. Lo que
 * no dice es si esa unidad está viva: si hace media hora que no reporta o si está parada desde las 7.
 * Ese cruce es lo que convierte «está asignada» en «está cubierta».
 *
 * Todo se calcula desde la lista de posiciones que la pantalla ya trae (`FlotaEnVivo`): no hay consulta
 * extra ni tabla nueva.
 */

export type AreaDeServicio = "RUTA" | "AEROPUERTO" | "CHAPELCO" | "ESPECIAL";

export type UnidadDeServicio = {
  vehicleId: string;
  vehicleName: string;
  internalNumber: string | null;
  driverId: string | null;
  driverName: string | null;
};

export type ServicioDelDia = {
  id: string;
  area: AreaDeServicio;
  /** Hora de salida (o primer ascenso); `null` si el servicio no tiene hora cargada. */
  at: Date | null;
  /** Hora estimada de cierre del servicio (llegada a destino, fin del reparto o del viaje especial). */
  endsAt?: Date | null;
  titulo: string;
  detalle: string | null;
  unidades: UnidadDeServicio[];
  pasajeros: number;
  href: string;
};

export type NivelDeServicio =
  | "sin-unidad"
  | "en-riesgo"
  | "en-curso"
  | "atencion"
  | "listo"
  | "pasado"
  | "futuro";

export type EstadoDeUnidadEnServicio = {
  vehicleId: string;
  estado: NaveEnVivo["estado"] | "sin-posicion";
  minutos: number | null;
  recordedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number | null;
};

/** Otra salida del día que se lleva la misma unidad en horario superpuesto. */
export type ChoqueDeUnidad = {
  vehicleId: string;
  /** «Araucana 24»: la unidad que se repite. */
  unidad: string;
  /** Id del otro servicio, para saltar a él. */
  servicioId: string;
  /** «13:00 · San Martín de los Andes → Aeropuerto Chapelco (CPC)». */
  etiqueta: string;
  href: string;
};

export type ServicioEvaluado = ServicioDelDia & {
  nivel: NivelDeServicio;
  /** Texto corto con el motivo, listo para la fila. */
  motivo: string;
  /** Minutos que faltan para la hora del servicio (negativo si ya arrancó). */
  minutosParaSalir: number | null;
  /** true cuando el servicio ya arrancó pero todavía no terminó su ventana operativa. */
  enCurso: boolean;
  /** Estado de cada unidad asignada, para pintar el punto de color y cruzar con el mapa. */
  estados: EstadoDeUnidadEnServicio[];
  /** Otras salidas que usan la misma unidad en horario superpuesto (una nave no puede estar en dos). */
  choques: ChoqueDeUnidad[];
};

export type ResumenDeServicios = {
  total: number;
  enRiesgo: number;
  sinUnidad: number;
  enCurso: number;
  listos: number;
  finalizados: number;
  evaluados: ServicioEvaluado[];
};

/** Una unidad que reporta dentro de este rango se considera recién vista. */
const RECIEN_VISTA_MINUTOS = 10;
/** Con menos de esto para salir, una unidad detenida ya es un problema, no una espera. */
export const AVISO_PREVIO_MINUTOS = 90;
/** Si la unidad no se movió en todo este rato antes del servicio, no va a llegar sola. */
const DETENIDA_CRITICA_MINUTOS = 20;
/** Si un servicio no trae `endsAt`, se considera en curso durante esta ventana después de su hora de salida. */
const DURACION_EN_CURSO_POR_DEFECTO_MIN = 90;

const ORDEN: Record<NivelDeServicio, number> = {
  "sin-unidad": 0,
  "en-riesgo": 1,
  "en-curso": 2,
  atencion: 3,
  listo: 4,
  futuro: 5,
  pasado: 6
};

function minutosEntre(desde: Date, hasta: Date) {
  return Math.round((hasta.getTime() - desde.getTime()) / 60_000);
}

function buscarNave(flota: FlotaEnVivo | null, vehicleId: string): NaveEnVivo | null {
  if (!flota) return null;
  return flota.naves.find((nave) => nave.vehicleId === vehicleId) ?? null;
}

function duracionHumana(minutos: number) {
  return minutos < 60 ? `${minutos} min` : minutosAHoras(minutos);
}

/**
 * Evalúa un servicio contra la flota. Las reglas, en orden:
 *
 * 1. Si el servicio ya cerró su ventana (`ahora > endsAt` o `minutosParaSalir < -90` sin `endsAt`), es `pasado`.
 * 2. Si el servicio está dentro de su ventana operativa (`at <= ahora <= endsAt`), está `enCurso`:
 *    - Sin nave asignada → `sin-unidad` ("en horario de servicio sin nave").
 *    - Unidad sin señal o sin posición → `en-riesgo` ("en servicio y sin señal hace X").
 *    - Unidad reportando / en movimiento → `en-curso` ("en curso · unidad reportando").
 * 3. Antes de salir:
 *    - Sin unidad asignada y cerca (`<= AVISO_PREVIO_MINUTOS`) → `sin-unidad`.
 *    - Unidad sin posición o sin señal → `en-riesgo` si falta poco; `atencion` o `futuro` si falta más.
 *    - Unidad detenida hace rato con el servicio encima → `en-riesgo`.
 *    - Unidad en movimiento → `listo`.
 */
export function evaluarServicio(
  servicio: ServicioDelDia,
  flota: FlotaEnVivo | null,
  opciones: { ahora?: Date; avisoPrevioMinutos?: number } = {}
): ServicioEvaluado {
  const ahora = opciones.ahora ?? new Date();
  const aviso = opciones.avisoPrevioMinutos ?? AVISO_PREVIO_MINUTOS;
  const minutosParaSalir = servicio.at ? minutosEntre(ahora, servicio.at) : null;
  const finEstimado =
    servicio.endsAt ??
    (servicio.at ? new Date(servicio.at.getTime() + DURACION_EN_CURSO_POR_DEFECTO_MIN * 60_000) : null);

  const yaArranco = minutosParaSalir != null && minutosParaSalir <= 0;
  const yaTermino =
    finEstimado != null
      ? ahora.getTime() > finEstimado.getTime()
      : minutosParaSalir != null && minutosParaSalir < -DURACION_EN_CURSO_POR_DEFECTO_MIN;
  const enCurso = Boolean(yaArranco && !yaTermino);
  const cerca = Boolean(!yaTermino && minutosParaSalir != null && minutosParaSalir <= aviso);

  const estados: EstadoDeUnidadEnServicio[] = servicio.unidades.map((unidad) => {
    const nave = buscarNave(flota, unidad.vehicleId);
    if (!nave) {
      return {
        vehicleId: unidad.vehicleId,
        estado: "sin-posicion" as const,
        minutos: null,
        recordedAt: null,
        latitude: null,
        longitude: null,
        speedKmh: null
      };
    }
    return {
      vehicleId: unidad.vehicleId,
      estado: nave.estado,
      minutos: nave.minutosDesdeLaSenal,
      recordedAt: nave.recordedAt,
      latitude: nave.latitude,
      longitude: nave.longitude,
      speedKmh: nave.speedKmh
    };
  });

  // Los choques entre salidas se calculan con el día entero: un servicio solo no puede saberlos.
  const base = { ...servicio, minutosParaSalir, enCurso, estados, choques: [] as ChoqueDeUnidad[] };

  if (yaTermino) return { ...base, nivel: "pasado", motivo: "servicio finalizado" };

  if (servicio.unidades.length === 0) {
    return {
      ...base,
      nivel: cerca ? "sin-unidad" : "futuro",
      motivo: enCurso ? "en horario de servicio sin nave" : cerca ? "falta asignar nave" : "todavía sin nave"
    };
  }

  const sinPosicion = estados.filter((estado) => estado.estado === "sin-posicion").length;
  const sinSenal = estados.filter((estado) => estado.estado === "sin-senal");
  const detenidas = estados.filter((estado) => estado.estado === "detenida");
  const vivas = estados.filter((estado) => estado.estado === "en-movimiento");

  if (sinPosicion > 0 && vivas.length === 0) {
    return {
      ...base,
      nivel: cerca ? "en-riesgo" : "futuro",
      motivo: cerca
        ? `${sinPosicion} unidad${sinPosicion === 1 ? "" : "es"} sin posición`
        : "todavía sin posición"
    };
  }

  if (sinSenal.length > 0 && vivas.length === 0) {
    const peor = sinSenal.reduce((max, estado) => Math.max(max, estado.minutos ?? 0), 0);
    return {
      ...base,
      nivel: cerca || peor >= 30 ? "en-riesgo" : "atencion",
      motivo: `${enCurso ? "en servicio · " : ""}sin señal hace ${duracionHumana(peor)}`
    };
  }

  if (enCurso) {
    if (vivas.length > 0) {
      const vel = vivas[0].speedKmh;
      return {
        ...base,
        nivel: "en-curso",
        motivo: vel != null && vel > 0 ? `en curso · ${Math.round(vel)} km/h` : "en curso · unidad en movimiento"
      };
    }
    return { ...base, nivel: "en-curso", motivo: "en curso · unidad detenida en parada" };
  }

  if (detenidas.length > 0 && vivas.length === 0) {
    if (cerca) {
      const quieta = detenidas.reduce((max, estado) => Math.max(max, estado.minutos ?? 0), 0);
      return { ...base, nivel: quieta >= DETENIDA_CRITICA_MINUTOS ? "en-riesgo" : "atencion", motivo: "unidad detenida" };
    }
    return { ...base, nivel: "atencion", motivo: "unidad detenida" };
  }

  if (vivas.length > 0) {
    return { ...base, nivel: "listo", motivo: "unidad en movimiento" };
  }

  const recienVistas = estados.filter((estado) => (estado.minutos ?? Infinity) <= RECIEN_VISTA_MINUTOS);
  if (recienVistas.length > 0) return { ...base, nivel: "listo", motivo: "unidad reportando" };

  return { ...base, nivel: cerca ? "atencion" : "futuro", motivo: "sin novedad" };
}


const horaCorta = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

/** Ventana en la que la unidad está tomada: de la salida al cierre (o 90 min si el servicio no dice cuándo termina). */
function ventanaDe(servicio: ServicioDelDia) {
  if (!servicio.at) return null;
  const inicio = servicio.at.getTime();
  const fin = servicio.endsAt ? servicio.endsAt.getTime() : inicio + DURACION_EN_CURSO_POR_DEFECTO_MIN * 60_000;
  return { inicio, fin: Math.max(fin, inicio + 1) };
}

function etiquetaDe(servicio: ServicioDelDia) {
  const hora = servicio.at ? horaCorta.format(servicio.at) : "sin hora";
  return `${hora} · ${servicio.titulo}`;
}

/** «Araucana 24» o, si la salida no trae el interno, el nombre del vehículo. */
function nombreDeLaUnidad(unidad: UnidadDeServicio) {
  return unidad.internalNumber ? `Interno ${unidad.internalNumber}` : unidad.vehicleName;
}

/**
 * Una misma unidad no puede cubrir dos salidas a la vez. Esto cruza el día consigo mismo: para cada
 * unidad, busca las salidas cuya ventana se superpone. En el tablero de servicios se veía «Araucana 24»
 * en cuatro salidas del día, dos de ellas a la misma hora, y nada lo decía.
 *
 * Sólo se miran las salidas que todavía no terminaron: un choque de la mañana ya pasó y no pide nada.
 */
export function detectarChoquesDeUnidades(
  servicios: ServicioDelDia[],
  ahora: Date = new Date()
): Map<string, ChoqueDeUnidad[]> {
  const vigentes = servicios
    .map((servicio) => ({ servicio, ventana: ventanaDe(servicio) }))
    .filter((item): item is { servicio: ServicioDelDia; ventana: { inicio: number; fin: number } } =>
      item.ventana != null && item.ventana.fin > ahora.getTime()
    );

  const porUnidad = new Map<string, Array<{ servicio: ServicioDelDia; ventana: { inicio: number; fin: number }; unidad: UnidadDeServicio }>>();
  for (const { servicio, ventana } of vigentes) {
    for (const unidad of servicio.unidades) {
      const lista = porUnidad.get(unidad.vehicleId) ?? [];
      lista.push({ servicio, ventana, unidad });
      porUnidad.set(unidad.vehicleId, lista);
    }
  }

  const choques = new Map<string, ChoqueDeUnidad[]>();
  const sumar = (servicioId: string, choque: ChoqueDeUnidad) => {
    const lista = choques.get(servicioId) ?? [];
    if (!lista.some((item) => item.servicioId === choque.servicioId && item.vehicleId === choque.vehicleId)) lista.push(choque);
    choques.set(servicioId, lista);
  };

  for (const [vehicleId, asignaciones] of porUnidad) {
    if (asignaciones.length < 2) continue;
    for (let i = 0; i < asignaciones.length; i += 1) {
      for (let j = i + 1; j < asignaciones.length; j += 1) {
        const a = asignaciones[i];
        const b = asignaciones[j];
        if (a.ventana.inicio >= b.ventana.fin || b.ventana.inicio >= a.ventana.fin) continue;
        sumar(a.servicio.id, {
          vehicleId,
          unidad: nombreDeLaUnidad(a.unidad),
          servicioId: b.servicio.id,
          etiqueta: etiquetaDe(b.servicio),
          href: b.servicio.href
        });
        sumar(b.servicio.id, {
          vehicleId,
          unidad: nombreDeLaUnidad(b.unidad),
          servicioId: a.servicio.id,
          etiqueta: etiquetaDe(a.servicio),
          href: a.servicio.href
        });
      }
    }
  }

  return choques;
}

/** El motivo, en una línea: «misma nave en 2 servicios · también 13:00». */
function motivoDeChoque(choques: ChoqueDeUnidad[]) {
  const horas = [...new Set(choques.map((choque) => choque.etiqueta.split(" · ")[0]))];
  const cuantos = choques.length + 1;
  return `misma nave en ${cuantos} servicios · también ${horas.join(" y ")}`;
}

/** Evalúa todo el día y ordena por urgencia: primero lo que hay que resolver y arranca antes. */
export function evaluarServiciosDelDia(
  servicios: ServicioDelDia[],
  flota: FlotaEnVivo | null,
  opciones: { ahora?: Date; avisoPrevioMinutos?: number } = {}
): ResumenDeServicios {
  const ahora = opciones.ahora ?? new Date();
  const choquesPorServicio = detectarChoquesDeUnidades(servicios, ahora);

  const evaluados = servicios
    .map((servicio) => {
      const evaluado = evaluarServicio(servicio, flota, opciones);
      const choques = choquesPorServicio.get(servicio.id) ?? [];
      if (choques.length === 0) return { ...evaluado, choques };
      // Una nave en dos salidas a la vez no es «listo» ni «en curso»: no puede cubrir las dos.
      const conChoque: NivelDeServicio =
        evaluado.nivel === "pasado" || evaluado.nivel === "sin-unidad" ? evaluado.nivel : "en-riesgo";
      return { ...evaluado, nivel: conChoque, motivo: motivoDeChoque(choques), choques };
    })
    .sort((a, b) => {
      const porNivel = ORDEN[a.nivel] - ORDEN[b.nivel];
      if (porNivel !== 0) return porNivel;
      return (a.minutosParaSalir ?? 9_999) - (b.minutosParaSalir ?? 9_999);
    });

  return {
    total: evaluados.length,
    enRiesgo: evaluados.filter((servicio) => servicio.nivel === "en-riesgo" || servicio.nivel === "sin-unidad").length,
    sinUnidad: evaluados.filter((servicio) => servicio.nivel === "sin-unidad").length,
    enCurso: evaluados.filter((servicio) => servicio.nivel === "en-curso").length,
    listos: evaluados.filter((servicio) => servicio.nivel === "listo").length,
    finalizados: evaluados.filter((servicio) => servicio.nivel === "pasado").length,
    evaluados
  };
}

/** Lo que se muestra arriba del mapa: sólo lo que pide una decisión ahora. */
export function serviciosQuePidenAtencion(resumen: ResumenDeServicios) {
  return resumen.evaluados.filter(
    (servicio) => servicio.nivel === "sin-unidad" || servicio.nivel === "en-riesgo" || servicio.nivel === "atencion"
  );
}

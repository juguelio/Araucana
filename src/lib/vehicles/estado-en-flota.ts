import { peorVencimiento, type UnidadConVencimientos } from "./compliance";

/**
 * Qué muestra cada nave en el tablero de la flota (rediseño del 20-nov): **un estado** (¿puede salir?)
 * y **una sola alerta** (lo más urgente que hay que resolver), en vez de nueve columnas.
 *
 * Todo sale de datos que ya existen —actividad, tipo, daños, papeles, butacas y servicios—, sin un
 * campo nuevo de «estado operativo» en la base. Cuando exista (ver la propuesta del taller), este
 * módulo es el lugar donde se suma.
 */

export type TonoDeNave = "ok" | "curso" | "atencion" | "grave" | "normal";

export type EstadoDeNave = {
  clave: "inactiva" | "uso-interno" | "danio-grave" | "en-reparacion" | "en-recorrido" | "en-la-calle" | "en-servicio" | "disponible";
  etiqueta: string;
  tono: TonoDeNave;
};

export type AlertaDeNave = { etiqueta: string; tono: TonoDeNave };

/** Días hasta el vencimiento a partir de los cuales el papel pasa a ser «la alerta» de la nave. */
export const DIAS_ALERTA_TABLERO = 30;

export type NaveDelTablero = UnidadConVencimientos & {
  isActive: boolean;
  kind: string;
  asientos: number;
  danios: ReadonlyArray<{ status: string; severity: string }>;
  /** Servicios de hoy (los ya hechos y los que faltan). */
  serviciosHoy: number;
  /** Tiene un servicio programado en curso ahora (salida, viaje especial o vuelo). */
  enRecorrido?: boolean;
  /** El chofer mandó señal en movimiento hace poco, desde la app del chofer. */
  enMovimiento?: boolean;
};

const abierto = (danio: { status: string }) => danio.status !== "REPARADO";

/**
 * ¿Puede salir? Lo más grave manda: inactiva, daño grave, en reparación, en recorrido (programado),
 * en la calle (hay señal del chofer en movimiento sin un servicio en curso cargado), con servicios
 * hoy, libre.
 */
export function estadoDeNave(nave: NaveDelTablero): EstadoDeNave {
  if (!nave.isActive) return { clave: "inactiva", etiqueta: "Inactiva", tono: "normal" };
  if (nave.kind === "UTILITARIO") return { clave: "uso-interno", etiqueta: "Uso interno", tono: "normal" };
  const abiertos = nave.danios.filter(abierto);
  if (abiertos.some((danio) => danio.severity === "GRAVE" && danio.status === "PENDIENTE")) {
    return { clave: "danio-grave", etiqueta: "Daño grave", tono: "grave" };
  }
  if (abiertos.some((danio) => danio.status === "EN_REPARACION")) {
    return { clave: "en-reparacion", etiqueta: "En reparación", tono: "atencion" };
  }
  if (nave.enRecorrido) return { clave: "en-recorrido", etiqueta: "En recorrido", tono: "curso" };
  if (nave.enMovimiento) return { clave: "en-la-calle", etiqueta: "En la calle", tono: "atencion" };
  if (nave.serviciosHoy > 0) {
    return { clave: "en-servicio", etiqueta: `Hoy: ${nave.serviciosHoy} ${nave.serviciosHoy === 1 ? "servicio" : "servicios"}`, tono: "ok" };
  }
  return { clave: "disponible", etiqueta: "Disponible", tono: "ok" };
}

/**
 * Lo más urgente para resolver, una sola cosa (las demás se cuentan en `otras`): un papel vencido,
 * uno que vence en 30 días, la capacidad sin cargar, un daño pendiente o los papeles sin fecha.
 * Un daño grave o en reparación no se repite acá: ya es el estado.
 */
export function alertasDeNave(nave: NaveDelTablero, hoy: Date = new Date()): { principal: AlertaDeNave | null; otras: number } {
  if (!nave.isActive) return { principal: null, otras: 0 };
  const alertas: AlertaDeNave[] = [];
  const peor = peorVencimiento(nave, hoy);
  if (peor?.dias !== null && peor?.dias !== undefined && peor.dias <= DIAS_ALERTA_TABLERO) {
    alertas.push({ etiqueta: papelEnPalabras(peor.tipo, peor.dias), tono: peor.dias < 0 ? "grave" : "atencion" });
  }
  if (nave.kind !== "UTILITARIO" && nave.asientos === 0) alertas.push({ etiqueta: "Falta cargar la capacidad", tono: "atencion" });
  const pendientes = nave.danios.filter((danio) => danio.status === "PENDIENTE" && danio.severity !== "GRAVE").length;
  if (pendientes > 0) alertas.push({ etiqueta: `${pendientes} ${pendientes === 1 ? "daño pendiente" : "daños pendientes"}`, tono: "atencion" });
  if (!peor) alertas.push({ etiqueta: "Sin fechas de papeles", tono: "normal" });
  return { principal: alertas[0] ?? null, otras: Math.max(0, alertas.length - 1) };
}

/** «Técnica vencida hace 3 días» · «Póliza vence hoy» · «RTO vence en 12 días» (los tres papeles son «la»). */
export function papelEnPalabras(tipo: string, dias: number): string {
  const n = Math.abs(dias);
  if (dias < 0) return `${tipo} vencida hace ${n} ${n === 1 ? "día" : "días"}`;
  if (dias === 0) return `${tipo} vence hoy`;
  return `${tipo} vence en ${n} ${n === 1 ? "día" : "días"}`;
}

/** Pestañas del tablero, con lo que entra en cada una. */
export const PESTANAS_DE_FLOTA = ["activas", "recorrido", "alertas", "taller", "publico", "inactivas"] as const;
export type PestanaDeFlota = (typeof PESTANAS_DE_FLOTA)[number];

export function leerPestanaDeFlota(valor: string | undefined): PestanaDeFlota {
  return (PESTANAS_DE_FLOTA as readonly string[]).includes(valor ?? "") ? (valor as PestanaDeFlota) : "activas";
}

export function entraEnPestana(
  pestana: PestanaDeFlota,
  nave: { isActive: boolean; publicTransport?: boolean | null },
  estado: EstadoDeNave,
  alerta: AlertaDeNave | null
): boolean {
  switch (pestana) {
    case "activas":
      return nave.isActive;
    case "recorrido":
      return nave.isActive && (estado.clave === "en-recorrido" || estado.clave === "en-la-calle");
    case "alertas":
      // Lo que pide hacer algo: un papel vencido o por vencer, un daño, la capacidad sin cargar.
      return nave.isActive && (estado.tono === "grave" || estado.tono === "atencion" || alerta?.tono === "grave" || alerta?.tono === "atencion");
    case "taller":
      return nave.isActive && (estado.clave === "danio-grave" || estado.clave === "en-reparacion");
    case "publico":
      return nave.isActive && Boolean(nave.publicTransport);
    case "inactivas":
      return !nave.isActive;
  }
}

/** Búsqueda por interno, patente, nombre o modelo (sin tildes ni mayúsculas). */
export function coincideBusqueda(
  nave: { internalNumber: string | null; licensePlate: string | null; name: string; brand: string; model: string },
  texto: string
): boolean {
  const limpio = (valor: string) => valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const buscado = limpio(texto);
  if (!buscado) return true;
  const campos = [nave.internalNumber ?? "", nave.licensePlate ?? "", nave.name, `${nave.brand} ${nave.model}`].map(limpio);
  // La patente se busca también sin espacios ni guiones («AB 123 CD» = «ab123cd»).
  const compacto = buscado.replace(/[\s-]/g, "");
  return campos.some((campo) => campo.includes(buscado) || campo.replace(/[\s-]/g, "").includes(compacto));
}

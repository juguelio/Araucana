/**
 * Contabilidad por secciones (26-nov). La página era una sola tira de 5.600 px: ingresos, sueldos,
 * categorías y egresos uno abajo del otro. Ahora hay un selector Resumen · Ingresos · Sueldos ·
 * Egresos (el mismo `SelectorDeVista` de los módulos) y se muestra una sección por vez.
 *
 * Los enlaces viejos siguen andando: si la URL no dice `seccion` pero trae parámetros de una tabla
 * (por ejemplo `?gasto=combustible` o `?pageSueldos=2`), se abre esa sección.
 */

export const SECCIONES = ["resumen", "ingresos", "sueldos", "egresos"] as const;
export type Seccion = (typeof SECCIONES)[number];

export const ETIQUETA_SECCION: Record<Seccion, string> = {
  resumen: "Resumen",
  ingresos: "Ingresos",
  sueldos: "Sueldos",
  egresos: "Egresos"
};

/** Los parámetros propios de cada tabla (los que agregó #461 y los de egresos de #192). */
const PARAMETROS: Record<Exclude<Seccion, "resumen">, readonly string[]> = {
  ingresos: ["vista", "semana", "dia", "desde", "hasta", "qIngresos", "driverId", "pageIngresos", "ordenIngresos", "dirIngresos", "colsIngresos"],
  sueldos: ["qSueldos", "rolSueldo", "estadoSueldo", "pageSueldos", "ordenSueldos", "dirSueldos", "colsSueldos"],
  egresos: ["gasto", "orden", "dir", "page"]
};

type Params = Record<string, string | string[] | undefined>;

export function seccionDeContabilidad(params: Params): Seccion {
  const pedida = typeof params.seccion === "string" ? params.seccion : undefined;
  if (pedida && (SECCIONES as readonly string[]).includes(pedida)) return pedida as Seccion;
  for (const seccion of ["ingresos", "sueldos", "egresos"] as const) {
    if (PARAMETROS[seccion].some((clave) => params[clave])) return seccion;
  }
  return "resumen";
}

/**
 * El código de reserva para una tabla: «ARC-2611-8765E2ECE39A6A8712F1546B8CE7FFB0» → «ARC-2611-8765E2».
 * Los códigos cortos («ARC-DEMO12») quedan iguales. El completo va en el `title` y la búsqueda lo usa
 * entero, así que se puede pegar el código largo en «Buscar».
 */
export function codigoCorto(code: string) {
  const partes = code.split("-");
  const ultima = partes.at(-1) ?? "";
  if (partes.length < 2 || ultima.length <= 8) return code;
  return [...partes.slice(0, -1), ultima.slice(0, 6)].join("-");
}

/** «San Martín de los Andes» → «San Martín», «Aeropuerto Chapelco» → «Aerop. Chapelco». */
export function lugarCorto(lugar: string) {
  return lugar.trim().replace(/\s+de\s+los\s+Andes$/i, "").replace(/^Aeropuerto\s+/i, "Aerop. ");
}

/** La ruta en un renglón: «San Martín → Villa Traful». */
export function rutaCorta(desde: string, hasta: string) {
  return `${lugarCorto(desde)} → ${lugarCorto(hasta)}`;
}

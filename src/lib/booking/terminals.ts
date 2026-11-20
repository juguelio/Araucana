import { claveDeLugar } from "./place-names";

/**
 * La terminal de cada localidad (19-nov). Los micros de las rutas salen y llegan a la **terminal**,
 * no al «centro»: el pasajero necesita saber dónde esperar y adónde baja, tanto en el voucher como
 * en la ficha pública de la ruta y en el resumen del checkout (#276).
 *
 * Lo que no es una de estas localidades se imprime tal cual (Hua Hum, Yuco, la terminal de ómnibus
 * de otra ciudad o un domicilio).
 */
const TERMINALES: Record<string, string> = {
  "san martin de los andes": "Terminal de Ómnibus de San Martín de los Andes",
  "s. m. andes": "Terminal de Ómnibus de San Martín de los Andes",
  "villa traful": "Terminal de Ómnibus de Villa Traful",
  "villa la angostura": "Terminal de Ómnibus de Villa La Angostura"
};

/** La terminal oficial de una localidad, o `null` si no es una de las que conocemos. */
export function terminalConocida(lugar: string | null | undefined): string | null {
  const nombre = (lugar ?? "").trim();
  if (!nombre) return null;
  return TERMINALES[claveDeLugar(nombre)] ?? null;
}

/**
 * El lugar que va impreso en el voucher: la terminal de la localidad, si la conocemos; si no, el
 * lugar tal cual lo cargó la ruta.
 */
export function lugarDeTerminal(lugar: string | null | undefined) {
  const nombre = (lugar ?? "").trim();
  if (!nombre) return "";
  return terminalConocida(nombre) ?? nombre;
}

/**
 * Cómo se nombra en las pantallas públicas: «la terminal de Villa Traful». Devuelve `null` cuando la
 * localidad no tiene terminal conocida, para no inventar un lugar donde la app no lo sabe.
 */
export function terminalParaElPasajero(lugar: string | null | undefined): string | null {
  const oficial = terminalConocida(lugar);
  if (!oficial) return null;
  return oficial.replace(/^Terminal de Ómnibus de /, "la terminal de ");
}

/**
 * La línea que se muestra en la ficha pública de la ruta: «Salida desde la terminal de San Martín de
 * los Andes · Llegada a la terminal de Villa Traful». `null` cuando ninguna de las dos puntas es una
 * localidad con terminal conocida (Hua Hum, el aeropuerto, un domicilio), para no escribir de más.
 */
export function textoDeTerminales(origen: string | null | undefined, destino: string | null | undefined): string | null {
  const salida = terminalParaElPasajero(origen);
  const llegada = terminalParaElPasajero(destino);
  if (!salida && !llegada) return null;
  if (salida && llegada) return `Salida desde ${salida} · Llegada a ${llegada}`;
  return salida ? `Salida desde ${salida}` : `Llegada a ${llegada}`;
}

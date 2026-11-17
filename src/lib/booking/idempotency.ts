/**
 * Idempotencia del alta de reservas (#139).
 *
 * El alta puede repetirse sin que el pasajero lo sepa: se le corta la red justo cuando el servidor
 * ya creó la reserva, aprieta dos veces, o recarga la página del paso 3. Antes, cada reintento
 * creaba **otra** reserva y ocupaba **otro** lugar en el vuelo.
 *
 * La regla: el formulario genera una clave al empezar el intento y la manda en el alta. El servidor
 * guarda la clave en la reserva; si llega otra alta con la misma clave, devuelve la reserva que ya
 * existe en vez de crear una nueva. La clave no es un secreto ni identifica al pasajero: sólo dice
 * «este es el mismo intento».
 */

/**
 * Clave nueva para un intento de alta. `crypto.randomUUID()` necesita contexto seguro (https o
 * localhost); el respaldo mantiene el mismo formato permitido por el servidor (`[A-Za-z0-9._:-]`)
 * para que el formulario no falle si la app se abre por IP en la red local.
 */
export function nuevaClaveDeIdempotencia(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Sufijo por tramo del ida y vuelta: el intento de alta es **uno** (una clave del formulario), pero
 * el viaje son dos reservas y la columna es única. Cada fila guarda la clave con su sentido.
 */
export function claveDelTramo(clave: string, direction: "ARRIVAL" | "DEPARTURE"): string {
  return `${clave}:${direction.toLowerCase()}`;
}

/**
 * El nombre del lugar donde se busca o se deja al pasajero («Hostal del Esquiador», «Cabaña Ñire»).
 *
 * El checkout guardaba el nombre **sólo** cuando el pasajero usaba el atajo de la sucursal: en toda
 * otra reserva quedaba únicamente la cadena larga del geocoder («750, Juez del Valle, Tiro Federal,
 * …, 8370, Argentina»), que es lo que el chofer termina leyendo en la orden de servicio (issue #320).
 * En producción, 4 de 183 reservas de aeropuerto tenían `pickupName`.
 *
 * Acá viven las dos reglas, puras y testeables sin navegador: qué nombre se propone a partir de la
 * sugerencia elegida y qué nombre se manda al servidor.
 */

/** Lo mínimo de una sugerencia para proponer un nombre; no depende del componente. */
export type SugerenciaConNombre = {
  label: string;
  source: string;
  precision: string;
};

const MAX_NOMBRE = 120;

/**
 * Nombre del lugar propuesto a partir del label de la sugerencia elegida, o `""` si la sugerencia
 * **no** es un lugar con nombre.
 *
 * Hay dos familias de labels y no se leen igual:
 *
 * **Ficha del catálogo de alojamientos** (`source: "municipal"`, label
 * `Hostal del Esquiador, Cnel. Rohde 975 · Centro · Hosterias`): el primer segmento es **siempre** el
 * nombre del establecimiento tal como lo registra el padrón municipal o provincial, nunca una calle.
 * Ahí no se aplican las heurísticas de dirección: 77 de las 294 fichas del catálogo tienen **una sola
 * palabra** (Turismo, Tunqueley, Paihuen, Alhué…) y otras no tienen punto verificado
 * (`precision: "none"`, el pasajero marca el pin). Descartarlas por esas dos razones dejaba sin nombre
 * justo a los alojamientos que el cliente nombra.
 *
 * **Geocoder** (`locationiq`, `photon`, `georef`, `google`): el label es una dirección o un lugar y hay
 * que distinguirlos:
 *
 * - `Hotel el Viejo Esquiador, 1242, Avenida San Martín, …` → **lugar** (el nombre va primero).
 * - `750, Juez del Valle, Tiro Federal, …` → dirección: arranca con la altura.
 * - `Coronel Rohde 975, San Martín de los Andes` → dirección: termina con la altura.
 * - `Belgrano, San Martín de los Andes` → una sola palabra es el nombre de una calle, no de un lugar.
 *
 * Y sólo se propone cuando la fuente ubicó el punto con precisión exacta: un resultado de calle o
 * interpolado es una dirección, y ponerla como «alojamiento» en la hoja del chofer es peor que
 * dejarlo vacío (ahí la hoja usa la dirección, que es el dato correcto).
 */
export function nombreDelLugarSugerido(place: SugerenciaConNombre): string {
  const primero = place.label.split(",")[0]?.trim() ?? "";
  if (!primero || primero.length > MAX_NOMBRE) return "";

  // Catálogo de alojamientos: el primer segmento ya es el nombre del establecimiento.
  if (place.source === "municipal") return primero;

  if (place.precision !== "exact") return "";
  // Arranca con la altura: «750, Juez del Valle».
  if (/^\d/.test(primero)) return "";
  // Calle y altura: «Coronel Rohde 975».
  if (/\s\d{1,5}[a-z]?$/i.test(primero)) return "";
  // Una sola palabra es el nombre de una calle, no el de un lugar.
  if (primero.split(/\s+/).length < 2) return "";

  return primero;
}

/**
 * Qué nombre se manda como `pickupName`: el de la sucursal cuando se usó ese atajo (es el lugar
 * real), y si no el que escribió o eligió el pasajero. `undefined` deja el campo vacío como hoy.
 */
export function pickupNameParaElChofer(opciones: {
  usandoSucursal: boolean;
  sucursalLabel?: string | null;
  escrito?: string | null;
}): string | undefined {
  if (opciones.usandoSucursal) {
    const sucursal = (opciones.sucursalLabel ?? "").trim();
    return sucursal ? sucursal.slice(0, MAX_NOMBRE) : undefined;
  }

  const escrito = (opciones.escrito ?? "").trim();
  return escrito ? escrito.slice(0, MAX_NOMBRE) : undefined;
}

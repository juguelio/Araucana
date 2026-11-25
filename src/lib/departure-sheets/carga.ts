/**
 * La carga de una planilla de salida desde el link público (rediseño del 25-nov). Casi siempre la
 * completa una persona del grupo que carga a todos, uno detrás del otro, así que la pantalla tiene
 * que mostrar la lista entera mientras se escribe: cuántos van, si el que estoy cargando ya está y
 * qué datos del anterior se pueden repetir.
 */

export type PasajeroDeLaLista = {
  id: string;
  position: number;
  /** «PÉREZ, Ana» (apellido, nombre). */
  nombre: string;
  firstName: string;
  lastName: string;
  /** Documento enmascarado para mostrar: «DNI ••••567». Nunca el número completo. */
  documento: string;
  nationality: string;
};

const limpio = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-zñ ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * ¿Ya hay alguien con ese apellido y nombre? Sirve para avisar mientras se escribe: el mismo
 * documento actualiza (no duplica), pero un nombre repetido con otro documento sí queda dos veces.
 */
export function mismoNombre(lista: readonly PasajeroDeLaLista[], apellido: string, nombre: string): PasajeroDeLaLista | null {
  const a = limpio(apellido);
  const n = limpio(nombre);
  if (a.length < 2 || n.length < 2) return null;
  return lista.find((pasajero) => limpio(pasajero.lastName) === a && limpio(pasajero.firstName) === n) ?? null;
}

/** «12 de 30 cargados» · «Faltan 18» · «Completa». Sin cantidad esperada, sólo cuántos van. */
export function progresoDeCarga(cargados: number, esperados: number | null | undefined) {
  const total = esperados && esperados > 0 ? esperados : null;
  const texto = total ? `${cargados} de ${total} ${total === 1 ? "cargado" : "cargados"}` : `${cargados} ${cargados === 1 ? "pasajero cargado" : "pasajeros cargados"}`;
  const faltan = total ? Math.max(0, total - cargados) : null;
  const detalle = total === null ? null : faltan === 0 ? (cargados > total ? `${cargados - total} más de los ${total} del viaje` : "Están todos") : `${faltan === 1 ? "Falta" : "Faltan"} ${faltan}`;
  return { texto, detalle, porcentaje: total ? Math.min(100, Math.round((cargados / total) * 100)) : null, completa: total !== null && cargados >= total };
}

/** Lo que suele ser igual en todo el grupo: queda puesto para el siguiente pasajero. */
export const CAMPOS_QUE_SE_REPITEN = ["documentType", "nationality", "residenceCountry"] as const;
export type CampoQueSeRepite = (typeof CAMPOS_QUE_SE_REPITEN)[number];

export function camposParaElSiguiente(form: FormData): Partial<Record<CampoQueSeRepite, string>> {
  const salida: Partial<Record<CampoQueSeRepite, string>> = {};
  for (const campo of CAMPOS_QUE_SE_REPITEN) {
    const valor = String(form.get(campo) ?? "").trim();
    if (valor) salida[campo] = valor;
  }
  return salida;
}

/** «PÉREZ, Ana» para la lista: el apellido en mayúsculas, como en la planilla que va a Migraciones. */
export function nombreParaLista(apellido: string, nombre: string) {
  const a = apellido.trim().toLocaleUpperCase("es-AR");
  const n = nombre.trim();
  return a && n ? `${a}, ${n}` : a || n;
}

/** «DNI ••••567»: el documento sin mostrarlo entero (el link lo puede ver todo el grupo). */
export function documentoEnmascarado(tipo: string, numero: string) {
  const oculto = numero.length > 3 ? `${"•".repeat(Math.min(6, numero.length - 3))}${numero.slice(-3)}` : "•••";
  return `${tipo} ${oculto}`;
}

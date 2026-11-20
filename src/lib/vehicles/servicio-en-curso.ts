import type { Recorrido } from "./ficha";

/**
 * Un servicio con el tramo en que la nave está ocupada: la salida hasta su llegada, el viaje especial
 * de punta a punta, el vuelo con la ventana del panel del aeropuerto (la recorrida antes de una
 * partida, el reparto después de un arribo). Chapelco es por día entero: no tiene ventana.
 */
export type ServicioDeNave = Recorrido & { ventana: { desde: Date; hasta: Date } | null };

/** Inicio del día de hoy en Argentina (UTC-3, sin horario de verano). */
export function inicioDeHoyArgentina(ahora: Date = new Date()) {
  const dia = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).format(ahora);
  return { dia, desde: new Date(`${dia}T00:00:00-03:00`) };
}

/**
 * Lo que la nave está haciendo ahora (el servicio cuya ventana incluye este momento), el próximo que
 * todavía no empezó, y cuántos tiene hoy (los hechos y los que faltan).
 */
export function proximoYHoy(servicios: ServicioDeNave[] | undefined, ahora: Date = new Date()) {
  const { dia } = inicioDeHoyArgentina(ahora);
  const diaDe = (recorrido: Recorrido) =>
    recorrido.soloDia ? recorrido.desde.toISOString().slice(0, 10) : inicioDeHoyArgentina(recorrido.desde).dia;
  const lista = servicios ?? [];
  const hoy = lista.filter((recorrido) => diaDe(recorrido) === dia).length;
  const enCurso = lista.find((servicio) => servicio.ventana && servicio.ventana.desde <= ahora && ahora < servicio.ventana.hasta) ?? null;
  const proximo =
    lista.find(
      (servicio) => servicio !== enCurso && (servicio.soloDia ? diaDe(servicio) >= dia : (servicio.ventana?.desde ?? servicio.desde) >= ahora)
    ) ?? null;
  return { enCurso, proximo, hoy, diaDe };
}


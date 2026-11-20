import type { Prisma } from "@prisma/client";

/**
 * Viajes especiales de varios días (reunión con Kike, 20-nov): un viaje «del 20 al 26» se carga una
 * sola vez y figura en cada uno de esos días como un bloque —la nave y los choferes no están—, en
 * vez de anotarse un renglón por día como en la planilla.
 *
 * `serviceDate` es el día en que sale y `endDate` el día en que vuelve; los dos son DATE guardados a
 * las 00:00Z. `endDate` vacío (o igual a la salida) es un viaje de un día, como todos los anteriores.
 * Todo acá es puro: sin base de datos ni reloj propio.
 */

const dayMs = 86_400_000;
/** Un viaje especial no dura más que esto; evita un «hasta» tipeado con el año equivocado. */
export const maxDiasViaje = 60;

type ConRango = { serviceDate: Date; endDate?: Date | null };

export function claveDe(fecha: Date) {
  return fecha.toISOString().slice(0, 10);
}

/** Último día del viaje: la vuelta, o el mismo día si es de un día. */
export function ultimoDia(trip: ConRango) {
  return trip.endDate && +trip.endDate > +trip.serviceDate ? trip.endDate : trip.serviceDate;
}

export function cantidadDias(trip: ConRango) {
  return Math.round((+ultimoDia(trip) - +trip.serviceDate) / dayMs) + 1;
}

export function esDeVariosDias(trip: ConRango) {
  return cantidadDias(trip) > 1;
}

/** El viaje ocupa ese día (sale, está afuera o vuelve). */
export function vigenteEn(trip: ConRango, dia: Date) {
  return +trip.serviceDate <= +dia && +dia <= +ultimoDia(trip);
}

/** «Día 2 de 5» del viaje en esa fecha; `null` si el viaje no ocupa ese día. */
export function diaDelViaje(trip: ConRango, dia: Date) {
  if (!vigenteEn(trip, dia)) return null;
  const total = cantidadDias(trip);
  const numero = Math.round((+dia - +trip.serviceDate) / dayMs) + 1;
  return { numero, total, primero: numero === 1, ultimo: numero === total };
}

/**
 * Lee «sale el» y «vuelve el» del formulario. «Vuelve el» vacío o igual a la salida es un viaje de un día
 * (`endDate: null`, como estaba todo hasta ahora).
 */
export function leerRango(desdeRaw: string, hastaRaw: string, aFecha: (raw: string) => Date | null):
  { serviceDate: Date; endDate: Date | null } | { error: string } {
  const serviceDate = aFecha(desdeRaw);
  if (!serviceDate) return { error: "Revisá el día en que sale el viaje." };
  if (!hastaRaw) return { serviceDate, endDate: null };
  const endDate = aFecha(hastaRaw);
  if (!endDate) return { error: "Revisá el día en que vuelve el viaje." };
  if (+endDate < +serviceDate) return { error: "El viaje no puede volver antes del día en que sale." };
  if (cantidadDias({ serviceDate, endDate }) > maxDiasViaje) return { error: `Un viaje especial no puede durar más de ${maxDiasViaje} días. Revisá el año de la vuelta.` };
  return { serviceDate, endDate: +endDate === +serviceDate ? null : endDate };
}

/** Viajes que ocupan ese día: salen, siguen afuera o vuelven. */
export function whereVigenteEn(dia: Date): Prisma.SpecialTripWhereInput {
  return { serviceDate: { lte: dia }, OR: [{ serviceDate: dia }, { endDate: { gte: dia } }] };
}

/** Viajes que tocan algún día de [desde, hastaExclusivo). */
export function whereSolapa(desde: Date, hastaExclusivo: Date): Prisma.SpecialTripWhereInput {
  return { serviceDate: { lt: hastaExclusivo }, OR: [{ serviceDate: { gte: desde } }, { endDate: { gte: desde } }] };
}

/** Viajes que todavía no terminaron: salen hoy o después, o están afuera. */
export function whereNoTerminado(hoy: Date): Prisma.SpecialTripWhereInput {
  return { OR: [{ serviceDate: { gte: hoy } }, { endDate: { gte: hoy } }] };
}

const formatoCorto = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const formatoSinMes = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric" });
const formatoLargo = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const limpiar = (texto: string) => texto.replace(",", "").replace(".", "");

/** «vie 20 → lun 23 nov», «lun 30 nov → mié 2 dic» (con el año si no es el de hoy). Un día: «vie 20 nov». */
export function etiquetaRango(trip: ConRango, hoy: Date) {
  const hasta = ultimoDia(trip);
  const anio = (fecha: Date) => fecha.getUTCFullYear() === hoy.getUTCFullYear() ? "" : ` ${fecha.getUTCFullYear()}`;
  if (+hasta === +trip.serviceDate) return limpiar(formatoCorto.format(trip.serviceDate)) + anio(trip.serviceDate);
  const mismoMes = trip.serviceDate.getUTCMonth() === hasta.getUTCMonth() && trip.serviceDate.getUTCFullYear() === hasta.getUTCFullYear();
  const desde = mismoMes ? limpiar(formatoSinMes.format(trip.serviceDate)) : limpiar(formatoCorto.format(trip.serviceDate)) + anio(trip.serviceDate);
  return `${desde} → ${limpiar(formatoCorto.format(hasta))}${anio(hasta)}`;
}

/** «Del viernes 20 de noviembre al lunes 23 de noviembre» para la ficha; un día, sólo la fecha. */
export function etiquetaRangoLarga(trip: ConRango) {
  const hasta = ultimoDia(trip);
  if (+hasta === +trip.serviceDate) return formatoLargo.format(trip.serviceDate);
  return `Del ${formatoLargo.format(trip.serviceDate)} al ${formatoLargo.format(hasta)}`;
}

/** Cómo está el viaje en ese día, en pocas palabras: «Sale hoy», «En viaje · día 3 de 5», «Vuelve hoy». */
export function estadoDelDia(trip: ConRango, dia: Date) {
  const d = diaDelViaje(trip, dia);
  if (!d || d.total === 1) return null;
  if (d.primero) return `Sale · día 1 de ${d.total}`;
  if (d.ultimo) return `Vuelve · día ${d.numero} de ${d.total}`;
  return `En viaje · día ${d.numero} de ${d.total}`;
}

/**
 * Ocupación de nave que se propone al asignar: el bloque entero del viaje, del día de salida a las 08:00
 * al día de la vuelta a las 20:00 (hora argentina, formato de `datetime-local`).
 */
export function ocupacionDelViaje(desdeClave: string, hastaClave: string) {
  const ok = (clave: string) => /^\d{4}-\d{2}-\d{2}$/.test(clave);
  if (!ok(desdeClave)) return { start: "", end: "" };
  const hasta = ok(hastaClave) && hastaClave >= desdeClave ? hastaClave : desdeClave;
  return { start: `${desdeClave}T08:00`, end: `${hasta}T20:00` };
}

/**
 * Naves que no cubren todos los días del viaje (empiezan después del día de salida o terminan antes del de
 * la vuelta). Fechas en hora argentina tal como las muestra el formulario («2026-11-20T08:00»).
 */
export function navesQueNoCubren(assignments: { vehicleId: string; start: string; end: string }[], desdeClave: string, hastaClave: string) {
  const hasta = hastaClave && hastaClave >= desdeClave ? hastaClave : desdeClave;
  return assignments.filter((a) => a.vehicleId && a.start && a.end && (a.start.slice(0, 10) > desdeClave || a.end.slice(0, 10) < hasta));
}

/**
 * Viajes del mismo cliente y el mismo servicio en días seguidos, como se cargaban en la planilla (un renglón
 * por día). Devuelve la cadena completa que contiene al viaje, en orden, o `[]` si no hay ninguna.
 */
export function cadenaDeDias<T extends { id: string; client: string; destinationSearch: string; serviceDate: Date; endDate?: Date | null; status: string }>(viaje: T, candidatos: T[]) {
  const clave = (t: T) => `${t.client.trim().toLowerCase()}\u001f${t.destinationSearch.trim().toLowerCase()}`;
  const mismos = [viaje, ...candidatos.filter((t) => t.id !== viaje.id && t.status !== "CANCELLED" && clave(t) === clave(viaje))]
    .sort((a, b) => +a.serviceDate - +b.serviceDate);
  const indice = mismos.findIndex((t) => t.id === viaje.id);
  let inicio = indice;
  let fin = indice;
  while (inicio > 0 && +mismos[inicio - 1].serviceDate !== +mismos[inicio].serviceDate && +mismos[inicio].serviceDate - +ultimoDia(mismos[inicio - 1]) <= dayMs) inicio--;
  while (fin < mismos.length - 1 && +mismos[fin + 1].serviceDate !== +mismos[fin].serviceDate && +mismos[fin + 1].serviceDate - +ultimoDia(mismos[fin]) <= dayMs) fin++;
  return fin > inicio ? mismos.slice(inicio, fin + 1) : [];
}

/**
 * Si los días 2..n de una cadena se pueden unir al primero sin perder nada: sin importe, sin cobros, sin naves
 * y sin planillas propias. Si alguno tiene, es un servicio que se cobra por día (como un plan de ski) y no se une.
 */
export function motivoParaNoUnir(siguientes: { totalCents: number | null; payments: unknown; assignments: number; planillas: number; client: string }[]) {
  for (const t of siguientes) {
    if (t.totalCents !== null && t.totalCents > 0) return "Algún día tiene su propio importe: parece un servicio que se cobra por día, no un solo viaje.";
    if (Array.isArray(t.payments) && t.payments.length > 0) return "Algún día tiene cobros cargados.";
    if (t.assignments > 0) return "Algún día tiene naves asignadas por separado.";
    if (t.planillas > 0) return "Algún día tiene planillas propias.";
  }
  return null;
}

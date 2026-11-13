/**
 * Restitución de una reserva cancelada (#117).
 *
 * Cancelar es de una sola dirección: libera el asiento y deja la reserva bloqueada, y hasta ahora la
 * única salida era borrarla y cargarla de nuevo con otro código — perdiendo el historial. El cliente
 * pidió poder volver atrás.
 *
 * Las decisiones —a qué estado vuelve, si queda lugar, si el servicio ya pasó— son funciones puras,
 * así se prueban sin base; la transacción de `manageReservation` trae los datos y aplica la decisión.
 * Las mismas condiciones que acepta un alta se repiten acá para no dejar una reserva imposible.
 */
import { blockingReservedPeopleForSlot } from "@/lib/chapelco/availability";
import { chapelcoAscentSlots, type ChapelcoAscentSlot } from "@/lib/chapelco/constants";

/**
 * Estado al volver: el que tenía antes de cancelarse, deducido del pago. No se inventa un estado
 * nuevo; una reserva con documentación por revisar vuelve a ese estado y no a «confirmada».
 */
export function restoredStatus(input: {
  payment: { status: string; provider: string } | null | undefined;
  disabilityProvider: string;
}): "CONFIRMED" | "PENDING_PAYMENT" | "DOCUMENTATION_PENDING" {
  const { payment, disabilityProvider } = input;
  if (payment?.provider === disabilityProvider) return "DOCUMENTATION_PENDING";
  return payment?.status === "APPROVED" ? "CONFIRMED" : "PENDING_PAYMENT";
}

/** ¿Queda lugar? Se cuentan pasajeros, no filas: una reserva puede ocupar varios asientos. */
export function hayLugar(capacidad: number, ocupados: number, pedidos: number) {
  return pedidos > 0 && ocupados + pedidos <= capacidad;
}

/** Lugares libres que se le pueden ofrecer al operador cuando no hay cupo. */
export function lugaresLibres(capacidad: number, ocupados: number) {
  return Math.max(capacidad - ocupados, 0);
}

/** Clave `AAAA-MM-DD` del día argentino (UTC−3) de un instante. */
export function diaArgentino(now: Date) {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Un `serviceDate` se guarda como DATE a las 00:00Z, así que se compara por clave de día y no por
 * instante: restituir un servicio de hoy sigue teniendo sentido operativo, el de ayer no.
 */
export function servicioYaPaso(serviceDate: Date, now: Date = new Date()) {
  return serviceDate.toISOString().slice(0, 10) < diaArgentino(now);
}

/** El vuelo ya despegó (o ya aterrizó): con demora manda el horario estimado, igual que al reservar. */
export function vueloYaPaso(vuelo: { scheduledAt: Date; estimatedAt?: Date | null }, now: Date = new Date()) {
  const referencia = vuelo.estimatedAt && vuelo.estimatedAt > vuelo.scheduledAt ? vuelo.estimatedAt : vuelo.scheduledAt;
  return referencia <= now;
}

/**
 * Personas que ya ocupan la franja de subida de Chapelco, contando las franjas que se pisan con ella
 * (la combi no puede estar en dos horarios consecutivos). Misma regla que el alta.
 */
export function personasQueBloqueanLaFranja(
  reservas: Array<{ passengerCount: number; ascentSlot: string | null }>,
  franja: ChapelcoAscentSlot
) {
  const validas = reservas
    .map((reserva) =>
      chapelcoAscentSlots.includes(reserva.ascentSlot as ChapelcoAscentSlot)
        ? { ascentSlot: reserva.ascentSlot as ChapelcoAscentSlot, passengerCount: reserva.passengerCount }
        : null
    )
    .filter((reserva): reserva is { ascentSlot: ChapelcoAscentSlot; passengerCount: number } => reserva !== null);

  return blockingReservedPeopleForSlot(validas, franja);
}

/** ¿La franja guardada de la reserva es una de las conocidas? El panel no ofrece otra cosa. */
export function esFranjaDeChapelco(valor: string | null): valor is ChapelcoAscentSlot {
  return chapelcoAscentSlots.includes(valor as ChapelcoAscentSlot);
}

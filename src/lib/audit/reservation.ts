import { diffRecords } from "./diff";
import { guestActor, recordAudit, type AuditActor, type AuditClient } from "./record";

/**
 * Foto de una reserva para la auditoría: los datos que alguien puede cambiar desde el panel, ya
 * aplanados. Se toma antes y después de cada operación y `diffRecords` se queda con lo que cambió.
 * No entran ni el comprobante (archivo) ni fechas técnicas: no son decisiones de una persona.
 */

type Loose = Record<string, unknown> | null | undefined;

export const reservationAuditInclude = { payment: true, passenger: true, airportDetails: true, chapelcoDetails: true } as const;

function pick(source: Loose, fields: readonly string[], prefix: string) {
  const picked: Record<string, unknown> = {};
  if (!source) return picked;
  for (const field of fields) {
    if (field in source) picked[prefix ? `${prefix}.${field}` : field] = source[field];
  }
  return picked;
}

const RESERVATION_FIELDS = [
  "status", "totalCents", "currency", "passengerCount", "seatNumber", "boardingStop", "dropoffStop", "referredBy",
  "cancellationReason", "cancelledByName", "restoredByName"
] as const;
const PAYMENT_FIELDS = ["provider", "status", "amountCents", "method", "externalRef"] as const;
const PASSENGER_FIELDS = ["firstName", "lastName", "email", "phone", "documentType", "documentId", "nationality"] as const;
const PICKUP_FIELDS = ["pickupName", "pickupAddress", "pickupLatitude", "pickupLongitude", "pickupNotes"] as const;
/** Adicionales editables del aeropuerto (#267): sin esto, un cambio de equipaje no dejaba fila. */
const AIRPORT_FIELDS = ["sportsLuggageCount"] as const;

export function reservationAuditSnapshot(reservation: Loose): Record<string, unknown> | null {
  if (!reservation) return null;
  return {
    ...pick(reservation, RESERVATION_FIELDS, ""),
    ...pick(reservation.payment as Loose, PAYMENT_FIELDS, "payment"),
    ...pick(reservation.passenger as Loose, PASSENGER_FIELDS, "passenger"),
    ...pick((reservation.airportDetails ?? reservation.chapelcoDetails) as Loose, PICKUP_FIELDS, "pickup"),
    ...pick(reservation.airportDetails as Loose, AIRPORT_FIELDS, "airport")
  };
}

/** Nombre del pasajero para el resumen de una reserva borrada (la fila ya no va a existir). */
export function reservationPassengerName(reservation: Loose) {
  const passenger = reservation?.passenger as Loose;
  return [passenger?.firstName, passenger?.lastName].filter((part) => typeof part === "string" && part.trim()).join(" ") || null;
}

/**
 * El equipo dicta y busca las reservas por el código corto; el largo es el enlace privado. El
 * resumen lleva el corto para que la auditoría se pueda buscar con el código que usa la gente.
 */
export function withShortCode(summary: string, shortCode: unknown) {
  return typeof shortCode === "string" && shortCode ? `${summary} Código corto ${shortCode}.` : summary;
}

type CreatedReservation = { id: string; code: string; shortCode?: string | null; status: string; totalCents: number; currency: string; passengerCount: number };

/**
 * Alta de una reserva. Va en la misma transacción que la crea. `creator` es la sesión de quien la
 * cargó; sin sesión es el pasajero reservando desde la web y queda como invitado.
 */
export async function recordReservationCreated(
  client: AuditClient,
  reservation: CreatedReservation,
  creator: AuditActor | null | undefined,
  service: string
) {
  await recordAudit(client, {
    actor: creator ?? guestActor,
    action: "CREATE",
    entity: "RESERVATION",
    entityId: reservation.id,
    entityLabel: reservation.code,
    summary: withShortCode(`Reserva creada (${service}).`, reservation.shortCode),
    changes: diffRecords(null, {
      status: reservation.status,
      totalCents: reservation.totalCents,
      currency: reservation.currency,
      passengerCount: reservation.passengerCount
    })
  });
}

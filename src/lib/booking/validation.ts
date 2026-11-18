import { reservationPriceCents } from "./admin-price";
import { z } from "zod";
import { fareCounts, hasFullFare, sinAdultoMensaje } from "./passenger-fares";
import { normalizePassengerDocument, normalizePassengerPhone, passengerDocumentError, phoneFormatError } from "./passenger-contact";

const passengerFieldsSchema = z.object({
  firstName: z.string().min(2, "Ingresa el nombre del pasajero."),
  lastName: z.string().min(2, "Ingresa el apellido del pasajero."),
  email: z.string().email("Ingresa un email valido."),
  phone: z.string().transform((value, ctx) => {
    const phone = normalizePassengerPhone(value);
    if (phone) return phone;
    ctx.addIssue({ code: "custom", message: phoneFormatError });
    return z.NEVER;
  }),
  documentType: z.string().min(1, "Selecciona el tipo de documento."),
  documentId: z.string(),
  nationality: z.string().nullable().optional()
});

function validatePassengerDocument<T extends { documentType: string; documentId: string }>(passenger: T, ctx: z.RefinementCtx, optional = false) {
  const message = passengerDocumentError(passenger.documentType, passenger.documentId, optional);
  if (message) {
    ctx.addIssue({ code: "custom", path: ["documentId"], message });
    return z.NEVER;
  }
  return { ...passenger, documentId: normalizePassengerDocument(passenger.documentType, passenger.documentId) };
}

export const passengerSchema = passengerFieldsSchema.transform((passenger, ctx) => validatePassengerDocument(passenger, ctx));

/**
 * El traslado al aeropuerto se reserva sin documento (#206, #208) y, desde el 18-nov, sin email
 * (#239): el pasajero se toma por teléfono o en el mostrador y el correo no siempre lo tienen a
 * mano. El checkout muestra los dos campos como «(opcional)». Si vienen cargados se validan igual
 * que siempre; vacíos pasan, y el email queda `""` como ya lo guarda el alta del panel.
 * Chapelco y las rutas los siguen exigiendo con `passengerSchema`.
 */
export const optionalContactPassengerSchema = passengerFieldsSchema
  .extend({
    email: passengerFieldsSchema.shape.email.or(z.literal("")).default(""),
    documentId: passengerFieldsSchema.shape.documentId.default("")
  })
  .transform((passenger, ctx) => validatePassengerDocument(passenger, ctx, true));

/**
 * El panel carga reservas de pasajeros que se toman por teléfono o en el mostrador, y muchas veces
 * no hay email ni teléfono a mano: inventarlos es peor que dejarlos vacíos (#241). Hasta que no
 * existan los avisos automáticos al pasajero, los dos son opcionales desde el panel y se guardan
 * como `""`.
 *
 * Cuando empiecen los emails automáticos de reserva, esto pasa a `true` y los dos campos vuelven a
 * ser obligatorios en el alta y en la edición, **en un solo lugar**: ningún formulario repite la
 * condición. Los checkouts públicos no dependen de esta constante.
 */
export const PANEL_EXIGE_CONTACTO = false;

/** Email del panel: válido si viene, vacío si no hay dato (#241). */
const adminEmailField = passengerFieldsSchema.shape.email.or(z.literal(""));

/** Teléfono del panel: mismo formato que siempre cuando viene, vacío cuando no hay dato (#241). */
const adminPhoneField = z.string().transform((value, ctx) => {
  if (!value.trim() && !PANEL_EXIGE_CONTACTO) return "";
  const phone = normalizePassengerPhone(value);
  if (phone) return phone;
  ctx.addIssue({ code: "custom", message: phoneFormatError });
  return z.NEVER;
});

const adminPassengerFields = passengerFieldsSchema.extend({
  email: adminEmailField,
  phone: adminPhoneField
});

export const adminPassengerPatchSchema = adminPassengerFields.partial();

export const adminPassengerSchema = adminPassengerFields.extend({
  email: adminPassengerFields.shape.email.default(""),
  documentId: adminPassengerFields.shape.documentId.default("")
  // El documento es obligatorio también desde el panel (#122): la orden de servicio del chofer
  // imprimía «—» en la mayoría de las reservas cargadas a mano. Antes acá iba `optional = true`.
}).transform((passenger, ctx) => validatePassengerDocument(passenger, ctx));

/** Lo mismo desde el panel: el aeropuerto no exige documento, ni al pasajero ni al operador. */
export const adminOptionalDocumentPassengerSchema = adminPassengerFields.extend({
  email: adminPassengerFields.shape.email.default(""),
  documentId: adminPassengerFields.shape.documentId.default("")
}).transform((passenger, ctx) => validatePassengerDocument(passenger, ctx, true));

const fareCounter = z.coerce.number().int().min(0, "La cantidad no puede ser negativa.").max(24).default(0);

/**
 * Quién derivó la venta (una agencia, un voucher): texto libre y opcional (#109). Va **sólo** en
 * los contratos del panel — las agencias no tienen usuario en la app y el formulario público no
 * tiene por qué declarar quién vendió.
 */
export const referredBySchema = z
  .string()
  .trim()
  .max(120, "El origen de la venta puede tener hasta 120 caracteres.")
  .optional();

const reservationFields = z.object({
    scheduleId: z.string().min(1, "Selecciona una salida."),
    seatNumber: z.string().optional(),
    requestDisabilityFare: z.boolean().optional(),
    dropoffStop: z.string().trim().min(1).max(160).optional(),
    passengerCount: z.coerce.number().int().min(1, "Selecciona al menos un asiento.").max(24, "La cantidad de asientos no es valida.").default(1),
    // Tarifas por edad: ambos contadores van incluidos dentro de passengerCount.
    halfFareCount: fareCounter,
    freeFareCount: fareCounter,
  passenger: passengerSchema
});

// Media tarifa y sin cargo van dentro del total de pasajeros, nunca por encima.
const faresFitPassengers = ({ halfFareCount = 0, freeFareCount = 0, passengerCount }: { halfFareCount?: number; freeFareCount?: number; passengerCount: number }) =>
  halfFareCount + freeFareCount <= passengerCount;
const faresNotFitError = {
  path: ["halfFareCount"],
  message: "La cantidad de menores no puede superar la de pasajeros."
};

// Alguien paga tarifa entera: sin esto, 6 pasajeros «menores de 4» creaban una reserva de $0.
const faresHaveFull = ({ halfFareCount = 0, freeFareCount = 0, passengerCount }: { halfFareCount?: number; freeFareCount?: number; passengerCount: number }) =>
  hasFullFare(fareCounts(passengerCount, halfFareCount, freeFareCount));
const noFullFareError = { path: ["freeFareCount"], message: sinAdultoMensaje };

export const createReservationSchema = reservationFields
  .refine(faresFitPassengers, faresNotFitError)
  .refine(faresHaveFull, noFullFareError);

export const adminReservationSchema = reservationFields
  .extend({
    passenger: adminPassengerSchema,
    overrideTotalCents: reservationPriceCents.optional(),
    referredBy: referredBySchema
  })
  .refine(faresFitPassengers, faresNotFitError)
  .refine(faresHaveFull, noFullFareError);

export type CreateReservationInput = z.infer<typeof createReservationSchema>;
export type AdminReservationInput = z.infer<typeof adminReservationSchema>;
export type PassengerInput = z.infer<typeof passengerSchema>;

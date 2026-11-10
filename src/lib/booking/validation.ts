import { z } from "zod";
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

export const adminPassengerSchema = passengerFieldsSchema.extend({
  email: passengerFieldsSchema.shape.email.or(z.literal("")).default(""),
  documentId: z.string().default("")
}).transform((passenger, ctx) => validatePassengerDocument(passenger, ctx, true));

export const createReservationSchema = z.object({
  scheduleId: z.string().min(1, "Selecciona una salida."),
  seatNumber: z.string().optional(),
  requestDisabilityFare: z.boolean().optional(),
  dropoffStop: z.string().trim().min(1).max(160).optional(),
  passengerCount: z.coerce.number().int().min(1, "Selecciona al menos un asiento.").max(24, "La cantidad de asientos no es valida.").default(1),
  passenger: passengerSchema
});

export const adminReservationSchema = createReservationSchema.extend({ passenger: adminPassengerSchema });

export type CreateReservationInput = z.infer<typeof createReservationSchema>;
export type PassengerInput = z.infer<typeof passengerSchema>;

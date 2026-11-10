import { z } from "zod";

export const passengerSchema = z.object({
  firstName: z.string().min(2, "Ingresa el nombre del pasajero."),
  lastName: z.string().min(2, "Ingresa el apellido del pasajero."),
  email: z.string().email("Ingresa un email valido."),
  phone: z.string().min(6, "Ingresa un telefono valido con codigo de pais."),
  documentType: z.string().min(1, "Selecciona el tipo de documento."),
  documentId: z.string().min(4, "Ingresa un documento valido."),
  nationality: z.string().nullable().optional()
});

export const adminPassengerSchema = passengerSchema.extend({
  email: passengerSchema.shape.email.or(z.literal("")).default(""),
  documentId: passengerSchema.shape.documentId.or(z.literal("")).default("")
});

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

import { z } from "zod";
import { passengerSchema } from "@/lib/booking/validation";

/** Contrato del flujo público del aeropuerto: la reserva va atada a un vuelo, no a una salida fija. */
export const airportReservationSchema = z.object({
  routeSlug: z.string().min(1),
  flightNumber: z.string().min(3, "Ingresá el número de vuelo."),
  direction: z.enum(["ARRIVAL", "DEPARTURE"]),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  passengerCount: z.coerce.number().int().min(1, "Al menos un pasajero.").max(24, "Máximo 24 por reserva.").default(1),
  passenger: passengerSchema,
  pickupName: z.string().max(120).optional(),
  pickupAddress: z.string().max(160).optional(),
  pickupNotes: z.string().max(300).optional()
});

export type AirportReservationInput = z.infer<typeof airportReservationSchema>;

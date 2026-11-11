import { reservationPriceCents } from "@/lib/booking/admin-price";
import { z } from "zod";
import { adminPassengerSchema, passengerSchema } from "@/lib/booking/validation";

/**
 * Vuelo privado: el pasajero lo carga porque no figura en la lista del día (charter, avión
 * particular, taxi aéreo). No lo publica ninguna aerolínea, así que lo valida el servidor y queda
 * marcado con `source: "PASAJERO"` para que la operación lo revise.
 */
export const privateFlightSchema = z.object({
  number: z
    .string()
    .trim()
    .min(2, "Ingresá el número de vuelo o la matrícula (ej. LV-BET).")
    .max(24, "El número de vuelo es demasiado largo."),
  airline: z.string().trim().max(60).optional(),
  origin: z.string().trim().max(80).optional(),
  /** Fecha y hora local argentina en ISO con offset: `2026-11-05T14:30:00-03:00`. */
  scheduledAt: z
    .string()
    .min(10, "Ingresá la fecha y hora del vuelo.")
    .refine((valor) => !Number.isNaN(Date.parse(valor)), "La fecha y hora del vuelo no son válidas.")
});

/** Contrato del flujo público del aeropuerto: la reserva va atada a un vuelo, no a una salida fija. */
const airportReservationFields = z.object({
  routeSlug: z.string().min(1),
  flightNumber: z.string().min(3, "Ingresá el número de vuelo."),
  direction: z.enum(["ARRIVAL", "DEPARTURE"]),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  passengerCount: z.coerce.number().int().min(1, "Al menos un pasajero.").max(24, "Máximo 24 por reserva.").default(1),
  halfFareCount: z.number().int().min(0).max(24).optional(),
  /** Menores de 4 años: no pagan, pero ocupan un lugar. */
  freeFareCount: z.number().int().min(0).max(24).optional(),
  passenger: passengerSchema,
  pickupName: z.string().max(120).optional(),
  pickupAddress: z.string().max(160).optional(),
  pickupPoint: z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]).optional(),
  pickupNotes: z.string().max(300).optional(),
  /** Cuando viene, el vuelo no se busca: se reutiliza el del mismo número o se crea. */
  privateFlight: privateFlightSchema.optional()
});

const halfFareFitsSeats = ({ halfFareCount = 0, freeFareCount = 0, passengerCount }: { halfFareCount?: number; freeFareCount?: number; passengerCount: number }) =>
  halfFareCount + freeFareCount <= passengerCount;
const halfFareCountError = {
  path: ["halfFareCount"],
  message: "La cantidad de menores no puede superar los lugares reservados."
};

export const airportReservationSchema = airportReservationFields.refine(halfFareFitsSeats, halfFareCountError);
export const adminAirportReservationSchema = airportReservationFields.extend({ passenger: adminPassengerSchema, overrideTotalCents: reservationPriceCents.optional() })
  .refine(halfFareFitsSeats, halfFareCountError);

export type AirportReservationInput = z.infer<typeof airportReservationSchema>;
export type AdminAirportReservationInput = z.infer<typeof adminAirportReservationSchema>;
export type PrivateFlightInput = z.infer<typeof privateFlightSchema>;


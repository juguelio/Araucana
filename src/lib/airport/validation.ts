import { reservationPriceCents } from "@/lib/booking/admin-price";
import { z } from "zod";
import { fareCounts, hasFullFare, sinAdultoMensaje } from "@/lib/booking/passenger-fares";
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

export const airportPickupPointSchema = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

/** Dónde se busca o se deja al pasajero. Compartido por el tramo único y por cada tramo del ida y vuelta. */
const airportPickupFields = {
  pickupName: z.string().max(120).optional(),
  pickupAddress: z.string().max(160).optional(),
  pickupPoint: airportPickupPointSchema.optional(),
  pickupNotes: z.string().max(300).optional()
};

/** Un tramo suelto del ida y vuelta: el vuelo de ese sentido y su pickup. */
const airportLegFields = z.object({
  flightNumber: z.string().min(3, "Ingresá el número de vuelo."),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  ...airportPickupFields,
  /** Cuando viene, el vuelo no se busca: se reutiliza el del mismo número o se crea. */
  privateFlight: privateFlightSchema.optional()
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
  ...airportPickupFields,
  /** Cuando viene, el vuelo no se busca: se reutiliza el del mismo número o se crea. */
  privateFlight: privateFlightSchema.optional()
});

const halfFareFitsSeats = ({ halfFareCount = 0, freeFareCount = 0, passengerCount }: { halfFareCount?: number; freeFareCount?: number; passengerCount: number }) =>
  halfFareCount + freeFareCount <= passengerCount;
const halfFareCountError = {
  path: ["halfFareCount"],
  message: "La cantidad de menores no puede superar los lugares reservados."
};

const faresHaveFull = ({ halfFareCount = 0, freeFareCount = 0, passengerCount }: { halfFareCount?: number; freeFareCount?: number; passengerCount: number }) =>
  hasFullFare(fareCounts(passengerCount, halfFareCount, freeFareCount));
const noFullFareError = { path: ["freeFareCount"], message: sinAdultoMensaje };

export const airportReservationSchema = airportReservationFields
  .refine(halfFareFitsSeats, halfFareCountError)
  .refine(faresHaveFull, noFullFareError);
export const adminAirportReservationSchema = airportReservationFields.extend({ passenger: adminPassengerSchema, overrideTotalCents: reservationPriceCents.optional() })
  .refine(halfFareFitsSeats, halfFareCountError)
  .refine(faresHaveFull, noFullFareError);

export type AirportReservationInput = z.infer<typeof airportReservationSchema>;
export type AdminAirportReservationInput = z.infer<typeof adminAirportReservationSchema>;
export type PrivateFlightInput = z.infer<typeof privateFlightSchema>;

/**
 * Ida y vuelta (#36): dos tramos y los datos del pasajero **una sola vez**. Cada tramo lleva su
 * propio vuelo, su fecha y su pickup (el de la llegada es el destino; el de la salida, el origen).
 */
export const airportRoundTripSchema = z
  .object({
    routeSlug: z.string().min(1),
    passengerCount: z.coerce.number().int().min(1, "Al menos un pasajero.").max(24, "Máximo 24 por reserva.").default(1),
    halfFareCount: z.number().int().min(0).max(24).optional(),
    freeFareCount: z.number().int().min(0).max(24).optional(),
    passenger: passengerSchema,
    arrival: airportLegFields,
    departure: airportLegFields
  })
  .refine(halfFareFitsSeats, halfFareCountError)
  .refine(faresHaveFull, noFullFareError)
  .refine(({ arrival, departure }) => departure.serviceDate >= arrival.serviceDate, {
    path: ["departure", "serviceDate"],
    message: "La vuelta no puede ser antes de la llegada."
  });

export type AirportRoundTripInput = z.infer<typeof airportRoundTripSchema>;


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
  /** Bultos de equipaje deportivo (esquí, snowboard, bici): se cobran por bulto. */
  sportsLuggageCount: z.number().int().min(0, "Cantidad inválida.").max(24, "Máximo 24 bultos por reserva.").optional(),
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
 *
 * `firstLeg` dice **cuál de los dos va primero en el calendario**, porque el ida y vuelta se arma
 * en los dos sentidos: el pasajero puede llegar a San Martín y volver (`ARRIVAL`), o salir de San
 * Martín y regresar después (`DEPARTURE`). Los sentidos de cada tramo no cambian —la llegada
 * siempre es CPC → SMA—, lo que cambia es el orden: con `DEPARTURE` primero, la salida es la ida y
 * la llegada es la vuelta.
 */
const airportRoundTripFields = z.object({
  routeSlug: z.string().min(1),
  firstLeg: z.enum(["ARRIVAL", "DEPARTURE"]).default("ARRIVAL"),
  passengerCount: z.coerce.number().int().min(1, "Al menos un pasajero.").max(24, "Máximo 24 por reserva.").default(1),
  halfFareCount: z.number().int().min(0).max(24).optional(),
  freeFareCount: z.number().int().min(0).max(24).optional(),
  sportsLuggageCount: z.number().int().min(0, "Cantidad inválida.").max(24, "Máximo 24 bultos por reserva.").optional(),
  passenger: passengerSchema,
  arrival: airportLegFields,
  departure: airportLegFields
});

/**
 * El segundo tramo no puede ser antes del primero, en cualquiera de los dos órdenes. Va por
 * `superRefine` —y no por `.refine(fn, errorFn)`— porque el error depende del orden: zod ignora
 * una función como mapa de error y publica `Invalid input` sin path.
 */
const roundTripChronology = (
  { arrival, departure, firstLeg }: { arrival: { serviceDate: string }; departure: { serviceDate: string }; firstLeg: "ARRIVAL" | "DEPARTURE" },
  context: z.RefinementCtx
) => {
  const vuelta = firstLeg === "ARRIVAL" ? "departure" : "arrival";
  const [primero, segundo] = firstLeg === "ARRIVAL" ? [arrival, departure] : [departure, arrival];
  if (segundo.serviceDate < primero.serviceDate) {
    context.addIssue({
      code: "custom",
      path: [vuelta, "serviceDate"],
      message: firstLeg === "ARRIVAL" ? "La vuelta no puede ser antes de la llegada." : "La vuelta no puede ser antes de la salida."
    });
  }
};

export const airportRoundTripSchema = airportRoundTripFields
  .refine(halfFareFitsSeats, halfFareCountError)
  .refine(faresHaveFull, noFullFareError)
  .superRefine(roundTripChronology);

/** Alta desde el panel: los datos de identidad del pasajero son opcionales. */
export const adminAirportRoundTripSchema = airportRoundTripFields
  .extend({ passenger: adminPassengerSchema })
  .refine(halfFareFitsSeats, halfFareCountError)
  .refine(faresHaveFull, noFullFareError)
  .superRefine(roundTripChronology);

/** Lo que manda el cliente: `firstLeg` es opcional (por defecto el viaje arranca con la llegada). */
export type AirportRoundTripInput = z.input<typeof airportRoundTripSchema>;
export type AdminAirportRoundTripInput = z.input<typeof adminAirportRoundTripSchema>;


import { z } from "zod";
import { reservationPriceCents } from "@/lib/booking/admin-price";

export const privateStopsSchema = z.array(z.object({
  destination: z.string().trim().min(1, "Ingresá el alojamiento o la dirección de cada parada.").max(200),
  passengers: z.number().int().min(1).max(24)
})).min(1, "Agregá al menos una parada.").max(24);

export type PrivateStop = z.infer<typeof privateStopsSchema>[number];

export const privateTransferSchema = z.object({
  stops: privateStopsSchema,
  flightId: z.string().min(1).optional(),
  totalCents: reservationPriceCents,
  vehicleId: z.string().min(1).optional()
});

export type PrivateTransfer = z.infer<typeof privateTransferSchema>;

export function privatePassengerCount(stops: PrivateStop[]) {
  return stops.reduce((total, stop) => total + stop.passengers, 0);
}

export function privateDestination(stops: PrivateStop[]) {
  return stops.map(stop => `${stop.destination} (${stop.passengers} pax)`).join(" · ");
}

import { prisma } from "@/lib/db/prisma";
import type { FlightDirection } from "./provider";

/**
 * Tarifa vigente de cada sentido del traslado al aeropuerto.
 *
 * El checkout tiene que mostrar la misma tarifa que después graba la reserva. Como la reserva toma
 * la ruta canónica del sentido del vuelo (`createAirportReservation`), acá se resuelve igual: misma
 * consulta y mismo orden, para que no haya dos precios posibles para el mismo viaje.
 */
export type AirportFare = {
  slug: string;
  from: string;
  to: string;
  priceCents: number;
  currency: string;
};

export type AirportFares = Record<FlightDirection, AirportFare | null>;

export async function getAirportFares(): Promise<AirportFares> {
  const rutas = await prisma.travelRoute.findMany({
    where: { bookingMode: "AIRPORT", isActive: true },
    // La ruta cargada primero es la canónica de ese sentido (mismo criterio que la reserva).
    orderBy: { createdAt: "asc" }
  });

  const delSentido = (direction: FlightDirection): AirportFare | null => {
    const ruta = rutas.find((item) => item.specialType === direction);
    if (!ruta) return null;
    return { slug: ruta.slug, from: ruta.from, to: ruta.to, priceCents: ruta.priceCents, currency: ruta.currency };
  };

  return { ARRIVAL: delSentido("ARRIVAL"), DEPARTURE: delSentido("DEPARTURE") };
}

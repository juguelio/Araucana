import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { listAirportFlights } from "@/lib/airport/booking";
import { prisma } from "@/lib/db/prisma";

/** Vuelos del día para el flujo público del aeropuerto (sólo lectura, datos cacheados de AirLabs). */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get("slug");
    const date = url.searchParams.get("date");

    if (!slug || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonError("VALIDATION_ERROR", "Faltan el slug de la ruta o la fecha.", 400);
    }

    const route = await prisma.travelRoute.findUnique({ where: { slug } });
    if (!route || !route.isActive || route.bookingMode !== "AIRPORT") {
      return jsonError("ROUTE_NOT_FOUND", "La ruta no está disponible.", 404);
    }

    // Todos los vuelos del día (arribos y salidas): el pasajero elige el suyo y la reserva
    // toma la dirección del vuelo.
    const flights = await listAirportFlights({ date });

    return NextResponse.json(
      { date, flights },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

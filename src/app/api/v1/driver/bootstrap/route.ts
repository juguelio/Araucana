import { NextResponse } from "next/server";
import { AuthorizationError, requireDriverUser } from "@/lib/auth/service";
import { prisma } from "@/lib/db/prisma";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { dayRange, localDateKey, shiftDateKey } from "@/lib/operations/day-board";
import { cargarVentanasGpsApp } from "@/lib/driver/jornada-app";
import { listDriverUpcomingSchedules } from "@/lib/driver/schedules";

export async function GET(request: Request) {
  try {
    const user = await requireDriverUser(request);
    const fecha = localDateKey(new Date());
    const [ventanas, schedules] = await Promise.all([
      cargarVentanasGpsApp(user.id, fecha, 7),
      listDriverUpcomingSchedules({ driverId: user.id, from: dayRange(fecha).from, until: dayRange(shiftDateKey(fecha, 7)).from })
    ]);
    const vehicleIds = [...new Set(ventanas.flatMap(s => s.nave ? [s.nave.id] : []))];
    const [vehicles, currentLocation] = await Promise.all([
      prisma.vehicle.findMany({
        where: { id: { in: vehicleIds } },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          brand: true,
          model: true,
          licensePlate: true
        }
      }),
      prisma.driverVehicleLocation.findUnique({
        where: { driverId: user.id },
        include: {
          vehicle: {
            select: {
              name: true
            }
          }
        }
      })
    ]);

    return NextResponse.json({
      user,
      vehicles,
      routes: [...new Map(schedules.map(s => [s.routeId, s.route])).values()],
      schedules,
      currentLocation: currentLocation && vehicleIds.includes(currentLocation.vehicleId)
        ? {
            vehicleId: currentLocation.vehicleId,
            vehicleName: currentLocation.vehicle.name,
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
            accuracy: currentLocation.accuracy,
            heading: currentLocation.heading,
            speed: currentLocation.speed,
            recordedAt: currentLocation.recordedAt.toISOString(),
            updatedAt: currentLocation.updatedAt.toISOString()
          }
        : null
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return jsonError("UNAUTHORIZED", error.message, 401);
    }

    return handleApiError(error);
  }
}

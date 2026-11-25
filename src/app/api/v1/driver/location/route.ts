import { NextResponse } from "next/server";
import { AuthorizationError, requireDriverUser } from "@/lib/auth/service";
import { prisma } from "@/lib/db/prisma";
import { deriveLocationTelemetry, parseDriverLocationInput } from "@/lib/driver/location";
import { handleApiError, jsonError } from "@/lib/api/responses";

import { cargarVentanasGpsApp } from "@/lib/driver/jornada-app";
import { permiteUbicacion } from "@/lib/driver/gps-asignado";
import { localDateKey } from "@/lib/operations/day-board";

export async function POST(request: Request) {
  try {
    const user = await requireDriverUser(request);
    const body = await request.json().catch(() => null);
    const location = parseDriverLocationInput(body);
    const ahora = new Date();
    const antiguedad = +ahora - +location.recordedAt;
    if (antiguedad > 120000 || antiguedad < -60000) {
      return jsonError("UBICACION_VENCIDA", "Se necesita una lectura reciente del GPS.", 422);
    }
    const ventanas = await cargarVentanasGpsApp(user.id, localDateKey(ahora));
    const autorizada = (fecha: Date) => permiteUbicacion(ventanas, location.vehicleId, body.servicioId, body.manual === true, fecha);
    if (!autorizada(ahora) || !autorizada(location.recordedAt)) {
      return jsonError("SIN_ASIGNACION_GPS", "No hay una asignación vigente para informar esta nave.", 403);
    }

    const savedLocation = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      const previousLocation = await tx.driverVehicleLocation.findUnique({
        where: {
          driverId: user.id
        },
        select: {
          vehicleId: true,
          latitude: true,
          longitude: true,
          recordedAt: true,
          stoppedDurationSeconds: true,
          stopStartedAt: true
        }
      });
      if (previousLocation && previousLocation.recordedAt >= location.recordedAt) return null;
      const telemetry = deriveLocationTelemetry(location, previousLocation?.vehicleId === location.vehicleId ? previousLocation : null);
      const locationData = {
        ...location,
        servicioId: typeof body.servicioId === "string" ? body.servicioId : null,
        ...telemetry
      };

      await tx.driverLocationSample.create({
        data: {
          ...locationData,
          driverId: user.id
        }
      });

      return tx.driverVehicleLocation.upsert({
        where: {
          driverId: user.id
        },
        update: locationData,
        create: {
          ...locationData,
          driverId: user.id
        },
        include: {
          vehicle: {
            select: {
              name: true
            }
          }
        }
      });
    });

    if (!savedLocation) return jsonError("UBICACION_ANTERIOR", "Ya hay una lectura más reciente.", 409);
    return NextResponse.json({
      location: {
        vehicleId: savedLocation.vehicleId,
        vehicleName: savedLocation.vehicle.name,
        latitude: savedLocation.latitude,
        longitude: savedLocation.longitude,
        accuracy: savedLocation.accuracy,
        heading: savedLocation.heading,
        speed: savedLocation.speed,
        altitude: savedLocation.altitude,
        altitudeAccuracy: savedLocation.altitudeAccuracy,
        batteryLevel: savedLocation.batteryLevel,
        batteryCharging: savedLocation.batteryCharging,
        clientNetworkType: savedLocation.clientNetworkType,
        distanceFromPreviousMeters: savedLocation.distanceFromPreviousMeters,
        secondsFromPrevious: savedLocation.secondsFromPrevious,
        reportedSpeedKmh: savedLocation.reportedSpeedKmh,
        inferredSpeedKmh: savedLocation.inferredSpeedKmh,
        isStopped: savedLocation.isStopped,
        stoppedDurationSeconds: savedLocation.stoppedDurationSeconds,
        stopStartedAt: savedLocation.stopStartedAt?.toISOString() ?? null,
        recordedAt: savedLocation.recordedAt.toISOString(),
        updatedAt: savedLocation.updatedAt.toISOString()
      }
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return jsonError("UNAUTHORIZED", error.message, 401);
    }

    if (error instanceof Error && error.message === "Ubicacion invalida") {
      return jsonError("VALIDATION_ERROR", error.message, 400);
    }

    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { AuthorizationError, requireDriverUser } from "@/lib/auth/service";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { getDriverChapelcoManifest, todayServiceDateKey, updateChapelcoStopStatus } from "@/lib/chapelco/repository";
import type { ChapelcoManifestStatus } from "@/lib/chapelco/constants";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: Request) {
  try {
    const user = await requireDriverUser(request);
    const url = new URL(request.url);
    const date = url.searchParams.get("date")?.trim() || todayServiceDateKey();
    const runs = await getDriverChapelcoManifest(user.id, date);

    return NextResponse.json({ date, runs });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return jsonError("UNAUTHORIZED", error.message, 401);
    }

    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireDriverUser(request);
    const body = await request.json();
    const stopId = typeof body.stopId === "string" ? body.stopId : "";
    const status = typeof body.status === "string" ? (body.status as ChapelcoManifestStatus) : "PENDING";
    const stop = await prisma.chapelcoManifestStop.findFirst({
      where: {
        id: stopId,
        reservation: { status: { not: "CANCELLED" } },
        run: {
          status: { not: "CANCELLED" }, operationDay: { status: { not: "CANCELLED" } },
          vehicleDuty: {
            status: "ACTIVE", driverId: user.id
          }
        }
      },
      select: {
        id: true
      }
    });

    if (!stop) {
      return jsonError("STOP_NOT_FOUND", "Parada no encontrada", 404);
    }

    const updated = await updateChapelcoStopStatus({ stopId, status }, user);
    return NextResponse.json({ stop: updated });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return jsonError("UNAUTHORIZED", error.message, 401);
    }

    return handleApiError(error);
  }
}

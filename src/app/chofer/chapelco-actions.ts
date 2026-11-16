"use server";

import { revalidatePath } from "next/cache";
import { getCurrentDriverOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { reorderChapelcoStops, updateChapelcoStopStatus } from "@/lib/chapelco/repository";
import type { ChapelcoManifestStatus } from "@/lib/chapelco/constants";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

async function assertDriverOwnsStop(driverId: string, stopId: string) {
  const stop = await prisma.chapelcoManifestStop.findFirst({
    where: {
      id: stopId,
      run: {
        vehicleDuty: {
          driverId
        }
      }
    },
    select: {
      id: true
    }
  });

  if (!stop) {
    throw new Error("No tenes permiso para modificar esta parada.");
  }
}

export async function updateDriverStopStatusAction(formData: FormData) {
  const driver = await getCurrentDriverOrRedirect();
  const stopId = value(formData, "stopId");
  const status = value(formData, "status") as ChapelcoManifestStatus;

  await assertDriverOwnsStop(driver.id, stopId);
  await updateChapelcoStopStatus({ stopId, status }, driver);
  revalidatePath("/chofer");
}

export async function moveDriverStopAction(formData: FormData) {
  const driver = await getCurrentDriverOrRedirect();
  const runId = value(formData, "runId");
  const stopId = value(formData, "stopId");
  const direction = value(formData, "direction");
  const stops = await prisma.chapelcoManifestStop.findMany({
    where: {
      runId,
      run: {
        vehicleDuty: {
          driverId: driver.id
        }
      }
    },
    orderBy: { stopOrder: "asc" },
    select: { id: true }
  });
  const ids = stops.map((stop) => stop.id);
  const index = ids.indexOf(stopId);

  if (index === -1) {
    throw new Error("No encontramos la parada.");
  }

  const swapWith = direction === "up" ? index - 1 : index + 1;

  if (swapWith < 0 || swapWith >= ids.length) {
    return;
  }

  [ids[index], ids[swapWith]] = [ids[swapWith], ids[index]];
  await reorderChapelcoStops(runId, ids);
  revalidatePath("/chofer");
}

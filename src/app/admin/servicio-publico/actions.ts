"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordScheduleAudit } from "@/lib/audit/schedule";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { isDateKey } from "@/lib/operations/day-board";

export type DriverState = { error?: string };

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

/**
 * Chofer de una salida de servicio público, desde el tablero de boletería. Es el mismo dato que
 * asigna «Salidas del día» (#174), pero queda a mano donde se vende: el que atiende la terminal no
 * tiene que cambiar de pantalla para saber quién maneja.
 */
export async function savePublicServiceDriverAction(_state: DriverState, formData: FormData): Promise<DriverState> {
  const actor = await getCurrentReservationsUserOrRedirect();
  const scheduleId = value(formData, "scheduleId");
  const driverId = value(formData, "driverId") || null;
  const fecha = value(formData, "fecha");
  const terminal = value(formData, "terminal");

  if (!scheduleId) return { error: "No se indicó la salida." };

  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    select: { id: true, routeId: true, driverId: true }
  });
  if (!schedule) return { error: "La salida ya no existe." };
  if ((schedule.driverId ?? null) === driverId) {
    return { error: driverId ? "Esa salida ya tiene ese chofer." : "Esa salida ya está sin chofer." };
  }

  if (driverId) {
    const driver = await prisma.user.findFirst({
      where: { id: driverId, role: "DRIVER", isActive: true },
      select: { id: true }
    });
    if (!driver) return { error: "Ese chofer no está disponible: elegí un chofer activo." };
  }

  await prisma.$transaction(async (tx) => {
    const before = await tx.schedule.findUnique({ where: { id: scheduleId }, include: { extraUnits: true } });
    if (!before) throw new Error("La salida ya no existe.");
    const after = await tx.schedule.update({
      where: { id: scheduleId },
      data: { driverId },
      include: { extraUnits: true }
    });
    await recordScheduleAudit(
      tx,
      actor,
      driverId ? "Chofer asignado desde Servicio público." : "Chofer quitado desde Servicio público.",
      before,
      after
    );
  });

  revalidatePath("/admin/servicio-publico");
  revalidatePath("/admin/salidas-del-dia");
  revalidatePath(`/admin/rutas/${schedule.routeId}/salidas`);
  revalidatePath(`/admin/rutas/${schedule.routeId}/salidas/${scheduleId}`);

  const busqueda = new URLSearchParams();
  if (isDateKey(fecha)) busqueda.set("fecha", fecha);
  if (terminal) busqueda.set("terminal", terminal);
  redirect(`/admin/servicio-publico${busqueda.size ? `?${busqueda}` : ""}`);
}

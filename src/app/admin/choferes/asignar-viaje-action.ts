"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { assignPendingTrip, listPendingTrips } from "@/lib/driver/assign-trip";
import { tripKinds, type AssignTripResult } from "@/lib/driver/assign-trip-types";
import { prisma } from "@/lib/db/prisma";
import { tituloDeNave } from "@/lib/fleet/titulo-de-nave";
import { fechaUTC } from "@/lib/school-runs/week";

export async function cargarViajesPendientes(day: string) {
  await getCurrentAdminOrRedirect();
  if (typeof day !== "string" || !fechaUTC(day)) throw new Error("Fecha inválida.");
  const [viajes, flota] = await Promise.all([
    listPendingTrips(day, true),
    prisma.vehicle.findMany({
      where: { isActive: true, kind: { not: "UTILITARIO" } },
      select: { id: true, name: true, internalNumber: true, licensePlate: true, _count: { select: { seats: true } } }
    })
  ]);
  const naves = flota.map((v) => ({
    id: v.id, titulo: tituloDeNave(v),
    detalle: [v.licensePlate, v._count.seats ? `${v._count.seats} butacas` : null].filter(Boolean).join(" · ")
  })).sort((a, b) => a.titulo.localeCompare(b.titulo, "es", { numeric: true }));
  return { viajes, naves };
}

export async function asignarViajeAction(form: FormData): Promise<AssignTripResult> {
  const actor = await getCurrentAdminOrRedirect();
  const field = (name: string) => {
    const val = form.get(name);
    return typeof val === "string" ? val.trim() : "";
  };
  const day = field("day");
  const kind = tripKinds.find((k) => k === field("kind"));
  const id = field("id");
  const driverId = field("driverId");
  const vehicleId = field("vehicleId");
  if (!fechaUTC(day) || !kind || !id || !driverId || !vehicleId) {
    return { error: "Elegí un viaje del día y una nave." };
  }
  const result = await assignPendingTrip({ kind, id, day, driverId, vehicleId, actor, confirmation: field("confirmation") });
  if (!("saved" in result)) return result;
  revalidatePath("/admin/choferes");
  if (kind === "schedule") {
    revalidatePath("/admin/rutas/[id]/salidas", "page");
    revalidatePath("/admin/rutas/[id]/salidas/[scheduleId]", "page");
    revalidatePath("/rutas/[slug]", "page");
    revalidatePath("/reservar/[slug]", "page");
  }
  for (const path of [`/admin/choferes/${driverId}/actividad`, `/admin/choferes/${driverId}/ordenes`, "/chofer", "/admin/salidas-del-dia",
    "/admin/servicio-publico", "/admin/escolares", "/admin/aeropuerto", "/admin/aeropuerto/orden-de-servicio/ver", "/admin/viajes-especiales", "/admin/chapelco", "/admin/naves/en-vivo"]) {
    revalidatePath(path);
  }
  return result;
}

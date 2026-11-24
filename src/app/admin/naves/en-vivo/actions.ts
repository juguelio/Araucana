"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { airportPickupStart } from "@/lib/airport/pickup-start";
import { formatAuditDate } from "@/lib/audit/labels";
import { recordEntityAudit } from "@/lib/audit/entity";
import { recordScheduleAudit } from "@/lib/audit/schedule";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { vehicleConflictNotice } from "@/lib/booking/schedule-vehicle";
import { prisma } from "@/lib/db/prisma";
import { parseServicioId } from "@/lib/driver/servicio-id";
import { localDateKey } from "@/lib/operations/day-board";
import { fleetConflicts, lockFleet } from "@/lib/special-trips/conflicts";

/**
 * Asignar nave y chofer a un servicio sin salir de «Naves en vivo».
 *
 * Reusa lo que ya existe por área en vez de reimplementar reglas:
 * - **Aeropuerto**: la misma acción del módulo (`assignVehicleAction`), que respeta recorridas y
 *   devuelve los conflictos de flota tal cual los ve el tablero del aeropuerto.
 * - **Ruta**: actualiza la salida del día con el mismo chequeo de flota (`fleetConflicts`) y deja la
 *   auditoría en la salida (`recordScheduleAudit`), igual que el tablero de salidas.
 *
 * Vuele o no, siempre se vuelve a la vista con un mensaje: `?ok=` o `?error=`.
 */
function volver(fecha: string, clave: "ok" | "error", mensaje: string, vista: "en-vivo" | "servicios" = "en-vivo", page = ""): never {
  const params = new URLSearchParams({ vista });
  if (fecha) params.set("fecha", fecha);
  if (page && Number.parseInt(page, 10) > 1) params.set("page", page);
  params.set(clave, mensaje);
  redirect(`/admin/naves/en-vivo?${params.toString()}`);
}

export async function asignarUnidadAction(formData: FormData) {
  const actor = await getCurrentAdminOrRedirect();
  const servicioId = String(formData.get("servicioId") ?? "");
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const driverId = String(formData.get("driverId") ?? "") || null;
  const fecha = String(formData.get("fecha") ?? "");
  const vista: "en-vivo" | "servicios" = formData.get("vista") === "servicios" ? "servicios" : "en-vivo";
  const assignmentId = String(formData.get("assignmentId") ?? "") || null;
  const page = String(formData.get("page") ?? "");
  function responder(clave: "ok" | "error", mensaje: string): never {
    return volver(fecha, clave, mensaje, vista, page);
  }

  const servicio = parseServicioId(servicioId);
  if (!servicio) responder("error", "No se reconoció el servicio a asignar.");
  if (!vehicleId) responder("error", "Elegí la nave.");

  if (servicio.area === "AEROPUERTO") {
    const vuelo = await prisma.flight.findUnique({
      where: { id: servicio.id },
      select: {
        id: true,
        number: true,
        direction: true,
        scheduledAt: true,
        estimatedAt: true,
        pickupStartOverrideAt: true,
        pickupGroupId: true
      }
    });
    if (!vuelo) responder("error", "El vuelo ya no existe.");

    // Recorrida: la combi va a todos los vuelos del grupo y la hoja del chofer se arma allá. Se manda al
    // tablero del aeropuerto con el modal de naves de ese vuelo abierto, en vez de partir el grupo.
    if (vuelo.pickupGroupId) {
      const dia = localDateKey(airportPickupStart(vuelo) ?? vuelo.scheduledAt);
      redirect(`/admin/aeropuerto?${new URLSearchParams({ date: dia, naves: vuelo.id, notice: "Ese vuelo va en una recorrida: asigná la combi desde acá y se aplica a toda la vuelta." })}`);
    }

    const [naveVuelo, choferVuelo] = await Promise.all([
      prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { isActive: true, name: true } }),
      driverId
        ? prisma.user.findUnique({ where: { id: driverId }, select: { isActive: true, role: true, name: true, email: true } })
        : Promise.resolve(null)
    ]);
    if (!naveVuelo?.isActive) responder("error", "Esa nave no está disponible: elegí una unidad activa.");
    if (driverId && !(choferVuelo?.isActive && choferVuelo.role === "DRIVER")) {
      responder("error", "Ese chofer no está disponible: elegí un chofer activo.");
    }

    const desde = airportPickupStart(vuelo) ?? vuelo.scheduledAt;
    const hasta = new Date(desde.getTime() + 120 * 60_000);
    const resultadoVuelo = await prisma.$transaction(async (tx) => {
      await lockFleet(tx, [vehicleId]);
      const conflictos = await fleetConflicts(tx, { vehicleId, startsAt: desde, endsAt: hasta }, undefined, undefined, assignmentId ?? undefined);
      if (conflictos.length > 0) return { error: vehicleConflictNotice(conflictos) };

      if (assignmentId) {
        const { count } = await tx.airportVehicleAssignment.updateMany({
          where: { id: assignmentId, flightId: vuelo.id },
          data: { vehicleId, driverId }
        });
        if (count === 0) return { error: "La asignación de esa combi ya no existe: recargá la página." };
      } else {
        await tx.airportVehicleAssignment.create({
          data: { flightId: vuelo.id, vehicleId, driverId, createdBy: actor.id }
        });
      }
      await recordEntityAudit(tx, {
        actor,
        entity: "AIRPORT",
        entityId: vuelo.id,
        entityLabel: `${vuelo.number} · ${formatAuditDate(vuelo.scheduledAt)}`,
        summary: assignmentId
          ? "Combi reasignada al vuelo desde Naves en vivo."
          : "Combi asignada al vuelo desde Naves en vivo.",
        before: null,
        after: { vehicle: naveVuelo.name, driver: choferVuelo?.name ?? choferVuelo?.email ?? null }
      });
      return { ok: true as const };
    });

    if ("error" in resultadoVuelo && resultadoVuelo.error) responder("error", resultadoVuelo.error);

    revalidatePath("/admin/naves/en-vivo");
    revalidatePath("/admin/aeropuerto");
    revalidatePath("/admin/salidas-del-dia");
    revalidatePath("/admin/aeropuerto/orden-de-servicio/ver");
    responder("ok", `Combi ${naveVuelo.name} ${assignmentId ? "reasignada" : "asignada"} al vuelo ${vuelo.number}.`);
  }

  if (servicio.area !== "RUTA") {
    responder("error", "Chapelco y los viajes especiales se asignan desde su propio tablero.");
  }

  const salida = await prisma.schedule.findUnique({
    where: { id: servicio.id },
    select: {
      id: true,
      routeId: true,
      vehicleId: true,
      driverId: true,
      departureAt: true,
      arrivalAt: true,
      status: true,
      route: { select: { slug: true } }
    }
  });
  if (!salida) responder("error", "La salida ya no existe.");
  if (salida.status === "CANCELLED") responder("error", "La salida está cancelada.");

  const [nave, chofer] = await Promise.all([
    prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { isActive: true } }),
    driverId
      ? prisma.user.findUnique({ where: { id: driverId }, select: { isActive: true, role: true } })
      : Promise.resolve(null)
  ]);
  if (!nave?.isActive) responder("error", "Esa nave no está disponible: elegí una unidad activa.");
  if (driverId && !(chofer?.isActive && chofer.role === "DRIVER")) {
    responder("error", "Ese chofer no está disponible: elegí un chofer activo.");
  }

  const resultado = await prisma.$transaction(async (tx) => {
    await lockFleet(tx, [vehicleId]);
    const conflictos = await fleetConflicts(
      tx,
      { vehicleId, startsAt: salida.departureAt, endsAt: salida.arrivalAt },
      undefined,
      salida.id
    );
    if (conflictos.length > 0) return { error: vehicleConflictNotice(conflictos) };

    const antes = await tx.schedule.findUnique({ where: { id: salida.id } });
    const despues = await tx.schedule.update({
      where: { id: salida.id },
      data: { vehicleId, driverId }
    });
    await recordScheduleAudit(tx, actor, "Nave y chofer de la salida asignados desde Naves en vivo.", antes, despues);
    return { ok: true as const };
  });

  if ("error" in resultado && resultado.error) responder("error", resultado.error);

  revalidatePath("/admin/naves/en-vivo");
  revalidatePath("/admin/salidas-del-dia");
  revalidatePath(`/admin/rutas/${salida.routeId}/salidas`);
  revalidatePath(`/admin/rutas/${salida.routeId}/salidas/${salida.id}`);
  if (salida.route.slug) {
    revalidatePath(`/rutas/${salida.route.slug}`);
    revalidatePath(`/reservar/${salida.route.slug}`);
  }
  responder("ok", "Nave y chofer asignados a la salida.");
}

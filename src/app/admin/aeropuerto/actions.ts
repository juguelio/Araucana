"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { detectFlightChange, FLIGHT_STATUSES, jetSmartCanonicalNumber } from "@/lib/airport/flights";
import { fechaLocal } from "@/lib/airport/projection";
import { syncAirportFlights } from "@/lib/airport/sync";
import { mensajeDeRefresco } from "@/lib/airport/sync-summary";
import { getCurrentAdminOrRedirect, getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { conflictKey, dayInterval, lockFleet, recordAcceptance, specialConflicts, type FleetConflict } from "@/lib/special-trips/conflicts";
import { argentina, localDateTime, localInput } from "@/lib/special-trips/data";
import { prisma } from "@/lib/db/prisma";
import { readForAudit, recordEntityAudit, recordEntityAuditAfterCommit, type EntityAudit } from "@/lib/audit/entity";
import { formatAuditDate } from "@/lib/audit/labels";
import { AIRLABS_KEY_SETTING, setSetting } from "@/lib/settings/app-settings";
import { errorState, type AdminFieldErrors, type AdminFormState } from "../form-state";
import { redirectToBoard, returnsToBoard } from "../salidas-del-dia/return-to";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function notice(text: string): never {
  redirect(`/admin/aeropuerto?notice=${encodeURIComponent(text)}`);
}

/** "AR 1656 · 16/11/2026, 14:30": cómo se nombra un vuelo en la auditoría. */
function flightLabel(flight: { number: string; scheduledAt: Date }) {
  return `${flight.number} · ${formatAuditDate(flight.scheduledAt)}`;
}

/** Para escrituras que ya quedaron guardadas: la auditoría no puede convertirlas en un error. */
function auditAirport(entry: Omit<EntityAudit, "entity">) {
  return recordEntityAuditAfterCommit(prisma, { entity: "AIRPORT", ...entry });
}

export async function savePickupStartAction(formData: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const date = value(formData, "date");
  if (!z.iso.date().safeParse(date).success) notice("Revisá la fecha de la recorrida.");

  function finish(message: string): never {
    redirect(`/admin/aeropuerto?${new URLSearchParams({ date, notice: message })}`);
  }

  const ids = [...new Set(formData.getAll("flightId").filter((id): id is string => typeof id === "string" && Boolean(id)))];
  if (!ids.length || ids.length > 100) finish("Seleccioná los vuelos que querés actualizar.");

  const reset = value(formData, "operation") === "reset";
  const local = value(formData, "pickupStart");
  const [pickupDate, pickupTime] = local.split("T");
  if (!reset && (!z.iso.date().safeParse(pickupDate).success || !/^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime ?? ""))) {
    finish("Ingresá la fecha y hora de inicio de la recorrida.");
  }

  const start = reset ? null : new Date(`${local}:00-03:00`);
  const dayStart = new Date(`${date}T00:00:00-03:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600000);
  const where = {
    id: { in: ids },
    direction: "DEPARTURE",
    status: { notIn: ["CANCELLED", "DIVERTED"] },
    scheduledAt: { gte: dayStart, lt: dayEnd }
  };
  const flights = await prisma.flight.findMany({ where, select: { number: true, scheduledAt: true, estimatedAt: true, pickupStartOverrideAt: true } });
  if (flights.length !== ids.length) finish("Seleccioná partidas activas del día que estás viendo.");
  if (start && (!Number.isFinite(start.getTime()) || start.getTime() < dayStart.getTime() - 24 * 3600000 ||
    flights.some((flight) => start >= flight.scheduledAt || (flight.estimatedAt && start >= flight.estimatedAt)))) {
    finish("El inicio debe ser el día de los vuelos o el día anterior, y antes de todas las partidas seleccionadas.");
  }

  await prisma.flight.updateMany({ where, data: { pickupStartOverrideAt: start } });
  const previousStarts = [...new Set(flights.map((flight) => (flight.pickupStartOverrideAt ? formatAuditDate(flight.pickupStartOverrideAt) : "estimado")))].join(", ");
  await auditAirport({
    actor, action: "UPDATE", entityLabel: flights.map((flight) => flight.number).join(", ").slice(0, 200),
    summary: reset ? `Inicio de recorrida restaurado al estimado en ${flights.length} partidas del ${date}.` : `Inicio de recorrida fijado para ${flights.length} partidas del ${date}.`,
    extra: { pickupStartOverrideAt: { before: previousStarts, after: start ? start.toISOString() : "estimado" } }
  });
  revalidatePath("/admin/aeropuerto");
  revalidatePath("/reservar/[slug]", "page");
  finish(reset ? "Se restauró el horario estimado de las partidas seleccionadas." : "Se guardó el inicio de recorrida para las partidas seleccionadas.");
}

export async function createFlightAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await getCurrentReservationsUserOrRedirect();

  const inputNumber = value(formData, "number").toUpperCase();
  const canonical = jetSmartCanonicalNumber(inputNumber);
  const number = canonical ?? inputNumber;
  const airline = canonical ? "JA" : value(formData, "airline") || null;
  const origin = value(formData, "origin");
  const direction = value(formData, "direction") === "DEPARTURE" ? "DEPARTURE" : "ARRIVAL";
  const scheduledAt = value(formData, "scheduledAt");
  const passengers = value(formData, "passengers");
  const notes = value(formData, "notes") || null;

  const fieldErrors: AdminFieldErrors = {};
  if (!number) fieldErrors.number = "Ingresá el número de vuelo (ej. AR 1656).";
  if (!origin) fieldErrors.origin = "Ingresá el origen o destino.";
  if (!scheduledAt) fieldErrors.scheduledAt = "Ingresá la fecha y hora programada.";
  if (Object.keys(fieldErrors).length > 0) return errorState("Revisá los datos del vuelo.", fieldErrors);

  const horario = new Date(scheduledAt);
  if (!Number.isFinite(horario.getTime())) return errorState("Revisá la fecha y hora programada.");

  if (canonical) {
    const { startsAt, endsAt } = dayInterval(fechaLocal(horario));
    const existe = await prisma.flight.findFirst({
      where: { number, direction, scheduledAt: { gte: startsAt, lt: endsAt } }
    });
    if (existe) return errorState(`El vuelo ${number} ya está cargado para ese día.`);
  }

  const { count } = await prisma.flight.createMany({
    skipDuplicates: true,
    data: {
      number,
      airline,
      origin,
      direction,
      scheduledAt: horario,
      passengers: passengers ? Number(passengers) : null,
      notes,
      source: "MANUAL"
    }
  });

  if (!count) return errorState(`El vuelo ${number} ya está cargado.`);
  await auditAirport({
    actor, entityLabel: flightLabel({ number, scheduledAt: horario }), summary: "Vuelo cargado a mano.",
    after: { number, airline, origin, direction, scheduledAt: horario, passengers: passengers ? Number(passengers) : null, notes }
  });

  revalidatePath("/admin/aeropuerto");
  notice(`Vuelo ${number} cargado.`);
}

/**
 * Cambia el estado o la hora estimada. Si el cambio es un imprevisto (demora, cancelación,
 * desvío, adelanto), queda registrado como FlightEvent: eso es lo que después avisa.
 */
export async function updateFlightAction(formData: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();

  const id = value(formData, "id");
  const status = value(formData, "status");
  const estimatedAt = value(formData, "estimatedAt");

  const prev = await prisma.flight.findUnique({ where: { id } });
  if (!prev) notice("El vuelo ya no existe.");

  const estimate = estimatedAt ? localDateTime(estimatedAt, argentina) : prev.estimatedAt;
  if ((status && status !== prev.status && !FLIGHT_STATUSES.some((item) => item.code === status)) || (estimatedAt && !estimate)) {
    redirect(`/admin/aeropuerto/${id}/editar?notice=${encodeURIComponent("Revisá el estado y la hora estimada del vuelo.")}`);
  }
  const next = { status: status || prev.status, scheduledAt: prev.scheduledAt, estimatedAt: estimate };

  const cambio = detectFlightChange(
    { status: prev.status, scheduledAt: prev.scheduledAt, estimatedAt: prev.estimatedAt },
    next
  );

  const updated = await prisma.flight.update({
    where: { id },
    data: {
      status: next.status,
      estimatedAt: next.estimatedAt,
      actualAt: next.status === "LANDED" && prev.status !== "LANDED" ? new Date() : prev.actualAt,
      ...(cambio
        ? { events: { create: { kind: cambio.kind, fromValue: cambio.fromValue, toValue: cambio.toValue } } }
        : {})
    }
  });
  await auditAirport({
    actor, entityId: id, entityLabel: flightLabel(prev), summary: "Estado u horario del vuelo cambiado a mano.",
    before: { status: prev.status, estimatedAt: prev.estimatedAt, actualAt: prev.actualAt },
    after: { status: updated.status, estimatedAt: updated.estimatedAt, actualAt: updated.actualAt }
  });

  revalidatePath("/admin/aeropuerto");
  revalidatePath(`/admin/aeropuerto/${id}/editar`);
  const message = cambio ? `Cambio registrado: ${cambio.kind} (${next.status}).` : "Vuelo actualizado.";
  redirect(`/admin/aeropuerto?${new URLSearchParams({ date: fechaLocal(prev.scheduledAt), notice: message })}#vuelo-${id}`);
}

/** Asigna una combi a un vuelo. Se puede cambiar hasta último momento: agregar, cambiar o quitar. */
export async function assignVehicleAction(_state: unknown, formData: FormData): Promise<{ error?: string; conflicts?: FleetConflict[]; confirmation?: string }> {
  const user = await getCurrentReservationsUserOrRedirect();

  const flightId = value(formData, "flightId");
  const vehicleId = value(formData, "vehicleId");
  const driverId = value(formData, "driverId") || null;
  if (!flightId || !vehicleId) return { error: "Elegí una combi para asignar." };

  const result = await prisma.$transaction(async (tx) => {
    await lockFleet(tx, [vehicleId]);
    const flight = await tx.flight.findUnique({ where: { id: flightId } });
    if (!flight) return { error: "El vuelo ya no existe." };
    const days = new Set([flight.scheduledAt, flight.estimatedAt, flight.pickupStartOverrideAt]
      .flatMap((date) => date ? [localInput(date).slice(0, 10)] : []));
    const hits = ["CANCELLED", "DIVERTED"].includes(flight.status) ? [] : (await Promise.all(
      [...days].map((day) => specialConflicts(tx, { vehicleId, ...dayInterval(day) }, undefined, true))
    )).flat();
    const conflicts = [...new Map(hits.map((hit) => [hit.id, hit])).values()];
    const confirmation = conflictKey(conflicts, [flightId, vehicleId]);
    if (conflicts.length && value(formData, "confirmation") !== confirmation) return { conflicts, confirmation };

    const previous = await tx.airportVehicleAssignment.findUnique({
      where: { flightId_vehicleId: { flightId, vehicleId } }, select: { driverId: true }
    });
    const assignment = await tx.airportVehicleAssignment.upsert({
      where: { flightId_vehicleId: { flightId, vehicleId } },
      update: { driverId },
      create: { flightId, vehicleId, driverId }
    });
    await recordAcceptance(tx, "AIRPORT", assignment.id, user.id, conflicts);
    const [vehicle, drivers] = await Promise.all([
      tx.vehicle.findUnique({ where: { id: vehicleId }, select: { name: true } }),
      tx.user.findMany({ where: { id: { in: [previous?.driverId, driverId].filter((d): d is string => !!d) } }, select: { id: true, name: true, email: true } })
    ]);
    const driverName = (driver: string | null | undefined) => {
      const found = drivers.find((item) => item.id === driver);
      return found ? found.name ?? found.email : null;
    };
    await recordEntityAudit(tx, {
      actor: user, entity: "AIRPORT", entityId: flightId, entityLabel: flightLabel(flight),
      action: previous ? "UPDATE" : "CREATE",
      summary: previous ? `Chofer de la combi ${vehicle?.name ?? vehicleId} cambiado en el vuelo.` : `Combi ${vehicle?.name ?? vehicleId} asignada al vuelo.`,
      before: previous ? { driver: driverName(previous.driverId) } : null,
      after: { vehicle: vehicle?.name ?? vehicleId, driver: driverName(driverId) }
    });
    return { day: localInput(flight.scheduledAt).slice(0, 10) };
  });
  if (!result.day) return result;
  revalidatePath("/admin/aeropuerto");
  revalidatePath("/admin/salidas-del-dia");
  if (returnsToBoard(formData)) redirectToBoard(result.day, "Combi asignada al vuelo.");
  redirect(`/admin/aeropuerto?date=${result.day}&notice=${encodeURIComponent("Combi asignada al vuelo.")}`);
}

export async function removeAssignmentAction(formData: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const removed = await readForAudit(() => prisma.airportVehicleAssignment.findUnique({
    where: { id: value(formData, "id") },
    select: { flight: { select: { id: true, number: true, scheduledAt: true } }, vehicle: { select: { name: true } }, driver: { select: { name: true, email: true } } }
  }));
  await prisma.airportVehicleAssignment.delete({ where: { id: value(formData, "id") } });
  if (removed) {
    await auditAirport({
      actor, entityId: removed.flight.id, entityLabel: flightLabel(removed.flight), action: "DELETE",
      summary: `Combi ${removed.vehicle.name} quitada del vuelo.`,
      before: { vehicle: removed.vehicle.name, driver: removed.driver ? removed.driver.name ?? removed.driver.email : null }
    });
  }
  revalidatePath("/admin/aeropuerto");
  revalidatePath("/admin/salidas-del-dia");
  if (removed && returnsToBoard(formData)) redirectToBoard(localInput(removed.flight.scheduledAt).slice(0, 10), "Combi quitada del vuelo.");
  notice("Combi quitada del vuelo.");
}

export async function deleteFlightAction(formData: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const deleted = await readForAudit(() => prisma.flight.findUnique({ where: { id: value(formData, "id") } }));
  await prisma.flight.delete({ where: { id: value(formData, "id") } });
  if (deleted) await auditAirport({ actor, entityId: deleted.id, entityLabel: flightLabel(deleted), summary: "Vuelo borrado.", before: deleted });
  revalidatePath("/admin/aeropuerto");
  notice("Vuelo borrado.");
}

/**
 * Modo degradado: si todavía no hay proveedor de datos en vivo, el botón no rompe nada
 * y lo dice. Una combi no puede depender de un servicio externo.
 */
export async function refreshFlightsAction() {
  const actor = await getCurrentReservationsUserOrRedirect();
  const r = await syncAirportFlights({ actor });
  revalidatePath("/admin/aeropuerto");
  // Un solo aviso con todo: el modo degradado no puede esconder la intervención manual pendiente.
  notice(mensajeDeRefresco(r));
}

/**
 * Guarda la clave de AirLabs desde el panel y la prueba en el momento. Antes vivía sólo en una
 * variable de entorno del hosting: así se puede resolver sin depender de nadie más. Sólo ADMIN.
 */
export async function saveAirLabsKeyAction(formData: FormData) {
  const usuario = await getCurrentAdminOrRedirect();
  const borrar = value(formData, "borrar");
  const apiKey = value(formData, "apiKey");

  if (borrar) {
    await setSetting(AIRLABS_KEY_SETTING, null, usuario.email);
    await auditAirport({ actor: usuario, action: "DELETE", entityLabel: "Clave de AirLabs", summary: "Clave de AirLabs borrada: los vuelos dejan de actualizarse solos." });
    revalidatePath("/admin/aeropuerto");
    notice("Clave borrada: los vuelos se siguen viendo, pero ya no se actualizan solos.");
  }

  if (apiKey.length < 8) {
    notice("Esa clave no parece válida (es muy corta). No se guardó nada.");
  }

  await setSetting(AIRLABS_KEY_SETTING, apiKey, usuario.email);
  // Sólo el hecho: la clave no se copia a la auditoría.
  await auditAirport({ actor: usuario, action: "UPDATE", entityLabel: "Clave de AirLabs", summary: "Clave de AirLabs guardada." });
  const r = await syncAirportFlights({ actor: usuario });
  revalidatePath("/admin/aeropuerto");

  if (r.errores.length > 0) {
    notice(`La clave se guardó, pero AirLabs no respondió: ${r.errores[0]}`);
  }

  notice(
    `Clave guardada y probada: ${r.creados} vuelos nuevos, ${r.actualizados} revisados, ${r.proyectados} proyectados.`
  );
}

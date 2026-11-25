"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { detectFlightChange, FLIGHT_STATUSES, jetSmartCanonicalNumber } from "@/lib/airport/flights";
import { fechaLocal } from "@/lib/airport/projection";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { dayInterval, type FleetConflict } from "@/lib/special-trips/conflicts";
import { BookingError } from "@/lib/booking/repository";
import { PrivateVehicleGroupConflict, reagruparVuelos } from "@/lib/airport/pickup-group";
import { argentina, localDateTime, localInput } from "@/lib/special-trips/data";
import { prisma } from "@/lib/db/prisma";
import { readForAudit, recordEntityAuditAfterCommit, type EntityAudit } from "@/lib/audit/entity";
import { formatAuditDate } from "@/lib/audit/labels";
import { flightLabel, saveAirportFleet } from "@/lib/airport/fleet-assignment";
import { errorState, type AdminFieldErrors, type AdminFormState } from "../form-state";
import { redirectToBoard, returnsToBoard } from "../salidas-del-dia/return-to";
import { navesStepHref, orderReturnHref } from "./return-to-order";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function notice(text: string): never {
  redirect(`/admin/aeropuerto?notice=${encodeURIComponent(text)}`);
}

/** Para escrituras que ya quedaron guardadas: la auditoría no puede convertirlas en un error. */
function auditAirport(entry: Omit<EntityAudit, "entity">) {
  return recordEntityAuditAfterCommit(prisma, { entity: "AIRPORT", ...entry });
}

/** Después de armar la recorrida, el tablero abre las combis del vuelo de origen (o del primero) para el paso 2. */
function irAlPasoDeNaves(date: string, ids: string[], origen: string, message: string): never {
  const vuelo = ids.includes(origen) ? origen : ids[0];
  redirect(`/admin/aeropuerto?${new URLSearchParams({ date, notice: message, naves: vuelo })}`);
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

  // Las partidas que se coordinan juntas las hace la misma camioneta: la hoja del chofer las une en una
  // orden. Restaurar el estimado las separa (cada una vuelve a su propia hora).
  const grupo = await prisma.$transaction(async (tx) => {
    await tx.flight.updateMany({ where, data: { pickupStartOverrideAt: start } });
    return reagruparVuelos(tx, ids, !reset);
  }, { isolationLevel: "Serializable" }).catch(error => {
    if (error instanceof PrivateVehicleGroupConflict) finish(error.message);
    throw error;
  });
  const previousStarts = [...new Set(flights.map((flight) => (flight.pickupStartOverrideAt ? formatAuditDate(flight.pickupStartOverrideAt) : "estimado")))].join(", ");
  await auditAirport({
    actor, action: "UPDATE", entityLabel: flights.map((flight) => flight.number).join(", ").slice(0, 200),
    summary: reset ? `Inicio de recorrida restaurado al horario inicial en ${flights.length} partidas del ${date}.` : `Inicio de recorrida fijado para ${flights.length} partidas del ${date}.`,
    extra: {
      pickupStartOverrideAt: { before: previousStarts, after: start ? start.toISOString() : "estimado" },
      ...(grupo.cambio ? { recorridaCompartida: { before: "—", after: grupo.grupo ? flights.map((flight) => flight.number).join(" + ") : "separadas" } } : {})
    }
  });
  revalidatePath("/admin/aeropuerto");
  revalidatePath("/admin/aeropuerto/orden-de-servicio/ver");
  revalidatePath("/reservar/[slug]", "page");
  if (reset) finish("Se restauró el horario inicial de las partidas seleccionadas.");
  // Paso 2: naves y choferes de la recorrida, en el modal de combis del vuelo desde donde se coordinó.
  irAlPasoDeNaves(date, ids, value(formData, "origen"), "Recorrida coordinada. Ahora elegí las naves y los choferes.");
}

/**
 * «Juntar arribos»: los arribos que espera la misma camioneta en el aeropuerto y reparte en una sola
 * vuelta. No toca ninguna hora (los arribos no tienen recorrida coordinada ni corte por recorrida):
 * sólo los agrupa para que la hoja del chofer los una en una orden. `split` los separa.
 */
export async function saveArrivalGroupAction(formData: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const date = value(formData, "date");
  if (!z.iso.date().safeParse(date).success) notice("Revisá la fecha de los arribos.");

  function finish(message: string): never {
    redirect(`/admin/aeropuerto?${new URLSearchParams({ date, notice: message })}`);
  }

  const ids = [...new Set(formData.getAll("flightId").filter((id): id is string => typeof id === "string" && Boolean(id)))];
  const split = value(formData, "operation") === "split";
  if (!ids.length || ids.length > 100) finish("Seleccioná los arribos.");
  if (!split && ids.length < 2) finish("Marcá al menos dos arribos para juntarlos en una orden.");

  const dayStart = new Date(`${date}T00:00:00-03:00`);
  const flights = await prisma.flight.findMany({
    where: { id: { in: ids }, direction: "ARRIVAL", status: { notIn: ["CANCELLED", "DIVERTED"] }, scheduledAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 24 * 3600000) } },
    select: { number: true }
  });
  if (flights.length !== ids.length) finish("Seleccioná arribos activos del día que estás viendo.");

  const grupo = await prisma.$transaction((tx) => reagruparVuelos(tx, ids, !split), { isolationLevel: "Serializable" }).catch(error => {
    if (error instanceof PrivateVehicleGroupConflict) finish(error.message);
    throw error;
  });
  if (grupo.cambio) {
    await auditAirport({
      actor, action: "UPDATE", entityLabel: flights.map((flight) => flight.number).join(", ").slice(0, 200),
      summary: split ? `Arribos separados (${flights.length}) del ${date}.` : `${flights.length} arribos del ${date} juntados en una sola recorrida.`,
      extra: { recorridaCompartida: { before: "—", after: split ? "separados" : flights.map((flight) => flight.number).join(" + ") } }
    });
  }
  revalidatePath("/admin/aeropuerto");
  revalidatePath("/admin/aeropuerto/orden-de-servicio/ver");
  if (split) finish("Los arribos quedaron separados: cada uno con su orden.");
  irAlPasoDeNaves(date, ids, value(formData, "origen"), "Arribos juntados en una recorrida. Ahora elegí las naves y los choferes.");
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

/**
 * Asigna una combi a un vuelo, con su chofer, o le cambia el chofer a una combi que ya tiene. Se puede
 * cambiar hasta último momento: agregar, cambiar o quitar. Si la nave o el chofer ya están ocupados
 * en ese tramo, avisa y pide confirmar (como el resto del panel).
 *
 * Si el vuelo va en una recorrida (`pickupGroupId`), la asignación es de la recorrida: la combi y el chofer
 * van a todos sus vuelos. Una recorrida puede salir con varias combis (dos vuelos llenos, dos trafics): las
 * que ya tenía se quedan y la hoja del chofer reparte a los pasajeros de todos los vuelos entre ellas, por
 * zona. Para cambiar una combi por otra se quita la vieja. Separar el grupo sigue siendo una acción
 * explícita («Separar»).
 *
 * Sin el campo `driverId` en el formulario (el tablero de salidas sólo manda la nave) el chofer de una
 * combi ya asignada no se toca.
 */
export async function assignVehicleAction(_state: unknown, formData: FormData): Promise<{ error?: string; conflicts?: FleetConflict[]; confirmation?: string }> {
  const user = await getCurrentReservationsUserOrRedirect();

  const flightId = value(formData, "flightId");
  const vehicleId = value(formData, "vehicleId");
  const sendsDriver = formData.has("driverId");
  const requestedDriver = value(formData, "driverId") || null;
  if (!flightId || !vehicleId) return { error: "Elegí una combi para asignar." };

  const result = await prisma.$transaction(tx => saveAirportFleet(tx, user, {
    flightId, vehicleId, driverId: sendsDriver ? requestedDriver : undefined,
    privateReservationId: value(formData, "privateReservationId"), assignmentId: value(formData, "assignmentId"),
    previousDriverId: value(formData, "previousDriverId"),
    previousVehicleId: formData.has("previousVehicleId") ? value(formData, "previousVehicleId") : undefined,
    confirmation: value(formData, "confirmation")
  }), { isolationLevel: "Serializable" }).catch(error => {
    if (error instanceof BookingError) return { error: error.message };
    if (error?.code === "P2034" || error?.code === "P2002") {
      return { error: "La asignación cambió mientras guardabas. Revisá la nave y volvé a intentar." };
    }
    throw error;
  });
  if (!("day" in result)) return result;
  const { day, message } = result;
  revalidatePath("/admin/aeropuerto");
  revalidatePath("/admin/salidas-del-dia");
  revalidatePath("/admin/aeropuerto/orden-de-servicio/ver");
  if (returnsToBoard(formData)) redirectToBoard(day, message);
  const toOrder = orderReturnHref(formData, message);
  if (toOrder) redirect(toOrder);
  const toNaves = navesStepHref(formData, day, message);
  if (toNaves) redirect(toNaves);
  redirect(`/admin/aeropuerto?date=${day}&notice=${encodeURIComponent(message)}`);
}

/**
 * Quita una combi del vuelo. Si el vuelo va en una recorrida, la combi sale de toda la recorrida: la
 * asignación es de la vuelta, y dejarla en un solo vuelo partiría la hoja del chofer sin avisar.
 */
export async function removeAssignmentAction(formData: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const removed = await readForAudit(() => prisma.airportVehicleAssignment.findUnique({
    where: { id: value(formData, "id") },
    select: {
      vehicleId: true, privateReservationId: true,
      flight: { select: { id: true, number: true, scheduledAt: true, pickupGroupId: true } },
      vehicle: { select: { name: true } },
      driver: { select: { name: true, email: true } }
    }
  }));
  const companeras = !removed?.privateReservationId && removed?.flight.pickupGroupId
    ? await prisma.airportVehicleAssignment.findMany({
      where: { vehicleId: removed.vehicleId, privateReservationId: null, flight: { pickupGroupId: removed.flight.pickupGroupId }, id: { not: value(formData, "id") } },
      select: { id: true, flight: { select: { id: true, number: true, scheduledAt: true } } }
    })
    : [];
  await prisma.airportVehicleAssignment.deleteMany({ where: { id: { in: [value(formData, "id"), ...companeras.map((otra) => otra.id)] } } });
  if (removed) {
    const before = { vehicle: removed.vehicle.name, driver: removed.driver ? removed.driver.name ?? removed.driver.email : null };
    await auditAirport({
      actor, entityId: removed.flight.id, entityLabel: flightLabel(removed.flight), action: "DELETE",
      summary: `Combi ${removed.vehicle.name} quitada del vuelo.`,
      before
    });
    for (const otra of companeras) {
      await auditAirport({
        actor, entityId: otra.flight.id, entityLabel: flightLabel(otra.flight), action: "DELETE",
        summary: `Combi ${removed.vehicle.name} quitada de la recorrida de ${flightLabel(removed.flight)}.`,
        before
      });
    }
  }
  revalidatePath("/admin/aeropuerto");
  revalidatePath("/admin/salidas-del-dia");
  revalidatePath("/admin/aeropuerto/orden-de-servicio/ver");
  if (removed && returnsToBoard(formData)) redirectToBoard(localInput(removed.flight.scheduledAt).slice(0, 10), "Combi quitada del vuelo.");
  const toOrder = orderReturnHref(formData, "Combi quitada del vuelo.");
  if (toOrder) redirect(toOrder);
  const toNaves = removed ? navesStepHref(formData, localInput(removed.flight.scheduledAt).slice(0, 10), "Combi quitada de la recorrida.") : null;
  if (toNaves) redirect(toNaves);
  // Vuelve al día del vuelo: quitar una combi desde el modal no puede dejar al operador en otro día.
  if (removed) redirect(`/admin/aeropuerto?${new URLSearchParams({ date: localInput(removed.flight.scheduledAt).slice(0, 10), notice: "Combi quitada del vuelo." })}`);
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


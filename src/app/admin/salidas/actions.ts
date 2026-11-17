"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { vehicleConflictNotice } from "@/lib/booking/schedule-vehicle";
import { fleetConflicts, lockFleet, savePublicSchedule } from "@/lib/special-trips/conflicts";
import { addScheduleUnit, primaryVehicleProblem, removeScheduleUnit } from "@/lib/booking/schedule-unit-service";
import type { FleetConflict } from "@/lib/special-trips/conflicts";
import { prisma } from "@/lib/db/prisma";
import { recordScheduleAudit } from "@/lib/audit/schedule";
import type { AuditActor } from "@/lib/audit/record";
import { errorState, type AdminFieldErrors, type AdminFormState } from "../form-state";

const scheduleStatuses = new Set(["OPEN", "DOCUMENTATION", "CLOSED"]);

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

class FormValidationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: AdminFieldErrors
  ) {
    super(message);
  }
}

function parseDeparture(raw: string) {
  if (!raw) {
    throw new FormValidationError("Revisa los campos marcados para guardar la salida.", {
      departureAt: "Elegi fecha y hora de salida."
    });
  }

  const normalized = raw.includes(":") ? raw : `${raw}T00:00`;
  const date = new Date(`${normalized}:00-03:00`);

  if (Number.isNaN(date.getTime())) {
    throw new FormValidationError("Revisa los campos marcados para guardar la salida.", {
      departureAt: "La fecha de salida no es valida."
    });
  }

  return date;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

async function scheduleData(formData: FormData) {
  const routeId = value(formData, "routeId");
  const vehicleId = value(formData, "vehicleId");
  const status = value(formData, "status") || "OPEN";
  const fieldErrors: AdminFieldErrors = {};

  if (!routeId) {
    fieldErrors.routeId = "Elegi una ruta para la salida.";
  }

  if (!vehicleId) {
    fieldErrors.vehicleId = "Elegi una nave para la salida.";
  }

  if (Object.keys(fieldErrors).length) {
    throw new FormValidationError("Revisa los campos marcados para guardar la salida.", fieldErrors);
  }

  if (!scheduleStatuses.has(status)) {
    throw new FormValidationError("Revisa los campos marcados para guardar la salida.", {
      status: "El estado seleccionado no es valido."
    });
  }

  const route = await prisma.travelRoute.findUnique({
    where: { id: routeId },
    select: { durationMin: true, slug: true }
  });

  if (!route) {
    throw new FormValidationError("Revisa los campos marcados para guardar la salida.", {
      routeId: "La ruta seleccionada ya no existe."
    });
  }

  const departureAt = parseDeparture(value(formData, "departureAt"));

  return {
    data: {
      routeId,
      vehicleId,
      departureAt,
      arrivalAt: addMinutes(departureAt, route.durationMin),
      status
    },
    routeSlug: route.slug
  };
}

function scheduleErrorState(error: unknown) {
  if (error instanceof FormValidationError) {
    return errorState(error.message, error.fieldErrors);
  }

  return errorState("No pudimos guardar la salida. Intentalo nuevamente.");
}

function revalidateSchedulePaths(routeSlug?: string, routeId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/rutas");
  revalidatePath("/rutas");

  if (routeId) {
    revalidatePath(`/admin/rutas/${routeId}/salidas`);
  }

  if (routeSlug) {
    revalidatePath(`/rutas/${routeSlug}`);
    revalidatePath(`/reservar/${routeSlug}`);
  }
}

/** Guarda la salida y, si se guardó, deja la auditoría en la misma transacción. */
async function saveAudited(
  actor: AuditActor & { id: string },
  summary: string,
  data: Parameters<typeof savePublicSchedule>[1],
  confirmation: string,
  id?: string,
  statusOnly = false
) {
  return prisma.$transaction(async (tx) => {
    const before = id ? await tx.schedule.findUnique({ where: { id } }) : null;
    const problem = id && !statusOnly ? await primaryVehicleProblem(tx, id, data.vehicleId) : null;
    if (problem) throw new FormValidationError(problem, { vehicleId: problem });
    const result = await savePublicSchedule(tx, data, actor.id, confirmation, id, statusOnly);
    if ("id" in result && result.id) {
      await recordScheduleAudit(tx, actor, summary, before, await tx.schedule.findUnique({ where: { id: result.id } }));
    }
    return result;
  });
}

async function saveSchedule(data: Awaited<ReturnType<typeof scheduleData>>["data"], form: FormData, actor: AuditActor & { id: string }, id?: string) {
  const result = await saveAudited(actor, id ? "Salida editada." : "Salida creada.", data, value(form, "confirmation"), id);
  if (result.conflicts) return { ...errorState("La nave ya tiene un viaje especial en ese horario."), ...result };
  return null;
}

export async function createScheduleAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const user = await getCurrentAdminOrRedirect();

  let schedule: Awaited<ReturnType<typeof scheduleData>>;
  try {
    schedule = await scheduleData(formData);
    const warning = await saveSchedule(schedule.data, formData, user);
    if (warning) return warning;
  } catch (error) {
    return scheduleErrorState(error);
  }

  revalidateSchedulePaths(schedule.routeSlug, schedule.data.routeId);
  redirect(`/admin/rutas/${schedule.data.routeId}/salidas?notice=${encodeURIComponent("Salida guardada con exito.")}`);
}

export async function updateScheduleAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const user = await getCurrentAdminOrRedirect();

  const id = value(formData, "id");
  if (!id) {
    return errorState("Falta la salida a editar. Volve a abrirla desde el listado.");
  }

  const current = await prisma.schedule.findUnique({
    where: { id },
    select: {
      route: {
        select: {
          id: true,
          slug: true
        }
      }
    }
  });
  let schedule: Awaited<ReturnType<typeof scheduleData>>;
  try {
    schedule = await scheduleData(formData);
    const warning = await saveSchedule(schedule.data, formData, user, id);
    if (warning) return warning;
  } catch (error) {
    return scheduleErrorState(error);
  }

  revalidateSchedulePaths(schedule.routeSlug, schedule.data.routeId);
  revalidateSchedulePaths(current?.route.slug, current?.route.id);
  const detailPath = `/admin/rutas/${schedule.data.routeId}/salidas/${id}`;
  revalidatePath(detailPath);
  revalidatePath(`${detailPath}/editar`);
  if (current && current.route.id !== schedule.data.routeId) {
    const oldDetailPath = `/admin/rutas/${current.route.id}/salidas/${id}`;
    revalidatePath(oldDetailPath);
    revalidatePath(`${oldDetailPath}/editar`);
  }
  redirect(`${detailPath}?notice=${encodeURIComponent("Salida guardada con éxito.")}`);
}

export async function setScheduleStatusAction(formData: FormData) {
  const user = await getCurrentAdminOrRedirect();
  const id = value(formData, "id");
  const status = value(formData, "status");

  if (!scheduleStatuses.has(status)) throw new Error("Estado de salida inválido.");

  const current = await prisma.schedule.findUniqueOrThrow({ where: { id }, include: { route: { select: { slug: true } } } });
  const { routeId, vehicleId, departureAt, arrivalAt } = current;
  const data = { routeId, vehicleId, departureAt, arrivalAt, status };
  const result = await saveAudited(user, "Estado de la salida cambiado.", data, "", id, true);
  if (result.conflicts) {
    const notice = "La nave ya tiene un viaje especial. Revisá el estado y confirmá desde el formulario.";
    redirect(`/admin/rutas/${routeId}/salidas/${id}/editar?status=${status}&notice=${encodeURIComponent(notice)}`);
  }
  revalidateSchedulePaths(current.route.slug, routeId);
  redirect(`/admin/rutas/${routeId}/salidas?notice=${encodeURIComponent("Salida actualizada con exito.")}`);
}

export async function deleteScheduleAction(formData: FormData) {
  const actor = await getCurrentAdminOrRedirect();

  const id = value(formData, "id");
  const schedule = await prisma.schedule.findUnique({
    where: { id },
    select: {
      route: {
        select: {
          id: true,
          slug: true
        }
      }
    }
  });

  if (!schedule) {
    return;
  }

  const reservations = await prisma.reservation.count({ where: { scheduleId: id } });

  let notice = "Salida borrada con exito.";
  await prisma.$transaction(async (tx) => {
    const before = await tx.schedule.findUnique({ where: { id } });
    if (reservations > 0) {
      const closed = await tx.schedule.update({ where: { id }, data: { status: "CLOSED" } });
      await recordScheduleAudit(tx, actor, "Salida cerrada porque ya tenía reservas.", before, closed);
    } else {
      // La etiqueta se arma antes de borrar: después la salida ya no existe para nombrarla.
      await recordScheduleAudit(tx, actor, "Salida borrada.", before, null);
      await tx.schedule.delete({ where: { id } });
    }
  });
  if (reservations > 0) notice = "Salida cerrada con exito porque ya tenia reservas.";

  revalidateSchedulePaths(schedule.route.slug, schedule.route.id);
  redirect(`/admin/rutas/${schedule.route.id}/salidas?notice=${encodeURIComponent(notice)}`);
}

/**
 * Reasignar la nave de una salida desde el calendario de la ruta (issue #81), sin abrir el formulario
 * completo: no toca fecha, hora, estado ni reservas, sólo el vehículo. Antes de guardar revisa que la
 * nave no esté tomada en ese horario —otra salida, viaje especial, Chapelco o aeropuerto— y, si lo
 * está, no cambia nada y vuelve al calendario con el aviso. La salida que se edita queda excluida del
 * chequeo para no chocar consigo misma.
 */
export async function setScheduleVehicleAction(formData: FormData) {
  const actor = await getCurrentAdminOrRedirect();

  const id = value(formData, "id");
  const vehicleId = value(formData, "vehicleId");
  const current = id
    ? await prisma.schedule.findUnique({
      where: { id },
      select: {
        id: true,
        routeId: true,
        vehicleId: true,
        departureAt: true,
        arrivalAt: true,
        route: { select: { slug: true } }
      }
    })
    : null;

  if (!current) {
    redirect(`/admin/rutas?notice=${encodeURIComponent("La salida que querés cambiar ya no existe.")}`);
  }

  const calendarPath = `/admin/rutas/${current.routeId}/salidas?month=${argentinaDateKey(current.departureAt).slice(0, 7)}`;
  const backToCalendar = (notice: string): never => redirect(`${calendarPath}&notice=${encodeURIComponent(notice)}`);

  if (!vehicleId) {
    backToCalendar("Elegí la nave a la que pasa la salida.");
  }

  if (vehicleId === current.vehicleId) {
    backToCalendar("La salida ya tiene esa nave.");
  }

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { isActive: true } });
  if (!vehicle || !vehicle.isActive) {
    backToCalendar("Esa nave no está disponible: elegí una unidad activa.");
  }

  const result = await prisma.$transaction(async (tx) => {
    // Mismo orden de locks que el resto de las escrituras de flota: nadie puede tomar esa nave en
    // paralelo mientras se comprueba el horario.
    await lockFleet(tx, [vehicleId]);
    const conflicts = await fleetConflicts(
      tx,
      { vehicleId, startsAt: current.departureAt, endsAt: current.arrivalAt },
      undefined,
      current.id
    );
    if (conflicts.length) {
      return { conflicts };
    }

    const problem = await primaryVehicleProblem(tx, current.id, vehicleId);
    if (problem) return { conflicts: [], problem };

    const before = await tx.schedule.findUnique({ where: { id: current.id } });
    const updated = await tx.schedule.update({ where: { id: current.id }, data: { vehicleId } });
    await recordScheduleAudit(tx, actor, "Nave de la salida cambiada.", before, updated);
    return { conflicts: [] };
  });

  if ("problem" in result && result.problem) {
    backToCalendar(result.problem);
  }

  if (result.conflicts.length) {
    backToCalendar(vehicleConflictNotice(result.conflicts));
  }

  revalidateSchedulePaths(current.route.slug, current.routeId);
  revalidatePath(`/admin/rutas/${current.routeId}/salidas/${current.id}`);
  backToCalendar("Nave de la salida actualizada.");
}

// ── Varias naves por salida: sumar y quitar desde la ficha de la salida ──────────────────────────

function revalidateUnitPaths(schedule: { id: string; routeId: string; slug: string | null }) {
  revalidateSchedulePaths(schedule.slug ?? undefined, schedule.routeId);
  revalidatePath(`/admin/rutas/${schedule.routeId}/salidas/${schedule.id}`);
  revalidatePath("/admin/salidas-del-dia");
}

/** Sumar otra nave (con su chofer) a la salida. Los choques se avisan como al elegir la principal. */
export async function addScheduleUnitAction(
  _state: { error?: string; conflicts?: FleetConflict[]; confirmation?: string },
  formData: FormData
): Promise<{ error?: string; conflicts?: FleetConflict[]; confirmation?: string }> {
  const actor = await getCurrentAdminOrRedirect();
  const vehicleId = value(formData, "vehicleId");
  if (!vehicleId) return { error: "Elegí la nave." };
  const result = await addScheduleUnit({
    actor, scheduleId: value(formData, "scheduleId"), vehicleId,
    driverId: value(formData, "driverId") || null, confirmation: value(formData, "confirmation")
  });
  if (!result.ok) return result;
  revalidateUnitPaths(result.schedule);
  redirect(`/admin/rutas/${result.schedule.routeId}/salidas/${result.schedule.id}?notice=${encodeURIComponent(result.summary)}`);
}

/** Quitar una nave de la salida: una de las sumadas (`unitId`) o la principal (`primaryOf`). */
export async function removeScheduleUnitAction(formData: FormData) {
  const actor = await getCurrentAdminOrRedirect();
  const unitId = value(formData, "unitId") || undefined;
  const primaryOf = value(formData, "primaryOf") || undefined;
  const back = value(formData, "back");
  const result = await removeScheduleUnit({ actor, unitId, primaryOf });
  const message = result.ok ? result.summary : "error" in result ? result.error : "No se pudo quitar la nave.";
  if (result.ok) revalidateUnitPaths(result.schedule);
  redirect(`${back.startsWith("/admin/") ? back : "/admin/rutas"}?notice=${encodeURIComponent(message)}`);
}

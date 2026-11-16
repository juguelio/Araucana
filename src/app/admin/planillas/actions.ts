"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import {
  DepartureSheetError,
  ensureDepartureSheet,
  removeDepartureSheetPassenger,
  setDepartureSheetOpen
} from "@/lib/departure-sheets/repository";
import { isDepartureSheetKind } from "@/lib/departure-sheets/types";
import { readForAudit, recordEntityAuditAfterCommit } from "@/lib/audit/entity";
import { prisma } from "@/lib/db/prisma";

/** "DUT · Cliente": la planilla se reconoce por su tipo y el viaje al que pertenece. */
async function sheetLabel(where: { id: string } | { specialTripId_kind: { specialTripId: string; kind: string } }) {
  const sheet = await readForAudit(() => prisma.departureSheet.findUnique({ where, select: { id: true, kind: true, isOpen: true, specialTrip: { select: { client: true } } } }));
  return sheet ? { ...sheet, label: `${sheet.kind} · ${sheet.specialTrip.client}` } : null;
}

const viajes = "/admin/viajes-especiales";

function value(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

/**
 * Genera (o recupera) el link de la planilla de ese viaje especial. No hay alta de planillas
 * sueltas: la planilla es del viaje y el link se manda desde ahí a los pasajeros.
 */
export async function ensureDepartureSheetAction(form: FormData) {
  const user = await getCurrentReservationsUserOrRedirect();
  const tripId = value(form, "tripId");
  const kind = value(form, "kind");

  if (!tripId || !isDepartureSheetKind(kind)) {
    redirect(viajes);
  }

  let notice = "Link de la planilla listo para enviar a los pasajeros.";
  try {
    const existed = await sheetLabel({ specialTripId_kind: { specialTripId: tripId, kind } });
    await ensureDepartureSheet(tripId, kind, user.id);
    const sheet = existed ? null : await sheetLabel({ specialTripId_kind: { specialTripId: tripId, kind } });
    // Pedir el link de una planilla que ya existe no cambia nada: sólo se registra cuando se crea.
    if (sheet) {
      await recordEntityAuditAfterCommit(prisma, {
        actor: user, entity: "DEPARTURE_SHEET", entityId: sheet.id, entityLabel: sheet.label,
        summary: "Planilla de salida creada.", after: { kind: sheet.kind, isOpen: sheet.isOpen }
      });
    }
  } catch (error) {
    if (!(error instanceof DepartureSheetError)) {
      throw error;
    }
    notice = error.message;
  }

  revalidatePath(`${viajes}/${tripId}`);
  redirect(`${viajes}/${tripId}?planilla=${encodeURIComponent(notice)}#planillas`);
}

export async function setDepartureSheetOpenAction(form: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();

  const id = value(form, "id");
  const tripId = value(form, "tripId");
  if (!id || !tripId) {
    redirect(viajes);
  }

  const sheet = await sheetLabel({ id });
  const isOpen = value(form, "isOpen") === "1";
  await setDepartureSheetOpen(id, isOpen);
  await recordEntityAuditAfterCommit(prisma, {
    actor, entity: "DEPARTURE_SHEET", entityId: id, entityLabel: sheet?.label,
    summary: isOpen ? "Planilla reabierta para carga de pasajeros." : "Planilla cerrada.",
    before: { isOpen: sheet?.isOpen ?? null }, after: { isOpen }
  });
  revalidatePath(`${viajes}/${tripId}`);
  revalidatePath(`/admin/planillas/${id}`);
  redirect(`${viajes}/${tripId}#planillas`);
}

export async function removeDepartureSheetPassengerAction(form: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();

  const passengerId = value(form, "passengerId");
  const sheetId = value(form, "sheetId");
  if (!passengerId || !sheetId) {
    redirect(viajes);
  }

  const removed = await readForAudit(() => prisma.departureSheetPassenger.findUnique({
    where: { id: passengerId }, select: { firstName: true, lastName: true, documentType: true, documentNumber: true, nationality: true }
  }));
  const sheet = await sheetLabel({ id: sheetId });
  await removeDepartureSheetPassenger(passengerId);
  if (removed) {
    await recordEntityAuditAfterCommit(prisma, {
      actor, entity: "DEPARTURE_SHEET", entityId: sheetId, entityLabel: sheet?.label,
      summary: `Pasajero quitado de la planilla: ${removed.firstName} ${removed.lastName}.`, before: removed
    });
  }
  revalidatePath(`/admin/planillas/${sheetId}`);
  redirect(`/admin/planillas/${sheetId}`);
}

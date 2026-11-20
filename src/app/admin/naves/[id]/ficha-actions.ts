"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { diffRecords } from "@/lib/audit/diff";
import { parseAccountingEntryInput } from "@/lib/accounting/service";
import { ESTADO_DANIO_LABEL, GRAVEDAD_LABEL, esEstadoDeDanio, leerDanio } from "@/lib/vehicles/ficha";
import { leerPlanillaDeService, resumenDePlanilla } from "@/lib/vehicles/service-sheet";
import { errorState, type AdminFormState } from "../../form-state";
import { revalidarNaves } from "../revalidate";

/**
 * Acciones de la ficha de una nave: anotar daños, cambiarles el estado y registrar arreglos.
 * Todo queda en la auditoría de la nave (entidad VEHICLE) para verse junto al resto de sus cambios;
 * el arreglo además es un egreso de contabilidad, con su propia fila de auditoría.
 */

function value(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function volver(vehicleId: string, seccion: "danios" | "reparaciones" | "service", notice: string): never {
  revalidarNaves();
  revalidatePath("/admin/contabilidad");
  redirect(`/admin/naves/${vehicleId}/${seccion}?notice=${encodeURIComponent(notice)}`);
}

export async function createDamageAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await getCurrentAdminOrRedirect();
  const vehicleId = value(formData, "vehicleId");
  const leido = leerDanio({
    occurredAt: value(formData, "occurredAt"),
    description: value(formData, "description"),
    severity: value(formData, "severity"),
    reportedBy: value(formData, "reportedBy"),
    notes: value(formData, "notes")
  });
  if (!leido.ok) return errorState("Revisá los datos del daño.", leido.errores);

  try {
    await prisma.$transaction(async (tx) => {
      const nave = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, name: true } });
      if (!nave) throw new Error("La nave ya no existe.");
      const danio = await tx.vehicleDamage.create({ data: { vehicleId, ...leido.data } });
      await recordAudit(tx, {
        actor,
        action: "UPDATE",
        entity: "VEHICLE",
        entityId: vehicleId,
        entityLabel: nave.name,
        summary: `Daño anotado (${GRAVEDAD_LABEL[danio.severity as keyof typeof GRAVEDAD_LABEL] ?? danio.severity}): ${danio.description}`,
        changes: diffRecords(null, {
          "danio.occurredAt": danio.occurredAt,
          "danio.description": danio.description,
          "danio.severity": danio.severity,
          "danio.reportedBy": danio.reportedBy,
          "danio.notes": danio.notes
        })
      });
    });
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "No pudimos guardar el daño.");
  }

  volver(vehicleId, "danios", "Daño anotado.");
}

export async function setDamageStatusAction(formData: FormData) {
  const actor = await getCurrentAdminOrRedirect();
  const damageId = value(formData, "damageId");
  const status = value(formData, "status");
  if (!esEstadoDeDanio(status)) throw new Error("Estado de daño inválido.");

  const vehicleId = await prisma.$transaction(async (tx) => {
    const antes = await tx.vehicleDamage.findUnique({ where: { id: damageId }, include: { vehicle: { select: { name: true } } } });
    if (!antes) throw new Error("El daño ya no existe.");
    if (antes.status === status) return antes.vehicleId;
    const repairedAt = status === "REPARADO" ? antes.repairedAt ?? new Date() : null;
    // Reabrir (o volver a «en reparación») suelta el arreglo: ese gasto ya no lo da por reparado.
    const repairEntryId = status === "REPARADO" ? antes.repairEntryId : null;
    await tx.vehicleDamage.update({ where: { id: damageId }, data: { status, repairedAt, repairEntryId } });
    await recordAudit(tx, {
      actor,
      action: "UPDATE",
      entity: "VEHICLE",
      entityId: antes.vehicleId,
      entityLabel: antes.vehicle.name,
      summary: `Daño «${antes.description}»: ${ESTADO_DANIO_LABEL[status]}.`,
      changes: diffRecords({ "danio.status": antes.status, "danio.repairedAt": antes.repairedAt }, { "danio.status": status, "danio.repairedAt": repairedAt })
    });
    return antes.vehicleId;
  });

  volver(vehicleId, "danios", `Daño marcado como ${ESTADO_DANIO_LABEL[status].toLowerCase()}.`);
}

/**
 * Registra un arreglo de la nave: un egreso de contabilidad en la categoría «Arreglo» con la nave
 * puesta. Si se elige un daño, ese daño queda reparado y enlazado al arreglo.
 */
export async function createRepairAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await getCurrentAdminOrRedirect();
  const vehicleId = value(formData, "vehicleId");
  const damageId = value(formData, "damageId") || null;

  try {
    const input = parseAccountingEntryInput({
      category: "REPAIR",
      amount: value(formData, "amount"),
      occurredAt: value(formData, "occurredAt"),
      vehicleId,
      notes: value(formData, "notes")
    });

    await prisma.$transaction(async (tx) => {
      const nave = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { name: true } });
      if (!nave) throw new Error("La nave ya no existe.");
      const danio = damageId ? await tx.vehicleDamage.findFirst({ where: { id: damageId, vehicleId } }) : null;
      if (damageId && !danio) throw new Error("El daño elegido no es de esta nave.");

      const entry = await tx.accountingEntry.create({ data: input });
      await recordAudit(tx, {
        actor,
        action: "CREATE",
        entity: "ACCOUNTING_ENTRY",
        entityId: entry.id,
        entityLabel: "Arreglo",
        summary: "Egreso registrado.",
        changes: diffRecords(null, {
          category: entry.category,
          amountCents: entry.amountCents,
          currency: entry.currency,
          occurredAt: entry.occurredAt,
          vehicleId: entry.vehicleId,
          notes: entry.notes
        })
      });

      if (danio) {
        await tx.vehicleDamage.update({
          where: { id: danio.id },
          // El egreso guarda el día a medianoche UTC; el daño, al mediodía de Argentina (15:00 UTC).
          data: { status: "REPARADO", repairedAt: danio.repairedAt ?? new Date(entry.occurredAt.getTime() + 15 * 3600 * 1000), repairEntryId: entry.id }
        });
      }
      await recordAudit(tx, {
        actor,
        action: "UPDATE",
        entity: "VEHICLE",
        entityId: vehicleId,
        entityLabel: nave.name,
        summary: danio ? `Arreglo registrado; daño «${danio.description}» reparado.` : "Arreglo registrado.",
        changes: danio
          ? diffRecords({ "danio.status": danio.status }, { "danio.status": "REPARADO" })
          : null
      });
    });
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "No pudimos guardar el arreglo.");
  }

  volver(vehicleId, "reparaciones", "Arreglo registrado.");
}

/**
 * Guarda la planilla de service de la nave: fecha, kilometraje, qué se revisó (ítem por ítem) y qué se
 * le hizo. Queda en la auditoría de la nave como el resto de sus cambios, para que se pueda reconstruir
 * el historial del taller sin abrir la libreta de papel.
 */
export async function createServiceSheetAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await getCurrentAdminOrRedirect();
  const vehicleId = value(formData, "vehicleId");
  const checks: Record<string, string> = {};
  for (const [clave, valor] of formData.entries()) {
    if (clave.startsWith("check:") && typeof valor === "string" && valor) checks[clave.slice("check:".length)] = valor;
  }

  const leido = leerPlanillaDeService({
    servicedAt: value(formData, "servicedAt"),
    odometerKm: value(formData, "odometerKm"),
    workDone: value(formData, "workDone"),
    notes: value(formData, "notes"),
    checks
  });
  if (!leido.ok) return errorState("Revisá la planilla de service.", leido.errores);

  const resumen = resumenDePlanilla(leido.data.checks);

  try {
    await prisma.$transaction(async (tx) => {
      const nave = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, name: true, internalNumber: true } });
      if (!nave) throw new Error("La nave ya no existe.");
      const planilla = await tx.vehicleServiceSheet.create({
        data: { vehicleId, ...leido.data, reportedBy: actor.name?.trim() || null }
      });
      await recordAudit(tx, {
        actor,
        action: "UPDATE",
        entity: "VEHICLE",
        entityId: vehicleId,
        entityLabel: nave.name,
        summary: `Planilla de service (${leido.data.odometerKm.toLocaleString("es-AR")} km): ${resumen.fallas} falla${resumen.fallas === 1 ? "" : "s"} en ${resumen.revisados} ítems revisados`,
        changes: diffRecords(null, {
          "service.servicedAt": planilla.servicedAt,
          "service.odometerKm": planilla.odometerKm,
          "service.workDone": planilla.workDone,
          "service.fallas": resumen.fallas
        })
      });
    });
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "No pudimos guardar la planilla.");
  }

  volver(vehicleId, "service", "Planilla de service guardada.");
}

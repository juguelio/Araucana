"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { recordEntityAudit } from "@/lib/audit/entity";
import { prisma } from "@/lib/db/prisma";
import { dateOnly } from "@/lib/special-trips/data";
import { normalizarTipoDeConcesion } from "@/lib/school-runs/kinds";

export async function assignSchoolRunResources(form: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const id = field("id");
  const vehicleId = field("vehicleId");
  const driverId = field("driverId") || null;
  const revision = field("revision");
  const fecha = field("fecha");
  const returnTo = field("returnTo");
  const back = (notice: string): never => {
    const safe = returnTo.startsWith("/admin/escolares") ? returnTo : `/admin/escolares?fecha=${fecha}`;
    return redirect(`${safe}${safe.includes("?") ? "&" : "?"}aviso=${encodeURIComponent(notice)}`);
  };
  if (!id || !vehicleId) back("Elegí una nave para asignar.");
  const [nave, chofer] = await Promise.all([
    prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { isActive: true, name: true } }),
    driverId
      ? prisma.user.findUnique({ where: { id: driverId }, select: { isActive: true, role: true, name: true, email: true } })
      : Promise.resolve(null)
  ]);
  if (!nave?.isActive) back("Esa nave no está disponible: elegí una unidad activa.");
  if (driverId && !(chofer?.isActive && chofer.role === "DRIVER")) back("Ese chofer no está disponible: elegí un chofer activo.");
  const message = await prisma.$transaction(async (tx) => {
    const previous = await tx.schoolRun.findUnique({ where: { id } });
    if (!previous) return "El servicio ya no existe.";
    if (revision && String(previous.revision) !== revision) return "El servicio cambió. Volvé a abrirlo antes de asignar.";
    const after = await tx.schoolRun.update({
      where: { id },
      data: { vehicleId, driverId, revision: { increment: 1 } }
    });
    await recordEntityAudit(tx, {
      actor, entity: "SCHOOL_RUN", entityId: id, entityLabel: previous.routeName,
      summary: "Nave y chofer asignados desde Concesiones.",
      before: { vehicleId: previous.vehicleId, driverId: previous.driverId },
      after: { vehicleId: after.vehicleId, driverId: after.driverId }
    });
    return null;
  });
  if (message) back(message);
  revalidatePath("/admin/escolares");
  revalidatePath("/admin/escolares/semana");
  revalidatePath(`/admin/escolares/${id}`);
  return back(`Nave ${nave?.name ?? "asignada"}${chofer ? ` y chofer ${chofer.name ?? chofer.email}` : ""} guardados.`);
}

export async function saveSchoolRun(form: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const id = field("id");
  const revision = field("revision");
  const date = field("date");
  const serviceDate = dateOnly(date);
  const kind = normalizarTipoDeConcesion(field("kind"));
  const routeName = field("routeName");
  const shift = field("shift");
  const driverId = field("driverId") || null;
  const vehicleId = field("vehicleId") || null;
  const companion = field("companion") || null;
  const notes = field("notes") || null;
  const review = field("review") || null;
  const detail = "/admin/escolares/" + encodeURIComponent(id);
  const back = (notice: string) => redirect((revision ? detail + "/editar" : "/admin/escolares/nuevo") + "?" + new URLSearchParams({ fecha: date, aviso: notice }));
  if (!serviceDate || !routeName || !shift || !id || routeName.length > 400 || shift.length > 100 ||
      (companion?.length ?? 0) > 200 || (notes?.length ?? 0) > 2000 || (review?.length ?? 0) > 2000) {
    return back("Revisá la fecha, el recorrido, el turno y la extensión de los campos.");
  }
  const data = { kind, routeName, serviceDate, shift, driverId, vehicleId, companion, notes, review };
  const message = await prisma.$transaction(async (tx) => {
    const previous = await tx.schoolRun.findUnique({ where: { id } });
    if (revision === "" ? previous !== null : !previous || String(previous.revision) !== revision) {
      return "El registro cambió. Revisá la versión guardada.";
    }
    if (driverId && driverId !== previous?.driverId && !await tx.user.findFirst({ where: { id: driverId, role: "DRIVER", isActive: true } })) {
      return "Elegí un chofer activo.";
    }
    if (vehicleId && vehicleId !== previous?.vehicleId && !await tx.vehicle.findFirst({ where: { id: vehicleId, isActive: true } })) {
      return "Elegí una nave activa.";
    }
    if (previous) {
      const update = await tx.schoolRun.updateMany({ where: { id, revision: previous.revision }, data: { ...data, revision: { increment: 1 } } });
      if (!update.count) return "Otra persona editó el recorrido. Revisá la versión guardada.";
    } else {
      if (!/^[\da-f-]{36}$/i.test(id)) return "Volvé a abrir el formulario de alta.";
      const created = await tx.schoolRun.createMany({ data: [{ id, ...data }], skipDuplicates: true });
      if (!created.count) return "El recorrido ya estaba guardado.";
    }
    await recordEntityAudit(tx, {
      actor, entity: "SCHOOL_RUN", entityId: id, entityLabel: routeName,
      summary: "Servicio de concesión guardado para el " + date,
      before: previous ? Object.fromEntries(Object.keys(data).map(key => [key, previous[key as keyof typeof data]])) : null,
      after: data
    });
    return "Servicio de concesión guardado.";
  });
  revalidatePath("/admin/escolares");
  revalidatePath(detail);
  if (message !== "Servicio de concesión guardado.") return back(message);
  redirect(detail + "?" + new URLSearchParams({ aviso: message }));
}

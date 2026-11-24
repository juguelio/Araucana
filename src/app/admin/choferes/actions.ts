"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordEntityAudit } from "@/lib/audit/entity";
import { formatAuditDate } from "@/lib/audit/labels";
import { recordScheduleAudit } from "@/lib/audit/schedule";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { cargarServiciosDelDia } from "@/lib/driver/cargar-servicios-del-dia";
import { serviciosDeLaNave, type ServicioDelDia } from "@/lib/driver/tablero-choferes";
import { isDateKey } from "@/lib/operations/day-board";
import { conflictKey, driverConflicts, lockFleet, recordAcceptance, type FleetConflict } from "@/lib/special-trips/conflicts";

export type AsignarChoferState = { error?: string; conflicts?: FleetConflict[]; confirmation?: string };

const SERVICIO_DE_ACEPTACION: Record<string, string> = { salida: "PUBLIC", unidad: "PUBLIC", vuelo: "AIRPORT", viaje: "SPECIAL" };

function texto(formData: FormData, clave: string) {
  const valor = formData.get(clave);
  return typeof valor === "string" ? valor.trim() : "";
}

/** `salida:abc` → `["salida", "abc"]`. */
function partes(clave: string): [string, string] {
  const corte = clave.indexOf(":");
  return [clave.slice(0, corte), clave.slice(corte + 1)];
}

/**
 * Tablero de Choferes (24-nov): «este chofer maneja esta nave hoy». Pone al chofer en los servicios
 * tildados de esa nave ese día —salidas (la nave principal o una sumada), combis de aeropuerto y naves de
 * viajes especiales— en una sola transacción. Chapelco no: tiene su propio tablero.
 *
 * Antes de guardar se mira la agenda del chofer (`driverConflicts`), sin contar los servicios que se le
 * están dando: otra salida o un viaje especial a la misma hora no se guarda; un posible cruce con
 * aeropuerto o Chapelco se muestra y se guarda si se confirma, igual que en el resto del sistema.
 */
export async function asignarChoferANaveAction(_estado: AsignarChoferState, formData: FormData): Promise<AsignarChoferState> {
  const actor = await getCurrentAdminOrRedirect();
  const driverId = texto(formData, "driverId");
  const vehicleId = texto(formData, "vehicleId");
  const dia = texto(formData, "dia");
  const tildados = [...new Set(formData.getAll("servicio").filter((valor): valor is string => typeof valor === "string"))];
  if (!isDateKey(dia)) return { error: "No se reconoció el día." };
  if (!vehicleId) return { error: "Elegí la nave." };
  if (!tildados.length) return { error: "Tildá al menos un servicio de la nave." };

  const chofer = await prisma.user.findFirst({ where: { id: driverId, role: "DRIVER", isActive: true }, select: { id: true, name: true, email: true } });
  if (!chofer) return { error: "Ese chofer no está disponible: tiene que ser un chofer activo." };
  const nombre = chofer.name ?? chofer.email;

  const deLaNave = serviciosDeLaNave(vehicleId, await cargarServiciosDelDia(dia));
  const elegidos = deLaNave.filter((servicio) => tildados.includes(servicio.clave));
  if (elegidos.length !== tildados.length) return { error: "Algún servicio cambió mientras elegías. Cerrá y volvé a abrir la nave." };
  if (elegidos.some((servicio) => !servicio.asignableDesdeChoferes)) return { error: "El chofer de Chapelco se asigna desde el tablero de Chapelco." };
  const cambian = elegidos.filter((servicio) => servicio.driverId !== chofer.id);
  if (!cambian.length) return { error: `Esos servicios ya eran de ${nombre}.` };

  const resultado = await prisma.$transaction(async (tx) => {
    await lockFleet(tx, [vehicleId]);
    // Lo que se le está dando no choca consigo mismo: los ids de los conflictos son `chofer:<id>`.
    const propios = new Set(elegidos.map((servicio) => `chofer:${partes(servicio.clave)[1]}`));
    const encontrados = (await Promise.all(cambian.map((servicio) => driverConflicts(tx, { driverId: chofer.id, startsAt: servicio.desde, endsAt: servicio.hasta })))).flat();
    const conflictos = [...new Map(encontrados.filter((conflicto) => !propios.has(conflicto.id)).map((conflicto) => [conflicto.id, conflicto])).values()];
    const seguros = conflictos.filter((conflicto) => !conflicto.possible);
    if (seguros.length) {
      return { error: `${nombre} ya maneja a esa hora: ${seguros.map((conflicto) => conflicto.label.replace(/^Chofer · /, "")).join(" · ")}. Destildá ese servicio o sacáselo primero.` };
    }
    const confirmacion = conflictKey(conflictos, [chofer.id, vehicleId, cambian.map((servicio) => servicio.clave).sort()]);
    if (conflictos.length && texto(formData, "confirmation") !== confirmacion) return { conflicts: conflictos, confirmation: confirmacion };

    for (const servicio of cambian) {
      const guardado = await asignar(tx, servicio, chofer.id, vehicleId, actor);
      if (!guardado) return { error: "Algún servicio cambió mientras elegías. Cerrá y volvé a abrir la nave." };
      const [tipo, id] = partes(servicio.clave);
      await recordAcceptance(tx, SERVICIO_DE_ACEPTACION[tipo], guardado.serviceId ?? id, actor.id, conflictos);
    }
    return { listo: cambian.length };
  });
  if (!("listo" in resultado)) return resultado;

  for (const ruta of ["/admin/choferes", "/admin/salidas-del-dia", "/admin/servicio-publico", "/admin/aeropuerto", "/admin/viajes-especiales", "/admin/naves/en-vivo"]) {
    revalidatePath(ruta);
  }
  const aviso = `${nombre} quedó en ${resultado.listo} ${resultado.listo === 1 ? "servicio" : "servicios"} de la nave.`;
  redirect(`/admin/choferes?${new URLSearchParams({ dia, notice: aviso })}`);
}

type Actor = Awaited<ReturnType<typeof getCurrentAdminOrRedirect>>;
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Pone el chofer en un servicio, sólo si sigue siendo de esa nave, y deja la auditoría donde la deja
 * cada módulo. Devuelve `null` si el servicio cambió de nave o desapareció.
 */
async function asignar(tx: Tx, servicio: ServicioDelDia, driverId: string, vehicleId: string, actor: Actor): Promise<{ serviceId?: string } | null> {
  const [tipo, id] = partes(servicio.clave);
  const resumen = "Chofer asignado desde el tablero de Choferes.";

  if (tipo === "salida") {
    const antes = await tx.schedule.findFirst({ where: { id, vehicleId } });
    if (!antes) return null;
    const despues = await tx.schedule.update({ where: { id }, data: { driverId } });
    await recordScheduleAudit(tx, actor, resumen, antes, despues);
    return {};
  }

  if (tipo === "unidad") {
    const unidad = await tx.scheduleUnit.findFirst({ where: { id, vehicleId }, select: { scheduleId: true } });
    if (!unidad) return null;
    const salida = await tx.schedule.findUnique({ where: { id: unidad.scheduleId }, include: { extraUnits: { select: { id: true, vehicleId: true, driverId: true }, orderBy: { id: "asc" } } } });
    if (!salida) return null;
    await tx.scheduleUnit.update({ where: { id }, data: { driverId } });
    const unidades = (cambio: boolean) => salida.extraUnits.map((otra) => ({ vehicleId: otra.vehicleId, driverId: cambio && otra.id === id ? driverId : otra.driverId }));
    await recordScheduleAudit(tx, actor, resumen, { ...salida, extraUnits: unidades(false) }, { ...salida, extraUnits: unidades(true) });
    return { serviceId: salida.id };
  }

  if (tipo === "vuelo") {
    const asignacion = await tx.airportVehicleAssignment.findFirst({
      where: { id, vehicleId },
      select: { flightId: true, driver: { select: { name: true, email: true } }, vehicle: { select: { name: true } }, flight: { select: { number: true, scheduledAt: true } } }
    });
    if (!asignacion) return null;
    const nuevo = await tx.airportVehicleAssignment.update({ where: { id }, data: { driverId }, select: { driver: { select: { name: true, email: true } } } });
    await recordEntityAudit(tx, {
      actor, entity: "AIRPORT", entityId: asignacion.flightId, action: "UPDATE",
      entityLabel: `${asignacion.flight.number} · ${formatAuditDate(asignacion.flight.scheduledAt)}`,
      summary: `Chofer de la combi ${asignacion.vehicle.name} asignado desde el tablero de Choferes.`,
      before: { driver: persona(asignacion.driver) },
      after: { driver: persona(nuevo.driver) }
    });
    return { serviceId: asignacion.flightId };
  }

  if (tipo === "viaje") {
    const asignacion = await tx.specialTripAssignment.findFirst({
      where: { id, vehicleId },
      select: { tripId: true, driver: { select: { name: true, email: true } }, vehicle: { select: { name: true } }, trip: { select: { client: true } } }
    });
    if (!asignacion) return null;
    const nuevo = await tx.specialTripAssignment.update({ where: { id }, data: { driverId }, select: { driver: { select: { name: true, email: true } } } });
    await recordEntityAudit(tx, {
      actor, entity: "SPECIAL_TRIP", entityId: asignacion.tripId, action: "UPDATE",
      entityLabel: asignacion.trip.client,
      summary: `Chofer de la nave ${asignacion.vehicle.name} asignado desde el tablero de Choferes.`,
      before: { driver: persona(asignacion.driver) },
      after: { driver: persona(nuevo.driver) }
    });
    return { serviceId: asignacion.tripId };
  }

  return null;
}

function persona(usuario: { name: string | null; email: string } | null) {
  return usuario ? usuario.name ?? usuario.email : null;
}

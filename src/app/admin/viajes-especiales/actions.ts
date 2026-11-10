"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import {
  argentina, assignmentSchema, billingModes, dateOnly, legSchema, localDateTime, parseMoney, paymentSchema, statuses
} from "@/lib/special-trips/data";
import { conflictKey, fleetConflicts, lockFleet, recordAcceptance, type FleetConflict } from "@/lib/special-trips/conflicts";

export type TripFormResult = { error?: string; conflicts?: FleetConflict[]; confirmation?: string };

class TripError extends Error {}

export async function saveTrip(id: string | null, version: string | null, _state: TripFormResult, form: FormData): Promise<TripFormResult> {
  const user = await getCurrentReservationsUserOrRedirect();
  const value = (name: string) => String(form.get(name) ?? "").trim();
  let tripId: string;
  try {
    const client = value("client");
    const serviceDate = dateOnly(value("serviceDate"));
    const status = value("status");
    const billingMode = value("billingMode");
    const currency = value("currency");
    const invoiceDate = dateOnly(value("invoiceDate"));
    const passengers = value("passengers") ? Number(value("passengers")) : null;
    if (!client || client.length > 500 || !serviceDate || !Object.hasOwn(statuses, status)) throw new TripError("Revisá el cliente, la fecha y el estado.");
    if (passengers !== null && (!Number.isInteger(passengers) || passengers < 1 || passengers > 100000)) throw new TripError("Ingresá una cantidad válida de pasajeros.");
    if (!Object.hasOwn(billingModes, billingMode) || !["ARS", "USD"].includes(currency)) throw new TripError("Revisá las condiciones de cobro.");
    if (value("invoiceDate") && !invoiceDate) throw new TripError("Revisá la fecha de factura.");
    const totalCents = value("total") ? parseMoney(value("total")) : null;
    if ((value("total") || billingMode === "FIXED") && totalCents === null) throw new TripError("Ingresá un importe válido sin separador de miles.");
    if (["UNKNOWN", "INCLUDED"].includes(billingMode) && totalCents !== null) throw new TripError("Dejá el total vacío para esta condición de cobro.");

    const legs = z.array(legSchema).min(1).max(200).parse(JSON.parse(value("legs")));
    for (const leg of legs) {
      if ((!leg.origin || !leg.destination) && !leg.description.trim()) throw new TripError("Ingresá origen y destino o una descripción para cada tramo.");
      const departure = localDateTime(leg.departure, leg.zone);
      const arrival = localDateTime(leg.arrival, leg.arrivalZone ?? leg.zone);
      if ((leg.departure && !departure) || (leg.arrival && !arrival) || (departure && arrival && departure >= arrival)) {
        throw new TripError("Revisá los horarios de los tramos. Si el regreso es al día siguiente, indicá esa fecha.");
      }
    }
    const assignments = z.array(assignmentSchema).max(50).parse(JSON.parse(value("assignments"))).map((a) => {
      const startsAt = localDateTime(a.start, argentina);
      const endsAt = localDateTime(a.end, argentina);
      if (!startsAt || !endsAt || endsAt <= startsAt) throw new TripError("Cada ocupación necesita un inicio y un fin posterior.");
      return { vehicleId: a.vehicleId, driverId: a.driverId || null, startsAt, endsAt };
    });
    if (assignments.some((a, i) => assignments.slice(i + 1).some((b) =>
      a.vehicleId === b.vehicleId && a.startsAt < b.endsAt && a.endsAt > b.startsAt))) {
      throw new TripError("Unificá las ocupaciones superpuestas de una misma nave en este viaje.");
    }
    const payments = z.array(paymentSchema).max(100).parse(JSON.parse(value("payments")));
    if (payments.some((p) => (parseMoney(p.amount) ?? 0) <= 0 || (p.date && !dateOnly(p.date)))) throw new TripError("Revisá las fechas y los importes de los cobros.");

    const result = await prisma.$transaction(async (tx) => {
      const assignedVehicles = new Set<string>();
      const assignedDrivers = new Set<string>();
      if (id) {
        await tx.$queryRaw`SELECT id FROM "SpecialTrip" WHERE id = ${id} FOR UPDATE`;
        const current = await tx.specialTrip.findUnique({ where: { id }, include: { assignments: true } });
        if (!current || current.updatedAt.toISOString() !== version) throw new TripError("El viaje cambió. Volvé a abrirlo antes de guardar.");
        current.assignments.forEach((a) => {
          assignedVehicles.add(a.vehicleId);
          if (a.driverId) assignedDrivers.add(a.driverId);
        });
        await lockFleet(tx, [...current.assignments, ...assignments].map((a) => a.vehicleId));
      } else {
        await lockFleet(tx, assignments.map((a) => a.vehicleId));
      }
      const vehiclesToCheck = [...new Set(assignments.map((a) => a.vehicleId))].filter((vehicleId) => !assignedVehicles.has(vehicleId));
      const driversToCheck = [...new Set(assignments.flatMap((a) => a.driverId ?? []))].filter((driverId) => !assignedDrivers.has(driverId));
      const [vehicleCount, driverCount] = await Promise.all([
        tx.vehicle.count({ where: { id: { in: vehiclesToCheck }, isActive: true, kind: { not: "UTILITARIO" } } }),
        tx.user.count({ where: { id: { in: driversToCheck }, isActive: true, role: "DRIVER" } })
      ]);
      if (vehicleCount !== vehiclesToCheck.length || driverCount !== driversToCheck.length) throw new TripError("Elegí naves y choferes activos.");
      const conflicts = status === "CANCELLED" ? [] : (await Promise.all(assignments.map((a) => fleetConflicts(tx, a, id ?? undefined)))).flat();
      const unique = [...new Map(conflicts.map((c) => [c.href + c.id, c])).values()];
      const confirmation = conflictKey(unique, assignments);
      if (unique.length && value("confirmation") !== confirmation) return { conflicts: unique, confirmation };

      const data = {
        client, serviceDate, passengers, status, billingMode, currency, totalCents, legs, payments,
        destinationSearch: legs.map((leg) => leg.destination || leg.description).join("\n"),
        contact: value("contact").slice(0, 500) || null, notes: value("notes").slice(0, 12000) || null,
        supplier: value("supplier").slice(0, 500) || null, invoice: value("invoice").slice(0, 500) || null,
        invoiceDate, paymentStatus: value("paymentStatus").slice(0, 500) || null
      };
      const trip = id
        ? await tx.specialTrip.update({ where: { id }, data: { ...data, assignments: { deleteMany: {}, createMany: { data: assignments } } } })
        : await tx.specialTrip.create({ data: { ...data, assignments: { createMany: { data: assignments } } } });
      await recordAcceptance(tx, "SPECIAL", trip.id, user.id, unique);
      return { id: trip.id };
    });
    if (!result.id) return result;
    tripId = result.id;
  } catch (error) {
    return { error: error instanceof TripError ? error.message : "No pudimos guardar. Revisá los datos e intentá nuevamente." };
  }

  revalidatePath("/admin/viajes-especiales");
  redirect(`/admin/viajes-especiales/${tripId}?guardado=1`);
}

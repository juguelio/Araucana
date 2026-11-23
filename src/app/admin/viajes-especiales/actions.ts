"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import {
  argentina, assignmentSchema, billingModes, dateOnly, legSchema, localDateTime, MAX_TRIP_PAYMENTS, parseMoney,
  paymentSchema, statuses, tripPaymentTotals
} from "@/lib/special-trips/data";
import { conflictKey, fleetConflicts, lockFleet, recordAcceptance, type FleetConflict } from "@/lib/special-trips/conflicts";
import { leerRango } from "@/lib/special-trips/rango";
import { listChange, recordEntityAudit } from "@/lib/audit/entity";
import { formatAuditDate } from "@/lib/audit/labels";

export type TripFormResult = { error?: string; conflicts?: FleetConflict[]; confirmation?: string };

class TripError extends Error {}

export async function saveTrip(id: string | null, version: string | null, _state: TripFormResult, form: FormData): Promise<TripFormResult> {
  const user = await getCurrentReservationsUserOrRedirect();
  const value = (name: string) => String(form.get(name) ?? "").trim();
  let tripId: string;
  try {
    const client = value("client");
    // Sale el / vuelve el: un viaje de varios días figura en cada día del rango.
    const rango = leerRango(value("serviceDate"), value("endDate"), dateOnly);
    if ("error" in rango) throw new TripError(rango.error);
    const { serviceDate, endDate } = rango;
    const status = value("status");
    const billingMode = value("billingMode");
    const currency = value("currency");
    const invoiceDate = dateOnly(value("invoiceDate"));
    const passengers = value("passengers") ? Number(value("passengers")) : null;
    const contactName = value("contactName");
    const contactPhone = value("contactPhone");
    if (!client || client.length > 500 || !Object.hasOwn(statuses, status)) throw new TripError("Revisá el cliente y el estado.");
    if (passengers !== null && (!Number.isInteger(passengers) || passengers < 1 || passengers > 100000)) throw new TripError("Ingresá una cantidad válida de pasajeros.");
    if (contactName.length > 120) throw new TripError("El nombre de referencia debe tener hasta 120 caracteres.");
    if (contactPhone && (!/^[+\d() .-]{6,32}$/.test(contactPhone) || !/^\d{6,15}$/.test(contactPhone.replace(/\D/g, "")))) {
      throw new TripError("Ingresá un teléfono de contacto válido, con código de área.");
    }
    if (!Object.hasOwn(billingModes, billingMode) || !["ARS", "USD"].includes(currency)) throw new TripError("Revisá las condiciones de cobro.");
    if (value("invoiceDate") && !invoiceDate) throw new TripError("Revisá la fecha de factura.");
    const totalCents = value("total") ? parseMoney(value("total")) : null;
    if ((value("total") || billingMode === "FIXED") && totalCents === null) throw new TripError("Ingresá un importe válido sin separador de miles.");
    if (["UNKNOWN", "INCLUDED"].includes(billingMode) && totalCents !== null) throw new TripError("Dejá el total vacío para esta condición de cobro.");

    const parsedLegs = z.array(legSchema).min(1).max(200).safeParse(JSON.parse(value("legs")));
    if (!parsedLegs.success) {
      if (parsedLegs.error.issues.some(({ path }) => path[1] === "points")) {
        throw new TripError("Revisá los puntos intermedios. Cada punto necesita un lugar. Si cargás una fecha o un importe, deben ser válidos.");
      }
      throw new TripError("Revisá los datos de los recorridos.");
    }
    const legs = parsedLegs.data;
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
    const payments = z.array(paymentSchema).max(MAX_TRIP_PAYMENTS).parse(JSON.parse(value("payments")));
    if (payments.some((p) => (parseMoney(p.amount) ?? 0) <= 0 || ((p.date || p.kind) && !dateOnly(p.date)))) {
      throw new TripError("Revisá las fechas y los importes de los cobros.");
    }

    const result = await prisma.$transaction(async (tx) => {
      const assignedVehicles = new Set<string>();
      const assignedDrivers = new Set<string>();
      let previous: Awaited<ReturnType<typeof tx.specialTrip.findUnique>> & { assignments?: typeof assignments } | null = null;
      if (id) {
        await tx.$queryRaw`SELECT id FROM "SpecialTrip" WHERE id = ${id} FOR UPDATE`;
        const current = await tx.specialTrip.findUnique({ where: { id }, include: { assignments: true } });
        if (!current || current.updatedAt.toISOString() !== version) throw new TripError("El viaje cambió. Volvé a abrirlo antes de guardar.");
        previous = current;
        current.assignments.forEach((a) => {
          assignedVehicles.add(a.vehicleId);
          if (a.driverId) assignedDrivers.add(a.driverId);
        });
        await lockFleet(tx, [...current.assignments, ...assignments].map((a) => a.vehicleId));
      } else {
        await lockFleet(tx, assignments.map((a) => a.vehicleId));
      }
      const { paid, balance } = tripPaymentTotals(totalCents, payments);
      const previousPayments = z.array(paymentSchema).parse(previous?.payments ?? []);
      const previousTotals = tripPaymentTotals(previous?.totalCents ?? null, previousPayments);
      if (previous && previous.currency !== currency && previousTotals.paid > 0) {
        throw new TripError("El viaje ya tiene cobros en otra moneda. La moneda debe coincidir con la de los cobros registrados.");
      }
      if (balance !== null && balance < 0 && (previous?.totalCents !== totalCents || paid > previousTotals.paid)) {
        throw new TripError("La suma de los cobros supera el importe acordado.");
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
        client, serviceDate, endDate, passengers, status, billingMode, currency, totalCents, legs, payments,
        destinationSearch: legs.map((leg) => leg.destination || leg.description).join("\n"),
        contact: value("contact").slice(0, 500) || null,
        contactName: contactName || null, contactPhone: contactPhone || null, notes: value("notes").slice(0, 12000) || null,
        supplier: value("supplier").slice(0, 500) || null, invoice: value("invoice").slice(0, 500) || null,
        invoiceDate, paymentStatus: value("paymentStatus").slice(0, 500) || null
      };
      const trip = id
        ? await tx.specialTrip.update({ where: { id }, data: { ...data, assignments: { deleteMany: {}, createMany: { data: assignments } } } })
        : await tx.specialTrip.create({ data: { ...data, assignments: { createMany: { data: assignments } } } });
      await recordAcceptance(tx, "SPECIAL", trip.id, user.id, unique);

      // Auditoría en la misma transacción. Las ocupaciones se guardan legibles: nave, chofer y horario.
      const involved = [...(previous?.assignments ?? []), ...assignments];
      const [vehicleNames, driverNames] = await Promise.all([
        tx.vehicle.findMany({ where: { id: { in: involved.map((a) => a.vehicleId) } }, select: { id: true, name: true } }),
        tx.user.findMany({ where: { id: { in: involved.flatMap((a) => a.driverId ?? []) } }, select: { id: true, name: true, email: true } })
      ]);
      const describe = (a: { vehicleId: string; driverId: string | null; startsAt: Date; endsAt: Date }) => {
        const vehicle = vehicleNames.find((v) => v.id === a.vehicleId)?.name ?? a.vehicleId;
        const driver = driverNames.find((d) => d.id === a.driverId);
        return `${vehicle}${driver ? ` (${driver.name ?? driver.email})` : ""} ${formatAuditDate(a.startsAt)} a ${formatAuditDate(a.endsAt)}`;
      };
      const assignmentChange = listChange(previous ? (previous.assignments ?? []).map(describe) : null, assignments.map(describe));
      await recordEntityAudit(tx, {
        actor: user, entity: "SPECIAL_TRIP", entityId: trip.id, entityLabel: trip.client.slice(0, 120),
        summary: id ? "Viaje especial editado." : "Viaje especial creado.",
        before: previous, after: trip, json: ["legs", "payments"],
        extra: assignmentChange ? { assignments: assignmentChange } : undefined
      });
      return { id: trip.id };
    });
    if (!result.id) return result;
    tripId = result.id;
  } catch (error) {
    return { error: error instanceof TripError ? error.message : "No pudimos guardar. Revisá los datos e intentá nuevamente." };
  }

  revalidatePath("/admin/viajes-especiales");
  const detailPath = `/admin/viajes-especiales/${tripId}`;
  revalidatePath(detailPath);
  revalidatePath(`${detailPath}/editar`);
  redirect(`${detailPath}?guardado=1`);
}

export async function addTripPayment(
  id: string, operationId: string, _state: TripFormResult, form: FormData
): Promise<TripFormResult> {
  const user = await getCurrentReservationsUserOrRedirect();
  const parsed = paymentSchema.safeParse({
    id: operationId, kind: form.get("kind"), date: form.get("date"), amount: form.get("amount"), note: form.get("note")
  });
  const amountCents = parsed.success ? parseMoney(parsed.data.amount) : null;
  if (!parsed.success || !amountCents || !dateOnly(parsed.data.date)) return { error: "Ingresá una fecha y un importe de cobro válidos." };
  const payment = { ...parsed.data, amount: (amountCents / 100).toFixed(2) };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SpecialTrip" WHERE id = ${id} FOR UPDATE`;
      const trip = await tx.specialTrip.findUnique({ where: { id } });
      if (!trip) throw new TripError("El viaje ya no existe.");
      const payments = z.array(paymentSchema).parse(trip.payments);
      if (payments.some((item) => item.id === operationId)) return;
      if (trip.currency !== form.get("currency")) throw new TripError("La moneda del viaje cambió. Volvé a abrir la ficha.");
      const { balance } = tripPaymentTotals(trip.totalCents, payments);
      if (balance !== null && amountCents > balance) throw new TripError("El cobro supera el saldo pendiente.");
      if (payments.length >= MAX_TRIP_PAYMENTS) throw new TripError("El viaje alcanzó el límite de cobros registrados.");
      const updated = await tx.specialTrip.update({ where: { id }, data: { payments: [...payments, payment] } });
      await recordEntityAudit(tx, {
        actor: user, entity: "SPECIAL_TRIP", entityId: id, entityLabel: trip.client.slice(0, 120),
        summary: payment.kind === "DEPOSIT" ? "Seña del viaje especial registrada." : "Pago del viaje especial registrado.",
        before: trip, after: updated, json: ["payments"]
      });
    });
  } catch (error) {
    return { error: error instanceof TripError ? error.message : "No pudimos registrar el cobro. Intentá nuevamente." };
  }

  const path = `/admin/viajes-especiales/${id}`;
  revalidatePath(path);
  revalidatePath(`${path}/editar`);
  redirect(`${path}?cobro=1#facturacion`);
}

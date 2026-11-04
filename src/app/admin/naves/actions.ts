"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { getVehicleTemplate, type VehicleSeat } from "@/lib/vehicles/templates";
import { parseSeatLayout } from "@/lib/vehicles/validation";
import { parseLayoutMarkers, type VehicleLayoutMarker } from "@/lib/vehicles/layout-markers";
import { errorState, type AdminFieldErrors, type AdminFormState } from "../form-state";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function optionalValue(formData: FormData, key: string) {
  return value(formData, key) || null;
}

/** `input[type=date]` viene como aaaa-mm-dd: se guarda al mediodía argentino para que no se corra el día. */
function dateOrNull(formData: FormData, key: string): Date | null {
  const raw = value(formData, key);
  if (!raw) return null;
  const fecha = new Date(`${raw}T12:00:00.000-03:00`);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function numberOrNull(formData: FormData, key: string): number | null {
  const raw = value(formData, key);
  if (!raw) return null;
  const numero = Number(raw);
  return Number.isFinite(numero) ? Math.trunc(numero) : null;
}

class FormValidationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: AdminFieldErrors
  ) {
    super(message);
  }
}

function vehicleData(formData: FormData) {
  const name = value(formData, "name");
  const brand = value(formData, "brand");
  const model = value(formData, "model");
  const templateKey = optionalValue(formData, "templateKey");
  const fieldErrors: AdminFieldErrors = {};

  if (!name) {
    fieldErrors.name = "Ingresa un nombre interno para identificar la nave.";
  }

  if (!brand) {
    fieldErrors.brand = "Ingresa la marca de la nave.";
  }

  if (!model) {
    fieldErrors.model = "Ingresa el modelo de la nave.";
  }

  if (templateKey && !getVehicleTemplate(templateKey)) {
    fieldErrors.templateKey = "La plantilla seleccionada ya no existe.";
  }

  let seats: VehicleSeat[] = [];
  let layoutMarkers: VehicleLayoutMarker[] = [];
  try {
    seats = parseSeatLayout(value(formData, "seats"));
  } catch (error) {
    fieldErrors.seats = error instanceof Error ? error.message : "La distribucion de asientos no es valida.";
  }

  try {
    layoutMarkers = parseLayoutMarkers(value(formData, "layoutMarkers"));
  } catch (error) {
    fieldErrors.seats = error instanceof Error ? error.message : "Las marcas del plano no son validas.";
  }

  if (Object.keys(fieldErrors).length) {
    throw new FormValidationError("Revisa los campos marcados para guardar la nave.", fieldErrors);
  }

  return {
    vehicle: {
      name,
      brand,
      model,
      licensePlate: optionalValue(formData, "licensePlate"),
      templateKey,
      layoutMarkers,
      isActive: formData.get("isActive") === "on",
      // Ficha de flota
      internalNumber: optionalValue(formData, "internalNumber"),
      owner: optionalValue(formData, "owner"),
      year: numberOrNull(formData, "year"),
      acquiredAt: dateOrNull(formData, "acquiredAt"),
      technicalInspectionDueAt: dateOrNull(formData, "technicalInspectionDueAt"),
      rtoDueAt: dateOrNull(formData, "rtoDueAt"),
      insurer: optionalValue(formData, "insurer"),
      policyDueAt: dateOrNull(formData, "policyDueAt"),
      publicTransport: formData.get("publicTransport") === "on",
      kind: value(formData, "kind") || "CAMIONETA",
      notes: optionalValue(formData, "notes")
    },
    seats
  };
}

function vehicleErrorState(error: unknown) {
  if (error instanceof FormValidationError) {
    return errorState(error.message, error.fieldErrors);
  }

  return errorState(error instanceof Error ? error.message : "No pudimos guardar la nave. Intentalo nuevamente.");
}

function revalidateVehiclePaths() {
  revalidatePath("/admin");
  revalidatePath("/admin/naves");
}

export async function createVehicleAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await getCurrentAdminOrRedirect();

  try {
    const { vehicle, seats } = vehicleData(formData);
    await prisma.vehicle.create({
      data: {
        ...vehicle,
        seats: {
          create: seats
        }
      }
    });
  } catch (error) {
    return vehicleErrorState(error);
  }

  revalidateVehiclePaths();
  redirect(`/admin/naves?notice=${encodeURIComponent("Nave guardada con exito.")}`);
}

export async function updateVehicleAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await getCurrentAdminOrRedirect();

  const id = value(formData, "id");
  if (!id) {
    return errorState("Falta la nave a editar. Volve a abrirla desde el listado.");
  }

  try {
    const { vehicle, seats } = vehicleData(formData);

    await prisma.$transaction(async (tx) => {
      await tx.vehicle.update({
        where: { id },
        data: vehicle
      });

      const currentSeats = await tx.seat.findMany({
        where: { vehicleId: id },
        include: {
          _count: {
            select: {
              reservations: true
            }
          }
        }
      });
      const currentByNumber = new Map(currentSeats.map((seat) => [seat.number, seat]));
      const nextNumbers = new Set(seats.map((seat) => seat.number));

      for (const currentSeat of currentSeats) {
        if (nextNumbers.has(currentSeat.number)) {
          continue;
        }

        if (currentSeat._count.reservations > 0) {
          throw new FormValidationError("Revisa la distribucion de asientos.", {
            seats: `No se puede quitar el asiento ${currentSeat.number} porque ya tiene reservas.`
          });
        }

        await tx.seat.delete({ where: { id: currentSeat.id } });
      }

      for (const seat of seats) {
        const currentSeat = currentByNumber.get(seat.number);

        if (currentSeat) {
          await tx.seat.update({
            where: { id: currentSeat.id },
            data: {
              row: seat.row,
              column: seat.column
            }
          });
          continue;
        }

        await tx.seat.create({
          data: {
            vehicleId: id,
            ...seat
          }
        });
      }
    });
  } catch (error) {
    return vehicleErrorState(error);
  }

  revalidateVehiclePaths();
  redirect(`/admin/naves?notice=${encodeURIComponent("Nave guardada con exito.")}`);
}

export async function setVehicleActiveAction(formData: FormData) {
  await getCurrentAdminOrRedirect();

  const id = value(formData, "id");
  const isActive = value(formData, "isActive") === "true";

  await prisma.vehicle.update({
    where: { id },
    data: { isActive }
  });

  revalidateVehiclePaths();
  redirect(`/admin/naves?notice=${encodeURIComponent(isActive ? "Nave activada con exito." : "Nave inactivada con exito.")}`);
}

export async function deleteVehicleAction(formData: FormData) {
  await getCurrentAdminOrRedirect();

  const id = value(formData, "id");
  const scheduleCount = await prisma.schedule.count({ where: { vehicleId: id } });

  let notice = "Nave borrada con exito.";
  if (scheduleCount > 0) {
    await prisma.vehicle.update({
      where: { id },
      data: { isActive: false }
    });
    notice = "Nave archivada con exito porque ya tenia salidas.";
  } else {
    await prisma.vehicle.delete({ where: { id } });
  }

  revalidateVehiclePaths();
  redirect(`/admin/naves?notice=${encodeURIComponent(notice)}`);
}

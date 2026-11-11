import { prisma } from "@/lib/db/prisma";
import { isDepartureSheetToken, createDepartureSheetToken } from "./codes";
import { parseTripLegs, planillaKindsForSpecialTrip, planillaNotApplicableReason } from "./applicability";
import type { DeparturePassengerInput } from "./validation";
import type { DepartureSheetKind } from "./types";

export class DepartureSheetError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "CLOSED" | "NOT_APPLICABLE") {
    super(
      code === "CLOSED"
        ? "La planilla ya no recibe datos."
        : code === "NOT_APPLICABLE"
          ? planillaNotApplicableReason
          : "No encontramos la reserva o la planilla."
    );
  }
}

/** Lo que necesita el link público y el detalle: la planilla, su viaje y los pasajeros cargados. */
const sheetInclude = {
  passengers: { orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }] },
  specialTrip: {
    select: {
      id: true,
      client: true,
      contact: true,
      serviceDate: true,
      passengers: true,
      status: true,
      destinationSearch: true,
      legs: true
    }
  }
};

/**
 * Devuelve el link de la planilla de ese viaje especial, creándolo la primera vez. Una por viaje y
 * tipo: si el operador aprieta dos veces, no se generan dos links distintos.
 *
 * No se genera planilla para un viaje que no sale de la provincia: el tipo tiene que corresponder al
 * destino (DUT si sale del país, registro si sale de la provincia).
 */
export async function ensureDepartureSheet(specialTripId: string, kind: DepartureSheetKind, createdBy?: string | null) {
  const trip = await prisma.specialTrip.findUnique({
    where: { id: specialTripId },
    select: { id: true, destinationSearch: true, legs: true }
  });

  if (!trip) {
    throw new DepartureSheetError("NOT_FOUND");
  }

  const kinds = planillaKindsForSpecialTrip({
    destinationSearch: trip.destinationSearch,
    legs: parseTripLegs(trip.legs)
  });

  if (!kinds.includes(kind)) {
    throw new DepartureSheetError("NOT_APPLICABLE");
  }

  return prisma.departureSheet.upsert({
    where: { specialTripId_kind: { specialTripId: trip.id, kind } },
    update: {},
    create: {
      specialTripId: trip.id,
      kind,
      token: createDepartureSheetToken(),
      createdBy: createdBy ?? null
    }
  });
}

/** Planillas ya generadas para un viaje especial, con cuántos pasajeros cargó cada una. */
export async function listDepartureSheetsForSpecialTrip(specialTripId: string) {
  return prisma.departureSheet.findMany({
    where: { specialTripId },
    include: { _count: { select: { passengers: true } } }
  });
}

export async function getDepartureSheetById(id: string) {
  return prisma.departureSheet.findUnique({ where: { id }, include: sheetInclude });
}

/** Lectura pública por token. El token mal formado no llega a la base. */
export async function getDepartureSheetByToken(token: string) {
  const normalized = token.trim().toUpperCase();
  if (!isDepartureSheetToken(normalized)) {
    return null;
  }

  return prisma.departureSheet.findUnique({ where: { token: normalized }, include: sheetInclude });
}

export async function setDepartureSheetOpen(id: string, isOpen: boolean) {
  return prisma.departureSheet.update({ where: { id }, data: { isOpen } });
}

export async function removeDepartureSheetPassenger(id: string) {
  return prisma.departureSheetPassenger.delete({ where: { id } });
}

/**
 * Alta desde el link público.
 *
 * - El mismo documento cargado dos veces **actualiza** la fila: si el pasajero se equivocó y vuelve
 *   a entrar, corrige sus datos en vez de aparecer duplicado en la planilla que va a Migraciones.
 * - `position` se asigna con la planilla bloqueada (`FOR UPDATE`): dos personas del grupo cargando
 *   al mismo tiempo no pueden quedarse con el mismo Nº.
 */
export async function submitDepartureSheetPassenger(token: string, passenger: DeparturePassengerInput) {
  const normalized = token.trim().toUpperCase();
  if (!isDepartureSheetToken(normalized)) {
    throw new DepartureSheetError("NOT_FOUND");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "DepartureSheet" WHERE token = ${normalized} FOR UPDATE`;
    const sheet = await tx.departureSheet.findUnique({ where: { token: normalized } });

    if (!sheet) {
      throw new DepartureSheetError("NOT_FOUND");
    }
    if (!sheet.isOpen) {
      throw new DepartureSheetError("CLOSED");
    }

    const existing = await tx.departureSheetPassenger.findUnique({
      where: {
        sheetId_documentType_documentNumber: {
          sheetId: sheet.id,
          documentType: passenger.documentType,
          documentNumber: passenger.documentNumber
        }
      }
    });

    if (existing) {
      const updated = await tx.departureSheetPassenger.update({
        where: { id: existing.id },
        data: {
          firstName: passenger.firstName,
          lastName: passenger.lastName,
          sex: passenger.sex,
          birthDate: passenger.birthDate,
          nationality: passenger.nationality,
          occupation: passenger.occupation,
          residenceCountry: passenger.residenceCountry
        }
      });
      return { passenger: updated, updated: true };
    }

    const { _max } = await tx.departureSheetPassenger.aggregate({
      where: { sheetId: sheet.id },
      _max: { position: true }
    });

    const created = await tx.departureSheetPassenger.create({
      data: {
        sheetId: sheet.id,
        position: (_max.position ?? 0) + 1,
        firstName: passenger.firstName,
        lastName: passenger.lastName,
        documentType: passenger.documentType,
        documentNumber: passenger.documentNumber,
        sex: passenger.sex,
        birthDate: passenger.birthDate,
        nationality: passenger.nationality,
        occupation: passenger.occupation,
        residenceCountry: passenger.residenceCountry
      }
    });

    return { passenger: created, updated: false };
  });
}

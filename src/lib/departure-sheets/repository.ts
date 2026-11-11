import { prisma } from "@/lib/db/prisma";
import { isDepartureSheetToken, createDepartureSheetToken } from "./codes";
import type { DeparturePassengerInput, CreateDepartureSheetInput } from "./validation";

export class DepartureSheetError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "CLOSED") {
    super(code === "CLOSED" ? "La planilla ya no recibe datos." : "No encontramos la planilla.");
  }
}

export type DepartureSheetSummary = {
  id: string;
  kind: string;
  title: string;
  destination: string | null;
  departureAt: Date | null;
  borderCrossing: string | null;
  notes: string | null;
  token: string;
  isOpen: boolean;
  createdAt: Date;
  passengerCount: number;
};

/** Abre una planilla y devuelve el link público (token incluido). */
export async function createDepartureSheet(input: CreateDepartureSheetInput, createdBy?: string | null) {
  return prisma.departureSheet.create({
    data: {
      kind: input.kind,
      title: input.title,
      destination: input.destination || null,
      departureAt: input.departureAt,
      borderCrossing: input.borderCrossing || null,
      notes: input.notes || null,
      token: createDepartureSheetToken(),
      createdBy: createdBy ?? null
    }
  });
}

export async function listDepartureSheets(limit = 100): Promise<DepartureSheetSummary[]> {
  const sheets = await prisma.departureSheet.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    include: { _count: { select: { passengers: true } } }
  });

  return sheets.map(({ _count, ...sheet }) => ({ ...sheet, passengerCount: _count.passengers }));
}

export async function getDepartureSheetById(id: string) {
  return prisma.departureSheet.findUnique({
    where: { id },
    include: { passengers: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } }
  });
}

/** Lectura pública por token. El token mal formado no llega a la base. */
export async function getDepartureSheetByToken(token: string) {
  const normalized = token.trim().toUpperCase();
  if (!isDepartureSheetToken(normalized)) {
    return null;
  }

  return prisma.departureSheet.findUnique({
    where: { token: normalized },
    include: { passengers: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } }
  });
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

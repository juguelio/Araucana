"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { localInput } from "@/lib/special-trips/data";
import { previewHistory, readWorkbook, sourceVersion, type ImportSource } from "@/lib/special-trips/import";

type PreviewRow = {
  key: string; sheet: string; row: number; date: string; client: string; description: string;
  trip: number | null; issues: string[]; billing: string;
};
export type ImportState = {
  error?: string; message?: string;
  preview?: {
    token: string; rows: PreviewRow[]; trips: number;
    expected: { count: number; ars: number | null; usd: number | null };
    actual: { count: number; ars: number; usd: number };
  };
};

export async function importHistory(_state: ImportState, form: FormData): Promise<ImportState> {
  await getCurrentReservationsUserOrRedirect();
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size < 1 || file.size > 850_000) {
    return { error: "Elegí la exportación completa de Google Sheets en formato .xlsx (hasta 850 KB)." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const today = localInput(new Date()).slice(0, 10);
  let input: Awaited<ReturnType<typeof readWorkbook>>;
  try {
    input = await readWorkbook(buffer);
  } catch (error) {
    return { error: error instanceof Error && /^(?:Falta|El libro|El resumen)/.test(error.message) ? error.message : "No pudimos leer el libro de Excel." };
  }
  const { trips, skipped, totals } = previewHistory(input.rows, today);
  const all = [...trips.flatMap((trip) => trip.sources), ...skipped];
  const known = await prisma.specialTripSource.findMany({ select: { id: true, version: true, tripId: true } });
  const byId = new Map(known.map((source) => [source.id, source]));
  const knownVersions = new Set(known.map((source) => source.version));
  const alreadyProcessed = (source: ImportSource) => byId.has(source.id);
  const movedRow = (source: ImportSource) => !alreadyProcessed(source) && knownVersions.has(sourceVersion(source));
  const changedRow = (source: ImportSource) => alreadyProcessed(source) && byId.get(source.id)?.version !== sourceVersion(source);
  const token = createHash("sha256").update(buffer).update(today)
    .update(JSON.stringify(known.sort((a, b) => a.id.localeCompare(b.id)))).digest("hex");
  const canWrite = form.get("confirm") === token;
  const asRow = (source: ImportSource, trip: number | null): PreviewRow => ({
    key: source.id, sheet: source.sheet, row: source.row, date: source.original[0], client: source.original[1],
    description: source.original[3], trip,
    billing: source.sheet === "Distrito"
      ? [source.original[5], source.original[6] && `Factura ${source.original[6]}`, source.original[8]].filter(Boolean).join(" · ")
      : [source.original[5], source.original[6] && `Seña ${source.original[6]}`, source.original[7] && `Saldo ${source.original[7]}`].filter(Boolean).join(" · "),
    issues: [
      ...source.issues,
      ...(changedRow(source) ? ["Esta fila cambió desde la importación anterior. Revisala en Drive."] :
        movedRow(source) ? ["El contenido coincide con una fila ya procesada en otra posición."] :
        alreadyProcessed(source) ? ["Fila ya procesada."] : [])
    ]
  });
  const preview = {
    token, trips: trips.length,
    rows: [...trips.flatMap((trip, i) => trip.sources.map((source) => asRow(source, i + 1))), ...skipped.map((source) => asRow(source, null))]
      .sort((a, b) => a.sheet.localeCompare(b.sheet) || a.row - b.row),
    expected: input.expected, actual: totals
  };
  if (!canWrite) return {
    preview, ...(form.has("confirm") && { error: "Cambió el archivo o el historial. Revisá esta nueva vista previa antes de confirmar." })
  };

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serialize imports and recheck the preview against current source rows.
      await tx.$executeRaw`LOCK TABLE "SpecialTripSource" IN SHARE ROW EXCLUSIVE MODE`;
      const current = await tx.specialTripSource.findMany({ select: { id: true, version: true, tripId: true } });
      if (current.length !== known.length || current.some((source) => {
        const old = byId.get(source.id);
        return old?.version !== source.version || old?.tripId !== source.tripId;
      })) return null;
      let created = 0;
      let archived = 0;
      const sourceData = (source: ImportSource) => ({ ...source, version: sourceVersion(source) });
      for (const { sources, ...trip } of trips) {
        const eligible = sources.filter((source) => !alreadyProcessed(source) && !movedRow(source));
        if (!eligible.length) continue;
        if (eligible.length !== sources.length) {
          await tx.specialTripSource.createMany({ data: eligible.map((source) => ({
            ...sourceData(source),
            issues: [...source.issues, "Agrupación parcial con filas ya procesadas. Vincular manualmente después de revisar."]
          })) });
          archived += eligible.length;
          continue;
        }
        await tx.specialTrip.create({ data: {
          ...trip, destinationSearch: trip.legs.map((leg) => leg.description).join("\n"),
          sources: { createMany: { data: sources.map(sourceData) } }
        } });
        created++;
      }
      const notes = skipped.filter((source) => !alreadyProcessed(source) && !movedRow(source));
      if (notes.length) await tx.specialTripSource.createMany({ data: notes.map(sourceData) });
      return { created, archived: archived + notes.length };
    }, { timeout: 45_000 });
    if (!result) return { error: "El historial cambió durante la revisión. Volvé a generar la vista previa." };
    revalidatePath("/admin/viajes-especiales");
    return { message: `Se importaron ${result.created} viajes y se archivaron ${result.archived} filas para revisión.` };
  } catch {
    return { preview, error: `No se pudo completar la importación. Se conservaron las filas existentes. Filas del archivo: ${all.length}.` };
  }
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ excursion: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }, excursionPhoto: { create: vi.fn(), update: vi.fn(), delete: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
import { addExcursionPhoto, deleteExcursionRecord, getPublicExcursion, listPublicExcursions, makeExcursionCoverRecord, removeExcursionPhotoRecord, saveExcursionRecord } from "./repository";
const version = "2026-11-12T10:00:00.000Z";
const photo = { id: "p1", position: 0, blobPathname: "excursion-photos/e1/p1.jpg", contentType: "image/jpeg" };
function form(published = false) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ name: "Lago", description: "Con guía", duration: "4 horas", price: "", currency: "ARS", departures: "[]", isPublished: published ? "on" : "" })) f.set(k, v);
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation((fn) => fn(db));
  db.excursion.findUnique.mockResolvedValue({ id: "e1", updatedAt: new Date(version), photos: [photo], isPublished: true });
});

describe("excursiones: repositorio", () => {
  it("el catálogo y el detalle filtran borradores, fotos ausentes y salidas pasadas", async () => {
    const now = new Date("2026-11-12T10:00:00Z");
    await listPublicExcursions(now);
    await getPublicExcursion("e1", now);
    const filter = { isPublished: true, photos: { some: {} } };
    expect(db.excursion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: filter, include: expect.objectContaining({ departures: { where: { departureAt: { gte: now } }, orderBy: { departureAt: "asc" } } }) }));
    expect(db.excursion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "e1", ...filter } }));
  });
  it("crea borrador y reemplaza las fechas en una sola transacción", async () => {
    await saveExcursionRecord(null, null, form());
    expect(db.excursion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isPublished: false, departures: { create: [] } }) }));
    await saveExcursionRecord("e1", version, form(true));
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.excursion.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ departures: { deleteMany: {}, create: [] } }) }));
  });
  it("rechaza publicar sin foto y evita pisar una edición concurrente", async () => {
    await expect(saveExcursionRecord(null, null, form(true))).rejects.toThrow("foto");
    db.excursion.findUnique.mockResolvedValueOnce({ id: "e1", updatedAt: new Date(version), photos: [] });
    await expect(saveExcursionRecord("e1", version, form(true))).rejects.toThrow("foto");
    await expect(saveExcursionRecord("e1", "old", form())).rejects.toThrow("cambió");
    expect(db.excursion.update).not.toHaveBeenCalled();
  });
  it("quitar la última foto vuelve a borrador y no acepta fotos de otra excursión", async () => {
    expect(await removeExcursionPhotoRecord("e1", "p1")).toBe(photo.blobPathname);
    expect(db.excursion.update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { isPublished: false, updatedAt: expect.any(Date) } });
    await expect(removeExcursionPhotoRecord("e1", "foreign")).rejects.toThrow("no existe");
    await expect(makeExcursionCoverRecord("e1", "foreign")).rejects.toThrow("no existe");
  });
  it("limita la galería bajo bloqueo y agrega al final", async () => {
    await addExcursionPhoto("e1", { blobPathname: "excursion-photos/e1/p2.jpg", contentType: "image/jpeg" });
    expect(db.excursionPhoto.create).toHaveBeenCalledWith({ data: { excursionId: "e1", blobPathname: "excursion-photos/e1/p2.jpg", contentType: "image/jpeg", position: 1 } });
    db.excursion.findUnique.mockResolvedValue({ id: "e1", photos: Array.from({ length: 12 }, (_, i) => ({ ...photo, id: `p${i}`, position: i })) });
    await expect(addExcursionPhoto("e1", photo)).rejects.toThrow("12 fotos");
  });
  it("cambia portada sin perder las otras fotos", async () => {
    db.excursion.findUnique.mockResolvedValueOnce({ id: "e1", photos: [photo, { ...photo, id: "p2", position: 1 }], isPublished: true });
    await makeExcursionCoverRecord("e1", "p2");
    expect(db.excursionPhoto.update.mock.calls).toEqual([[{ where: { id: "p2" }, data: { position: 0 } }], [{ where: { id: "p1" }, data: { position: 1 } }]]);
  });
  it("baja la entidad y devuelve sólo las fotos asociadas para limpieza", async () => {
    expect(await deleteExcursionRecord("e1")).toEqual([photo.blobPathname]);
    expect(db.excursion.delete).toHaveBeenCalledWith({ where: { id: "e1" } });
  });
});

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ExcursionError, MAX_EXCURSION_PHOTOS, parseExcursionForm } from "./validation";

const allDetails = { photos: { orderBy: [{ position: "asc" }, { id: "asc" }] }, departures: { orderBy: { departureAt: "asc" } } } satisfies Prisma.ExcursionInclude;
const publicWhere = { isPublished: true, photos: { some: {} } } satisfies Prisma.ExcursionWhereInput;

export function listAdminExcursions() {
  return prisma.excursion.findMany({ include: allDetails, orderBy: { name: "asc" } });
}
export function getAdminExcursion(id: string) {
  return prisma.excursion.findUnique({ where: { id }, include: allDetails });
}
function publicDetails(now: Date) {
  return { ...allDetails, departures: { where: { departureAt: { gte: now } }, orderBy: { departureAt: "asc" as const } } };
}
export function listPublicExcursions(now = new Date()) {
  return prisma.excursion.findMany({ where: publicWhere, include: publicDetails(now), orderBy: { name: "asc" } });
}
export function getPublicExcursion(id: string, now = new Date()) {
  return prisma.excursion.findFirst({ where: { id, ...publicWhere }, include: publicDetails(now) });
}

async function lockExcursion(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Excursion" WHERE id = ${id} FOR UPDATE`;
  const current = await tx.excursion.findUnique({ where: { id }, include: { photos: true } });
  if (!current) throw new ExcursionError("La excursión ya no existe.");
  return current;
}

export async function saveExcursionRecord(id: string | null, version: string | null, form: FormData) {
  const { departures, ...data } = parseExcursionForm(form);
  return prisma.$transaction(async (tx) => {
    const current = id ? await lockExcursion(tx, id) : null;
    if (current && current.updatedAt.toISOString() !== version) throw new ExcursionError("La excursión cambió. Volvé a abrirla antes de guardar.");
    if (data.isPublished && !current?.photos.length) throw new ExcursionError("Guardá como borrador y subí al menos una foto antes de publicar.");
    const create = departures.map((departureAt) => ({ departureAt }));
    return id
      ? tx.excursion.update({ where: { id }, data: { ...data, departures: { deleteMany: {}, create } } })
      : tx.excursion.create({ data: { ...data, departures: { create } } });
  });
}

export async function addExcursionPhoto(id: string, photo: { blobPathname: string; contentType: string }) {
  return prisma.$transaction(async (tx) => {
    const current = await lockExcursion(tx, id);
    if (current.photos.length >= MAX_EXCURSION_PHOTOS) throw new ExcursionError("Podés cargar hasta 12 fotos por excursión.");
    const position = Math.max(-1, ...current.photos.map((p) => p.position)) + 1;
    const created = await tx.excursionPhoto.create({ data: { excursionId: id, ...photo, position } });
    await tx.excursion.update({ where: { id }, data: { updatedAt: new Date() } });
    return created;
  });
}

export async function removeExcursionPhotoRecord(id: string, photoId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await lockExcursion(tx, id);
    const photo = current.photos.find((p) => p.id === photoId);
    if (!photo) throw new ExcursionError("La foto ya no existe.");
    await tx.excursionPhoto.delete({ where: { id: photo.id } });
    // Quitar la última foto retira también la publicación; nunca deja una ficha rota.
    await tx.excursion.update({ where: { id }, data: { isPublished: current.photos.length === 1 ? false : current.isPublished, updatedAt: new Date() } });
    return photo.blobPathname;
  });
}

export async function makeExcursionCoverRecord(id: string, photoId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await lockExcursion(tx, id);
    if (!current.photos.some((p) => p.id === photoId)) throw new ExcursionError("La foto ya no existe.");
    const sorted = [...current.photos].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const ids = [photoId, ...sorted.filter((p) => p.id !== photoId).map((p) => p.id)];
    for (const [position, photoId] of ids.entries()) await tx.excursionPhoto.update({ where: { id: photoId }, data: { position } });
    await tx.excursion.update({ where: { id }, data: { updatedAt: new Date() } });
  });
}

export async function deleteExcursionRecord(id: string) {
  return prisma.$transaction(async (tx) => {
    const current = await lockExcursion(tx, id);
    await tx.excursion.delete({ where: { id } });
    return current.photos.map((p) => p.blobPathname);
  });
}

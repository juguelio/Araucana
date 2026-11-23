import { get } from "@vercel/blob";
import { getAppUserFromToken, getTokenFromRequest } from "@/lib/auth/service";
import { prisma } from "@/lib/db/prisma";

/**
 * Sirve un papel de la unidad. Los archivos viven en un blob privado: se piden por acá y la ruta
 * decide quién puede verlos —administración y secretaría cualquiera, el chofer sólo los de la nave
 * que tiene marcada como su ubicación— en vez de exponer una URL pública.
 */

type Props = {
  params: Promise<{ id: string; documentId: string }>;
};

function contentDisposition(fileName: string) {
  const seguro = fileName.replace(/["\\\r\n]/g, "_");
  return `inline; filename="${seguro}"`;
}

export async function GET(request: Request, { params }: Props) {
  const user = await getAppUserFromToken(getTokenFromRequest(request));
  if (!user || !user.isActive) {
    return new Response("No autorizado", { status: 401 });
  }

  const { id, documentId } = await params;
  const documento = await prisma.vehicleDocument.findFirst({
    where: { id: documentId, vehicleId: id },
    select: { id: true, fileName: true, contentType: true, blobPathname: true }
  });
  if (!documento) {
    return new Response("Documento no encontrado", { status: 404 });
  }

  if (user.role === "DRIVER") {
    const suNave = await prisma.driverVehicleLocation.findFirst({
      where: { driverId: user.id, vehicleId: id },
      select: { id: true }
    });
    if (!suNave) {
      return new Response("Este documento no es de tu unidad", { status: 403 });
    }
  } else if (!["ADMIN", "SECRETARY", "SUPERADMIN"].includes(user.role)) {
    return new Response("No autorizado", { status: 403 });
  }

  const resultado = await get(documento.blobPathname, {
    access: "private",
    ifNoneMatch: request.headers.get("if-none-match") ?? undefined
  });
  if (!resultado) {
    return new Response("Documento no encontrado", { status: 404 });
  }
  if (resultado.statusCode === 304) {
    return new Response(null, {
      status: 304,
      headers: { ETag: resultado.blob.etag, "Cache-Control": "private, no-store" }
    });
  }

  return new Response(resultado.stream, {
    headers: {
      "Content-Type": documento.contentType,
      "Content-Disposition": contentDisposition(documento.fileName),
      "X-Content-Type-Options": "nosniff",
      ETag: resultado.blob.etag,
      "Cache-Control": "private, no-store"
    }
  });
}

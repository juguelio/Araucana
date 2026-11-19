import { get } from "@vercel/blob";
import { AuthorizationError, requireReservationsUser } from "@/lib/auth/service";
import { DISABILITY_DOCUMENT_PROVIDER } from "@/lib/booking/disability-fare";
import { getReservationByCode } from "@/lib/booking/repository";
import { isAdminRole } from "@/lib/auth/roles";
import { recordDownload } from "@/lib/audit/download";

type ReceiptRouteContext = {
  params: Promise<{
    code: string;
  }>;
};

function contentDisposition(fileName?: string | null) {
  if (!fileName) {
    return "inline";
  }

  const safeName = fileName.replace(/["\\\r\n]/g, "_");
  return `inline; filename="${safeName}"`;
}

export async function GET(request: Request, context: ReceiptRouteContext) {
  let user;
  try {
    user = await requireReservationsUser(request);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("No autorizado", { status: 401 });
    }

    throw error;
  }

  const { code } = await context.params;
  const reservation = await getReservationByCode(code.toUpperCase());
  if (reservation?.payment?.provider === DISABILITY_DOCUMENT_PROVIDER && !isAdminRole(user.role)) {
    return new Response("No autorizado", { status: 403 });
  }
  const pathname = reservation?.payment?.receiptBlobPathname;

  if (!pathname) {
    return new Response("Comprobante no encontrado", { status: 404 });
  }

  // Sin Blob configurado no hay comprobantes posibles: el seed del panel usa `local/<archivo>` y
  // el archivo se sirve desde `public/`. Con token (producción) esto no se toca nunca.
  if (!process.env.BLOB_READ_WRITE_TOKEN && /^local\/[\w.-]+$/.test(pathname)) {
    const { readFile } = await import("node:fs/promises");
    const { join, extname } = await import("node:path");
    try {
      const file = await readFile(join(process.cwd(), "public", pathname));
      const tipo = extname(pathname).toLowerCase();
      const contentType = tipo === ".png" ? "image/png" : tipo === ".webp" ? "image/webp" : tipo === ".pdf" ? "application/pdf" : "image/jpeg";
      return new Response(file, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": contentDisposition(reservation.payment?.receiptFileName),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store"
        }
      });
    } catch {
      return new Response("Comprobante no encontrado", { status: 404 });
    }
  }

  const result = await get(pathname, {
    access: "private",
    ifNoneMatch: request.headers.get("if-none-match") ?? undefined
  });

  if (!result) {
    return new Response("Comprobante no encontrado", { status: 404 });
  }

  if (result.statusCode === 304) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: result.blob.etag,
        "Cache-Control": "private, no-store"
      }
    });
  }

  // Sólo cuando el archivo sale de verdad (un 304 es el navegador revalidando lo que ya tenía).
  const disability = reservation?.payment?.provider === DISABILITY_DOCUMENT_PROVIDER;
  await recordDownload(request, user, {
    view: true, entity: "RESERVATION", entityId: reservation?.id, entityLabel: code.toUpperCase(),
    summary: disability ? "Documentación de discapacidad consultada." : "Comprobante de pago consultado."
  });

  return new Response(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType,
      "Content-Disposition": contentDisposition(reservation.payment?.receiptFileName),
      "X-Content-Type-Options": "nosniff",
      ETag: result.blob.etag,
      "Cache-Control": "private, no-store"
    }
  });
}

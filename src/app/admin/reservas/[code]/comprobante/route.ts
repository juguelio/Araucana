import { get } from "@vercel/blob";
import { AuthorizationError, requireReservationsUser } from "@/lib/auth/service";
import { DISABILITY_DOCUMENT_PROVIDER } from "@/lib/booking/disability-fare";
import { getReservationByCode } from "@/lib/booking/repository";

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
  if (reservation?.payment?.provider === DISABILITY_DOCUMENT_PROVIDER && user.role !== "ADMIN") {
    return new Response("No autorizado", { status: 403 });
  }
  const pathname = reservation?.payment?.receiptBlobPathname;

  if (!pathname) {
    return new Response("Comprobante no encontrado", { status: 404 });
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

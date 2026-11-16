import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/responses";
import { clearSessionCookie } from "@/lib/auth/cookie";
import { deleteSessionByToken, getAppUserFromToken, getTokenFromRequest } from "@/lib/auth/service";
import { recordAuditBestEffort, requestOrigin } from "@/lib/audit/record";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request) {
  try {
    const token = getTokenFromRequest(request);
    // Se lee antes de borrar la sesión: después ya no se sabe de quién era.
    const user = await getAppUserFromToken(token).catch(() => null);
    await deleteSessionByToken(token);
    if (user) {
      await recordAuditBestEffort(prisma, {
        actor: user,
        action: "LOGOUT",
        entity: "SESSION",
        entityId: user.id,
        entityLabel: user.email,
        summary: "Cierre de sesión.",
        ...requestOrigin(request)
      });
    }
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

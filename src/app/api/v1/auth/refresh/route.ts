import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/responses";
import { setSessionCookie } from "@/lib/auth/cookie";
import { getTokenFromRequest, refreshSessionByToken } from "@/lib/auth/service";
import { recordAuditBestEffort, requestOrigin } from "@/lib/audit/record";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request) {
  try {
    const session = await refreshSessionByToken(getTokenFromRequest(request));
    await recordAuditBestEffort(prisma, {
      actor: session.user, action: "LOGIN", entity: "SESSION", entityId: session.user.id, entityLabel: session.user.email,
      summary: "Sesión renovada.", ...requestOrigin(request)
    });
    const response = NextResponse.json({ token: session.token, expiresAt: session.expiresAt.toISOString(), user: session.user });
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

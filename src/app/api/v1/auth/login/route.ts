import { NextResponse } from "next/server";
import { z } from "zod";
import { cuposDeAcceso, limitarPedido } from "@/lib/api/rate-limit";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { AuthenticationError, createSessionForCredentials } from "@/lib/auth/service";
import { recordAuditBestEffort, requestOrigin } from "@/lib/audit/record";
import { prisma } from "@/lib/db/prisma";
import { setSessionCookie } from "@/lib/auth/cookie";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128).refine((password) => Buffer.byteLength(password, "utf8") <= 72)
});

export async function POST(request: Request) {
  const rafaga = await limitarPedido(request, cuposDeAcceso);
  if (rafaga) return rafaga;

  let attemptedEmail: string | null = null;
  try {
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) return jsonError("VALIDATION_ERROR", "Email y contraseña son requeridos.", 400);
    attemptedEmail = parsed.data.email.toLowerCase();
    const session = await createSessionForCredentials(parsed.data);
    await recordAuditBestEffort(prisma, {
      actor: session.user,
      action: "LOGIN",
      entity: "SESSION",
      entityId: session.user.id,
      entityLabel: session.user.email,
      summary: session.isActive ? "Inicio de sesión con contraseña." : "Inicio de sesión con contraseña (cuenta pendiente de aprobación).",
      ...requestOrigin(request)
    });
    const response = NextResponse.json({ token: session.token, expiresAt: session.expiresAt.toISOString(), user: session.user, isActive: session.isActive });
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    // Sólo el email intentado: la contraseña que se probó nunca se guarda.
    if (error instanceof AuthenticationError) {
      await recordAuditBestEffort(prisma, {
        // Quien intentó entrar no es esa cuenta: el email probado va como "sobre qué", no como actor.
        actor: { role: "GUEST" },
        action: "LOGIN_FAILED",
        entity: "SESSION",
        entityLabel: attemptedEmail,
        summary: "Intento de inicio de sesión fallido: email o contraseña incorrectos.",
        ...requestOrigin(request)
      });
    }
    return handleApiError(error);
  }
}

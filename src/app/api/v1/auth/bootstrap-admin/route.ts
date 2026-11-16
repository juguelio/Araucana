import { z } from "zod";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { isValidPassword } from "@/lib/auth/password";
import { bootstrapAdminPassword } from "@/lib/auth/service";
import { recordAuditBestEffort, requestOrigin } from "@/lib/audit/record";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().refine(isValidPassword),
  token: z.string().min(32).max(256)
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("VALIDATION_ERROR", "Email, contraseña (12 caracteres y hasta 72 bytes UTF-8) y token son requeridos.", 400);
  const email = parsed.data.email.toLowerCase();
  try {
    await bootstrapAdminPassword(parsed.data);
    await recordAuditBestEffort(prisma, {
      actor: { role: "GUEST" }, action: "UPDATE", entity: "USER", entityLabel: email,
      summary: "Administrador inicial configurado con el token de inicialización.", ...requestOrigin(request)
    });
    return Response.json({ ok: true, message: "Administrador inicializado. Ya podés iniciar sesión." });
  } catch (error) {
    // Un intento rechazado de tomar la cuenta administradora es justo lo que conviene ver después.
    await recordAuditBestEffort(prisma, {
      actor: { role: "GUEST" }, action: "LOGIN_FAILED", entity: "USER", entityLabel: email,
      summary: "Intento rechazado de inicializar el administrador.", ...requestOrigin(request)
    });
    return handleApiError(error);
  }
}

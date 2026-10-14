import { z } from "zod";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { isValidPassword } from "@/lib/auth/password";
import { bootstrapAdminPassword } from "@/lib/auth/service";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().refine(isValidPassword),
  token: z.string().min(32).max(256)
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("VALIDATION_ERROR", "Email, contraseña (12 caracteres y hasta 72 bytes UTF-8) y token son requeridos.", 400);
  try {
    await bootstrapAdminPassword(parsed.data);
    return Response.json({ ok: true, message: "Administrador inicializado. Ya podés iniciar sesión." });
  } catch (error) {
    return handleApiError(error);
  }
}

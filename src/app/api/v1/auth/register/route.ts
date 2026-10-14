import { Prisma } from "@prisma/client";
import { z } from "zod";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { isValidPassword } from "@/lib/auth/password";
import { registerWithCredentials } from "@/lib/auth/service";

const registerSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(254),
  password: z.string().refine(isValidPassword, "La contraseña debe tener al menos 12 caracteres y no superar 72 bytes UTF-8.")
});

export async function POST(request: Request) {
  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("VALIDATION_ERROR", "Revisa nombre, email y contraseña (mínimo 12 caracteres y hasta 72 bytes UTF-8).", 400);
  try {
    const user = await registerWithCredentials(parsed.data);
    return Response.json({ user, pendingApproval: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return jsonError("EMAIL_IN_USE", "Ese email ya tiene una cuenta. Contactá a un administrador para recuperar el acceso.", 409);
    }
    return handleApiError(error);
  }
}

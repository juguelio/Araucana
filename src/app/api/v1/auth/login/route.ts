import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { createSessionForCredentials } from "@/lib/auth/service";
import { setSessionCookie } from "@/lib/auth/cookie";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128).refine((password) => Buffer.byteLength(password, "utf8") <= 72)
});

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) return jsonError("VALIDATION_ERROR", "Email y contraseña son requeridos.", 400);
    const session = await createSessionForCredentials(parsed.data);
    const response = NextResponse.json({ token: session.token, expiresAt: session.expiresAt.toISOString(), user: session.user, isActive: session.isActive });
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/responses";
import { clearSessionCookie } from "@/lib/auth/cookie";
import { deleteSessionByToken, getTokenFromRequest } from "@/lib/auth/service";

export async function POST(request: Request) {
  try {
    await deleteSessionByToken(getTokenFromRequest(request));
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

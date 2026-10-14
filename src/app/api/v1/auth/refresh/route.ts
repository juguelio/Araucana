import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/responses";
import { setSessionCookie } from "@/lib/auth/cookie";
import { getTokenFromRequest, refreshSessionByToken } from "@/lib/auth/service";

export async function POST(request: Request) {
  try {
    const session = await refreshSessionByToken(getTokenFromRequest(request));
    const response = NextResponse.json({ token: session.token, expiresAt: session.expiresAt.toISOString(), user: session.user });
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

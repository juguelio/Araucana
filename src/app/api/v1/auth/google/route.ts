import { NextResponse } from "next/server";
import {
  createGoogleAuthorizationRequest,
  googleRequestBaseUrl,
  getGoogleStateCookieName,
  makeGoogleState
} from "@/lib/auth/google";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { state, nonce } = makeGoogleState();
    const result = await createGoogleAuthorizationRequest(request, state, nonce);
    if (!result.redirect) throw result.error ?? new Error("No se pudo abrir el acceso de Google.");

    const response = NextResponse.redirect(result.redirect, 302);
    response.cookies.set(getGoogleStateCookieName(), `${state}.${nonce}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 300
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=google", googleRequestBaseUrl(request)), 302);
  }
}

import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth/cookie";
import {
  exchangeGoogleIdentity,
  getGoogleStateCookieName,
  googleRequestBaseUrl,
  isGoogleLoginStateValid
} from "@/lib/auth/google";
import { createSessionForUser } from "@/lib/auth/service";
import { getDefaultPathForRole, toPublicRole } from "@/lib/auth/roles";

export const runtime = "nodejs";

function redirectToLogin(request: Request) {
  return NextResponse.redirect(new URL("/login?error=google", googleRequestBaseUrl(request)), 302);
}

export async function GET(request: Request) {
  try {
    if (!isGoogleLoginStateValid(request)) return redirectToLogin(request);

    const user = await exchangeGoogleIdentity(request);
    const session = await createSessionForUser(user);
    const destination = user.isActive ? getDefaultPathForRole(toPublicRole(user.role)) : "/acceso-pendiente";
    const response = NextResponse.redirect(new URL(destination, googleRequestBaseUrl(request)), 302);
    setSessionCookie(response, session.token, session.expiresAt);
    response.cookies.set(getGoogleStateCookieName(), "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0
    });
    return response;
  } catch {
    const response = redirectToLogin(request);
    response.cookies.set(getGoogleStateCookieName(), "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0
    });
    return response;
  }
}

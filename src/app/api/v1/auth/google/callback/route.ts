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

function getSafeErrorName(error: unknown) {
  if (!(error instanceof Error) || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)) return "UnknownError";
  return error.name;
}

export async function GET(request: Request) {
  let stage = "state_validation";
  try {
    if (!isGoogleLoginStateValid(request)) {
      console.warn("[auth/google] callback rejected", { stage });
      return redirectToLogin(request);
    }

    stage = "identity_exchange";
    const user = await exchangeGoogleIdentity(request);

    stage = "session_creation";
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
  } catch (error) {
    console.error("[auth/google] callback failed", { stage, errorName: getSafeErrorName(error) });
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

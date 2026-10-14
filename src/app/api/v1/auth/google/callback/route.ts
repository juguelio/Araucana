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

function getSafeErrorCode(error: unknown) {
  if (!(error instanceof Error)) return "unknown_error";
  const knownMessages: Record<string, string> = {
    "La identidad de Google no es válida.": "invalid_google_identity",
    "Google no confirmó el email de esta cuenta.": "google_email_not_verified",
    "Este email ya está vinculado a otra cuenta de Google.": "google_account_conflict",
    "No pudimos validar la cuenta de Google.": "passport_rejected_identity"
  };
  const knownCode = knownMessages[error.message];
  if (knownCode) return knownCode;
  if (/^ID token /.test(error.message)) return "invalid_google_id_token";
  if (error.name === "TokenError") return "google_token_rejected";
  if (error.name === "InternalOAuthError") return "google_provider_exchange_failed";
  if (error.name.startsWith("Prisma")) return "database_error";
  return "unclassified_error";
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
    console.error("[auth/google] callback failed", {
      stage,
      errorName: getSafeErrorName(error),
      errorCode: getSafeErrorCode(error)
    });
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

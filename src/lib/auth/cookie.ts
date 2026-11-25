import type { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, type PublicUser } from "./session";

export function setSessionCookie(response: NextResponse, session: { token: string; expiresAt: Date; user: PublicUser; isActive: boolean }) {
  const { token, expiresAt, user, isActive } = session;
  const chofer = user.role === "DRIVER" && isActive;
  response.cookies.set("chofer_offline", chofer ? user.id : "", {
    path: "/chofer", sameSite: "lax", secure: process.env.NODE_ENV === "production",
    ...(chofer ? { expires: expiresAt } : { maxAge: 0 })
  });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/"
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set("chofer_offline", "", { path: "/chofer", maxAge: 0 });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/"
  });
}

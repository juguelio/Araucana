import { NextResponse } from "next/server";
import { getAppUserFromToken, getTokenFromRequest } from "@/lib/auth/service";

export async function GET(request: Request) {
  const user = await getAppUserFromToken(getTokenFromRequest(request));

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  if (!user.isActive) {
    return NextResponse.json({
      user: { ...user, isActive: false },
      error: { code: "PENDING_APPROVAL", message: "La cuenta esta pendiente de aprobacion." }
    }, { status: 403 });
  }

  return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}

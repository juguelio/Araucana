import { NextResponse } from "next/server";
import { AuthorizationError, requireDriverUser } from "@/lib/auth/service";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { cargarJornadaApp } from "@/lib/driver/jornada-app";
import { firmarServicio } from "@/lib/driver/comprobante";

export async function GET(request: Request) {
  try {
    const user = await requireDriverUser(request);
    const { fecha, servicios } = await cargarJornadaApp(user.id);
    return NextResponse.json({
      driverId: user.id, fecha,
      servicios: servicios.map(s => ({ ...s, comprobante: firmarServicio(user.id, s) }))
    }, { headers: { "Cache-Control": "private, no-store", "X-Driver-Id": user.id } });
  } catch (error) {
    if (error instanceof AuthorizationError) return jsonError("UNAUTHORIZED", error.message, 401);
    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/responses";
import { cargarFlotaEnVivo } from "@/lib/driver/en-vivo";
import { requireAdminApi } from "../_utils";

/**
 * Posiciones de la flota para el mapa en vivo (issue #316). Sólo lectura: la escritura sigue siendo
 * el POST del chofer (`/api/v1/driver/location`). Se consulta desde la pantalla con polling.
 */
export async function GET(request: Request) {
  try {
    await requireAdminApi(request);
    return NextResponse.json({ flota: await cargarFlotaEnVivo() });
  } catch (error) {
    return handleApiError(error);
  }
}

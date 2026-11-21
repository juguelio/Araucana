import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/responses";
import { acotarHoras, cargarRecorridosResultado, VENTANA_RECORRIDO_HORAS } from "@/lib/driver/recorrido";
import { requireAdminApi } from "../_utils";

/**
 * Recorridos dibujados (issue #321). Sólo lectura del historial que escribe el panel del chofer.
 *
 * `?horas=` se acota acá y la respuesta devuelve la ventana **realmente consultada**: antes el endpoint
 * respondía 999 para una consulta de 24 h, y la pantalla mostraba un número que no era el que se leyó.
 * Si el tope de muestras se llenó, `truncado` lo dice en vez de dibujar un recorrido incompleto en silencio.
 */
export async function GET(request: Request) {
  try {
    await requireAdminApi(request);
    const pedidas = new URL(request.url).searchParams.get("horas");
    const horas = acotarHoras(pedidas ?? VENTANA_RECORRIDO_HORAS);
    const { recorridos, truncado } = await cargarRecorridosResultado(horas);
    return NextResponse.json({ recorridos, horas, truncado });
  } catch (error) {
    return handleApiError(error);
  }
}

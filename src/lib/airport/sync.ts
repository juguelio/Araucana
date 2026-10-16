import { detectFlightChange } from "@/lib/airport/flights";
import { fetchSchedules, type FlightDirection } from "@/lib/airport/provider";
import { prisma } from "@/lib/db/prisma";

/**
 * Trae los vuelos de AirLabs y los guarda en `Flight`, registrando en `FlightEvent` cada
 * imprevisto detectado (demora, cancelación, desvío, adelanto). Es la pieza que hace que
 * los vuelos "se posteen solos" y que el botón del panel funcione de verdad.
 *
 * Sin clave o con error de red devuelve el detalle del error y NO rompe: la operación sigue
 * con lo que ya está cargado (modo degradado).
 */

const TZ_OFFSET_MIN = -180;
export const DIAS_A_SINCRONIZAR = 3;

export type SyncSummary = {
  corridas: number;
  creados: number;
  actualizados: number;
  eventos: number;
  errores: string[];
};

function diasDesdeHoy(dias: number): string[] {
  const ahora = new Date();
  const salida: string[] = [];
  for (let i = 0; i < dias; i += 1) {
    const d = new Date(ahora.getTime() + i * 86400000 + TZ_OFFSET_MIN * 60000);
    salida.push(d.toISOString().slice(0, 10));
  }
  return salida;
}

export async function syncAirportFlights(opts: { days?: number } = {}): Promise<SyncSummary> {
  const resumen: SyncSummary = { corridas: 0, creados: 0, actualizados: 0, eventos: 0, errores: [] };
  const direcciones: FlightDirection[] = ["ARRIVAL", "DEPARTURE"];

  for (const dia of diasDesdeHoy(opts.days ?? DIAS_A_SINCRONIZAR)) {
    for (const direction of direcciones) {
      const { flights, error } = await fetchSchedules(direction, dia);
      resumen.corridas += 1;
      if (error) {
        resumen.errores.push(`${direction} ${dia}: ${error}`);
        continue;
      }

      for (const vuelo of flights) {
        const previo = await prisma.flight.findFirst({
          where: { number: vuelo.number, scheduledAt: vuelo.scheduledAt, direction: vuelo.direction }
        });

        if (!previo) {
          await prisma.flight.create({
            data: {
              number: vuelo.number,
              airline: vuelo.airline,
              origin: vuelo.origin,
              destination: vuelo.destination,
              direction: vuelo.direction,
              scheduledAt: vuelo.scheduledAt,
              estimatedAt: vuelo.estimatedAt,
              status: vuelo.status,
              externalId: vuelo.externalId,
              lastCheckedAt: new Date(),
              source: "API"
            }
          });
          resumen.creados += 1;
          continue;
        }

        const cambio = detectFlightChange(
          { status: previo.status, scheduledAt: previo.scheduledAt, estimatedAt: previo.estimatedAt },
          { status: vuelo.status, scheduledAt: vuelo.scheduledAt, estimatedAt: vuelo.estimatedAt }
        );

        await prisma.flight.update({
          where: { id: previo.id },
          data: {
            status: vuelo.status,
            estimatedAt: vuelo.estimatedAt,
            airline: vuelo.airline,
            origin: vuelo.origin,
            externalId: vuelo.externalId,
            lastCheckedAt: new Date(),
            source: "API",
            ...(cambio
              ? { events: { create: { kind: cambio.kind, fromValue: cambio.fromValue, toValue: cambio.toValue } } }
              : {})
          }
        });

        if (cambio) resumen.eventos += 1;
        resumen.actualizados += 1;
      }
    }
  }

  return resumen;
}

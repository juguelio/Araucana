import { detectFlightChange } from "@/lib/airport/flights";
import { DIAS_PROYECTADOS, proyectarVuelos } from "@/lib/airport/projection";
import { fetchSchedules, type FlightDirection } from "@/lib/airport/provider";
import { prisma } from "@/lib/db/prisma";
import { getAirLabsKey } from "@/lib/settings/app-settings";

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
  /** Días futuros completados proyectando el patrón ya observado (AirLabs no publica futuros). */
  proyectados: number;
  errores: string[];
};

/** Rango local (UTC-3) de un día, para saber si un día ya tiene datos reales. */
function rangoDelDia(dia: string): { desde: Date; hasta: Date } {
  const desde = new Date(`${dia}T00:00:00-03:00`);
  return { desde, hasta: new Date(desde.getTime() + 86400000) };
}

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
  const resumen: SyncSummary = { corridas: 0, creados: 0, actualizados: 0, eventos: 0, proyectados: 0, errores: [] };
  const direcciones: FlightDirection[] = ["ARRIVAL", "DEPARTURE"];
  const apiKey = await getAirLabsKey();

  for (const dia of diasDesdeHoy(opts.days ?? DIAS_A_SINCRONIZAR)) {
    for (const direction of direcciones) {
      const { flights, error } = await fetchSchedules(direction, dia, apiKey);
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

  // Los días futuros NO vienen de la API (el plan de AirLabs no publica horarios futuros).
  // Para que el pasajero igual pueda elegir un vuelo de los próximos días, se repite el patrón
  // que ya observamos, marcado ESTIMADO. El día que llega, manda el dato real y la proyección
  // se saltea. Nunca se inventa un vuelo que no hayamos visto antes.
  const observados = await prisma.flight.findMany({
    where: { source: { in: ["API", "ESTIMADO"] } },
    select: {
      number: true,
      airline: true,
      origin: true,
      destination: true,
      direction: true,
      scheduledAt: true,
      source: true
    }
  });

  for (const dia of diasDesdeHoy(DIAS_PROYECTADOS + 1).slice(1)) {
    const { desde, hasta } = rangoDelDia(dia);
    const realesDelDia = await prisma.flight.count({
      where: { source: "API", scheduledAt: { gte: desde, lt: hasta } }
    });
    if (realesDelDia > 0) continue;

    for (const proyectado of proyectarVuelos(dia, observados)) {
      const existe = await prisma.flight.findFirst({
        where: { number: proyectado.number, scheduledAt: proyectado.scheduledAt, direction: proyectado.direction }
      });
      if (existe) continue;

      await prisma.flight.create({
        data: {
          number: proyectado.number,
          airline: proyectado.airline,
          origin: proyectado.origin,
          destination: proyectado.destination,
          direction: proyectado.direction,
          scheduledAt: proyectado.scheduledAt,
          estimatedAt: null,
          status: proyectado.status,
          externalId: proyectado.externalId,
          source: proyectado.source,
          lastCheckedAt: null
        }
      });
      resumen.proyectados += 1;
    }
  }

  return resumen;
}

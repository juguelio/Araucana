import { detectFlightChange } from "@/lib/airport/flights";
import { DIAS_PROYECTADOS, proyectarVuelos } from "@/lib/airport/projection";
import { fechaDelTablero, fetchFidsBoard, mapFidsStatus } from "@/lib/airport/fids";
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
  /** Días futuros completados proyectando el patrón ya observado (AirLabs no publica futuros). */
  proyectados: number;
  /** Vuelos revisados contra el tablero del aeropuerto (cubre aerolíneas que AirLabs no tiene). */
  desdeTablero: number;
  /** Filas repetidas del mismo vuelo el mismo día que se unificaron (autocorrección). */
  limpiados: number;
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
  const resumen: SyncSummary = { corridas: 0, creados: 0, actualizados: 0, eventos: 0, proyectados: 0, desdeTablero: 0, limpiados: 0, errores: [] };
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
        // Mismo número y sentido ese día = el mismo vuelo, aunque el horario haya cambiado entre
        // fuentes: si AirLabs publica el horario viejo y el aeropuerto el nuevo, no son dos vuelos.
        const { desde: inicioDia, hasta: finDia } = rangoDelDia(dia);
        const previo = await prisma.flight.findFirst({
          where: {
            number: vuelo.number,
            direction: vuelo.direction,
            scheduledAt: { gte: inicioDia, lt: finDia }
          }
        });

        // El tablero del aeropuerto es la vista autorizada de ese día: AirLabs no lo pisa.
        if (previo && previo.source === "FIDS") {
          resumen.actualizados += 1;
          continue;
        }

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

  // Tablero del aeropuerto: complementa lo que AirLabs no cubre (American Jet, por ejemplo) y trae
  // los estados del propio aeropuerto. Nunca pisa un vuelo de la API: si hay otro vuelo del mismo
  // sentido a menos de 25 minutos, se trata como el mismo vuelo físico con otro código (código
  // compartido) y se saltea.
  for (const direction of direcciones) {
    const { flights: delTablero, error } = await fetchFidsBoard(direction);
    resumen.corridas += 1;
    if (error) {
      resumen.errores.push(`tablero ${direction}: ${error}`);
      continue;
    }

    for (const f of delTablero) {
      const fecha = fechaDelTablero(f.scheduled);
      if (!fecha) continue;
      const scheduledAt = new Date(`${fecha}T${f.scheduled}:00-03:00`);
      const estimatedAt = f.estimated ? new Date(`${fecha}T${f.estimated}:00-03:00`) : null;
      const estado = mapFidsStatus(f);

      // Mismo número y mismo día = el mismo vuelo, aunque las fuentes no coincidan en el horario
      // (la API puede estar publicando el horario viejo). El tablero es la vista del aeropuerto, así
      // que manda su horario y su estado.
      const desdeElDia = new Date(`${fecha}T00:00:00-03:00`);
      const hastaElDia = new Date(desdeElDia.getTime() + 86400000);
      const candidatos = await prisma.flight.findMany({
        where: { number: f.number, direction, scheduledAt: { gte: desdeElDia, lt: hastaElDia } },
        include: { _count: { select: { reservations: true, assignments: true } } }
      });

      // Autocorrección: si el mismo vuelo quedó repetido ese día (por ejemplo una fila con el
      // horario viejo de la API y otra con el del tablero), se conserva la más parecida al tablero
      // y se borran las demás. Nunca se borra una fila con reservas o combis asignadas.
      const propio = candidatos.reduce<(typeof candidatos)[number] | null>((mejor, c) => {
        if (!mejor) return c;
        const dC = Math.abs(c.scheduledAt.getTime() - scheduledAt.getTime());
        const dM = Math.abs(mejor.scheduledAt.getTime() - scheduledAt.getTime());
        return dC < dM ? c : mejor;
      }, null);
      for (const c of candidatos) {
        if (propio && c.id !== propio.id && c._count.reservations === 0 && c._count.assignments === 0) {
          await prisma.flight.delete({ where: { id: c.id } });
          resumen.limpiados += 1;
        }
      }
      if (propio) {
        const cambio = detectFlightChange(
          { status: propio.status, scheduledAt: propio.scheduledAt, estimatedAt: propio.estimatedAt },
          { status: estado, scheduledAt, estimatedAt }
        );
        await prisma.flight.update({
          where: { id: propio.id },
          data: {
            status: estado,
            estimatedAt,
            airline: f.airlineCode,
            origin: propio.origin && propio.origin !== "—" ? propio.origin : f.city || "—",
            source: "FIDS",
            lastCheckedAt: new Date(),
            scheduledAt,
            ...(cambio
              ? { events: { create: { kind: cambio.kind, fromValue: cambio.fromValue, toValue: cambio.toValue } } }
              : {})
          }
        });
        if (cambio) resumen.eventos += 1;
        resumen.actualizados += 1;
        resumen.desdeTablero += 1;

        // Si el aeropuerto corrigió el horario (la API publicaba otro), se alinea la grilla futura
        // de ese mismo vuelo para que el pasajero vea el horario bueno desde hoy.
        {
          const futuros = await prisma.flight.findMany({
            where: { number: f.number, direction, source: "ESTIMADO", scheduledAt: { gte: hastaElDia } },
            select: { id: true, scheduledAt: true }
          });
          for (const fut of futuros) {
            const horaFutura = new Date(fut.scheduledAt.getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);
            if (horaFutura === f.scheduled) continue; // ya está alineado
            const fechaFutura = new Date(fut.scheduledAt.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
            const destino = new Date(`${fechaFutura}T${f.scheduled}:00-03:00`);
            const ocupado = await prisma.flight.findFirst({
              where: {
                number: f.number,
                direction,
                scheduledAt: { gte: new Date(destino.getTime() - 60000), lte: new Date(destino.getTime() + 60000) },
                id: { not: fut.id }
              }
            });
            if (ocupado) continue;
            await prisma.flight.update({ where: { id: fut.id }, data: { scheduledAt: destino } });
          }
        }

        continue;
      }

      const gemelo = await prisma.flight.findFirst({
        where: {
          direction,
          scheduledAt: {
            gte: new Date(scheduledAt.getTime() - 25 * 60000),
            lte: new Date(scheduledAt.getTime() + 25 * 60000)
          }
        }
      });
      if (gemelo) continue;

      await prisma.flight.create({
        data: {
          number: f.number,
          airline: f.airlineCode,
          origin: f.city || "—",
          destination: direction === "ARRIVAL" ? "Aeropuerto Chapelco (CPC)" : f.city || "—",
          direction,
          scheduledAt,
          estimatedAt,
          status: estado,
          source: "FIDS",
          lastCheckedAt: new Date()
        }
      });
      resumen.creados += 1;
      resumen.desdeTablero += 1;
    }
  }

  // Los días futuros NO vienen de la API (el plan de AirLabs no publica horarios futuros).
  // Para que el pasajero igual pueda elegir un vuelo de los próximos días, se repite el patrón
  // que ya observamos, marcado ESTIMADO. El día que llega, manda el dato real y la proyección
  // se saltea. Nunca se inventa un vuelo que no hayamos visto antes.
  // MANUAL entra a propósito: hay aerolíneas que vuelan a CPC y no están en AirLabs
  // (American Jet), así que su horario cargado a mano también tiene que proyectarse.
  const observados = await prisma.flight.findMany({
    where: { source: { in: ["API", "ESTIMADO", "MANUAL", "FIDS"] } },
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

      // Mismo número y sentido ese día: ya está cubierto (aunque el horario haya cambiado entre
      // fuentes). Sin esto, un cambio de horario genera una fila duplicada del mismo vuelo.
      const { desde: diaDesde, hasta: diaHasta } = rangoDelDia(dia);
      const mismoVuelo = await prisma.flight.findFirst({
        where: {
          number: proyectado.number,
          direction: proyectado.direction,
          scheduledAt: { gte: diaDesde, lt: diaHasta }
        }
      });
      if (mismoVuelo) continue;

      // Código compartido: si ya hay otro vuelo del mismo sentido a menos de 25 minutos, es el
      // mismo vuelo físico con otro número (WJ/JA en JetSMART) y no se duplica.
      const gemeloProyectado = await prisma.flight.findFirst({
        where: {
          direction: proyectado.direction,
          scheduledAt: {
            gte: new Date(proyectado.scheduledAt.getTime() - 25 * 60000),
            lte: new Date(proyectado.scheduledAt.getTime() + 25 * 60000)
          }
        }
      });
      if (gemeloProyectado) continue;

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

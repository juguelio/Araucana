import type { CalendarWeek } from "@/lib/admin/weekly-calendar";
import { prisma } from "@/lib/db/prisma";
import { dateOnly, statuses } from "@/lib/special-trips/data";
import { dayInterval } from "@/lib/special-trips/conflicts";
import { diaDelViaje, whereSolapa } from "@/lib/special-trips/rango";
import { diasDeSemana, sumarDias } from "@/lib/school-runs/week";
import { specialTripsPath as base } from "../view";

export function readTripCalendarFilters(get: (key: string) => unknown) {
  const text = (key: string) => {
    const raw = get(key);
    return typeof raw === "string" ? raw.trim() : "";
  };
  const status = text("estado");
  return { q: text("q"), status: Object.hasOwn(statuses, status) ? status : "", vehicleId: text("nave") };
}

const time = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Salta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const detail = (count: number) => `${count} ${count === 1 ? "pasajero" : "pasajeros"}`;

export async function loadSpecialTripsWeek(start: string, { q, status, vehicleId }: ReturnType<typeof readTripCalendarFilters>): Promise<CalendarWeek> {
  const end = sumarDias(start, 7);
  const weekStart = dayInterval(start).startsAt;
  const weekEnd = dayInterval(end).startsAt;
  const trips = await prisma.specialTrip.findMany({
    where: {
      AND: [
        whereSolapa(dateOnly(start)!, dateOnly(end)!),
        ...(status ? [{ status }] : []),
        ...(q ? [{ OR: [
          { client: { contains: q, mode: "insensitive" as const } },
          { destinationSearch: { contains: q, mode: "insensitive" as const } },
          { contactName: { contains: q, mode: "insensitive" as const } },
          { contactPhone: { contains: q } }, { contact: { contains: q, mode: "insensitive" as const } }
        ] }] : []),
        ...(vehicleId ? [{ assignments: { some: { vehicleId } } }] : [])
      ]
    },
    orderBy: [{ serviceDate: "asc" }, { client: "asc" }, { id: "asc" }],
    select: {
      id: true, client: true, destinationSearch: true, status: true, passengers: true, serviceDate: true, endDate: true,
      assignments: {
        where: {
          ...(vehicleId ? { vehicleId } : {}),
          startsAt: { lt: weekEnd }, endsAt: { gt: weekStart }
        },
        orderBy: { startsAt: "asc" },
        select: { startsAt: true, endsAt: true, vehicle: { select: { name: true } } }
      }
    }
  });
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (status) query.set("estado", status);
  if (vehicleId) query.set("nave", vehicleId);
  const suffix = query.size ? `&${query}` : "";
  const hrefDia = (date: string) => `${base}/dia?fecha=${date}${suffix}`;
  return {
    days: diasDeSemana(start).map((date) => {
      const day = dateOnly(date)!;
      const { startsAt, endsAt } = dayInterval(date);
      return {
        date,
        href: hrefDia(date),
        cards: trips.flatMap((trip) => {
          const dayOfTrip = diaDelViaje(trip, day);
          if (!dayOfTrip) return [];
          const assignments = trip.assignments.filter((item) => item.startsAt < endsAt && item.endsAt > startsAt);
          if (vehicleId && !assignments.length) return [];
          const first = assignments[0];
          const hora = first && first.startsAt >= startsAt ? time.format(first.startsAt) : "";
          const progreso = dayOfTrip.total > 1 ? `Día ${dayOfTrip.numero} de ${dayOfTrip.total}` : "";
          return [{
            id: trip.id, href: hrefDia(date), title: trip.client,
            kicker: [progreso, hora].filter(Boolean).join(" · "),
            details: [
              trip.destinationSearch.trim().replace(/\s*\n\s*/g, " · "),
              assignments.length ? [...new Set(assignments.map(({ vehicle }) => vehicle.name))].join(", ") : "Sin nave asignada",
              trip.passengers === null ? "" : detail(trip.passengers)
            ].filter(Boolean),
            status: {
              label: statuses[trip.status as keyof typeof statuses] ?? trip.status,
              tone: trip.status === "CANCELLED" ? "cancelled" : trip.status === "PENDING" ? "warning" : trip.status === "CONFIRMED" ? "positive" : undefined
            }
          }];
        })
      };
    })
  };
}

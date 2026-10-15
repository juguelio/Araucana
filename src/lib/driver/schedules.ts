import { prisma } from "@/lib/db/prisma";

const ACTIVE_DRIVER_SCHEDULE_STATUSES = ["OPEN", "DOCUMENTATION"] as const;
const DRIVER_MANIFEST_RESERVATION_STATUSES = ["PENDING_PAYMENT", "CONFIRMED"] as const;
const DEFAULT_UPCOMING_SCHEDULE_LIMIT = 60;
const DASHBOARD_SCHEDULES_PER_ROUTE = 12;

export type DriverRouteOption = {
  id: string;
  slug: string;
  from: string;
  to: string;
  via: string;
  label: string;
};

export type DriverRouteStop = {
  name: string;
  minutes: number | null;
  note: string | null;
};

export type DriverSchedulePassenger = {
  reservationId: string;
  code: string;
  passengerName: string;
  phone: string;
  documentLabel: string;
  seatNumber: string | null;
  passengerCount: number;
  reservationStatus: string;
  paymentStatus: string | null;
};

export type DriverUpcomingSchedule = {
  id: string;
  routeId: string;
  route: DriverRouteOption;
  routeLabel: string;
  departureAt: string;
  arrivalAt: string;
  status: string;
  vehicle: {
    id: string;
    name: string;
    licensePlate: string | null;
  };
  stops: DriverRouteStop[];
  totalSeats: number;
  availableSeats: number;
  reservationCount: number;
  passengerCount: number;
  passengers: DriverSchedulePassenger[];
};

function routeLabel(route: { from: string; to: string }) {
  return `${route.from} -> ${route.to}`;
}

function mapDriverRouteOption(route: {
  id: string;
  slug: string;
  from: string;
  to: string;
  via: string;
}): DriverRouteOption {
  return {
    ...route,
    label: routeLabel(route)
  };
}

function normalizeRouteStops(stops: unknown): DriverRouteStop[] {
  if (!Array.isArray(stops)) {
    return [];
  }

  return stops
    .map((stop) => {
      if (!stop || typeof stop !== "object") {
        return null;
      }

      const record = stop as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const minutes = typeof record.minutes === "number" && Number.isFinite(record.minutes) ? record.minutes : null;
      const note = typeof record.note === "string" && record.note.trim() ? record.note.trim() : null;

      return name ? { name, minutes, note } : null;
    })
    .filter((stop): stop is DriverRouteStop => Boolean(stop));
}

function passengerName(passenger: { firstName: string; lastName: string }) {
  return `${passenger.firstName} ${passenger.lastName}`.trim();
}

function documentLabel(passenger: { documentType: string; documentId: string }) {
  return `${passenger.documentType} ${passenger.documentId}`.trim();
}

export async function listDriverRouteOptions(): Promise<DriverRouteOption[]> {
  const routes = await prisma.travelRoute.findMany({
    where: {
      isActive: true,
      bookingMode: "SEATED"
    },
    orderBy: [{ from: "asc" }, { to: "asc" }, { via: "asc" }],
    select: {
      id: true,
      slug: true,
      from: true,
      to: true,
      via: true
    }
  });

  return routes.map(mapDriverRouteOption);
}

export async function listDriverUpcomingSchedules(options: {
  routeId?: string;
  from?: Date;
  take?: number;
} = {}): Promise<DriverUpcomingSchedule[]> {
  const schedules = await prisma.schedule.findMany({
    where: {
      routeId: options.routeId,
      departureAt: {
        gte: options.from ?? new Date()
      },
      status: {
        in: [...ACTIVE_DRIVER_SCHEDULE_STATUSES]
      },
      route: {
        isActive: true,
        bookingMode: "SEATED"
      }
    },
    orderBy: {
      departureAt: "asc"
    },
    take: options.take ?? DEFAULT_UPCOMING_SCHEDULE_LIMIT,
    include: {
      route: {
        select: {
          id: true,
          slug: true,
          from: true,
          to: true,
          via: true,
          stops: true
        }
      },
      vehicle: {
        select: {
          id: true,
          name: true,
          licensePlate: true,
          _count: {
            select: {
              seats: true
            }
          }
        }
      },
      reservations: {
        where: {
          status: {
            in: [...DRIVER_MANIFEST_RESERVATION_STATUSES]
          }
        },
        orderBy: [{ seatNumber: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          code: true,
          seatNumber: true,
          passengerCount: true,
          status: true,
          passenger: {
            select: {
              firstName: true,
              lastName: true,
              phone: true,
              documentType: true,
              documentId: true
            }
          },
          payment: {
            select: {
              status: true
            }
          }
        }
      }
    }
  });

  return schedules.map((schedule) => {
    const route = mapDriverRouteOption(schedule.route);
    const passengers = schedule.reservations.map((reservation) => ({
      reservationId: reservation.id,
      code: reservation.code,
      passengerName: passengerName(reservation.passenger),
      phone: reservation.passenger.phone,
      documentLabel: documentLabel(reservation.passenger),
      seatNumber: reservation.seatNumber,
      passengerCount: reservation.passengerCount,
      reservationStatus: reservation.status,
      paymentStatus: reservation.payment?.status ?? null
    }));
    const totalSeats = schedule.vehicle._count.seats;

    return {
      id: schedule.id,
      routeId: schedule.routeId,
      route,
      routeLabel: route.label,
      departureAt: schedule.departureAt.toISOString(),
      arrivalAt: schedule.arrivalAt.toISOString(),
      status: schedule.status,
      vehicle: {
        id: schedule.vehicle.id,
        name: schedule.vehicle.name,
        licensePlate: schedule.vehicle.licensePlate
      },
      stops: normalizeRouteStops(schedule.route.stops),
      totalSeats,
      availableSeats: Math.max(totalSeats - passengers.reduce((total, passenger) => total + passenger.passengerCount, 0), 0),
      reservationCount: passengers.length,
      passengerCount: passengers.reduce((total, passenger) => total + passenger.passengerCount, 0),
      passengers
    };
  });
}

export async function getDriverScheduleDashboard(now = new Date()) {
  const routes = await listDriverRouteOptions();
  const schedulesByRoute = await Promise.all(
    routes.map((route) =>
      listDriverUpcomingSchedules({
        routeId: route.id,
        from: now,
        take: DASHBOARD_SCHEDULES_PER_ROUTE
      })
    )
  );

  return {
    routes,
    schedules: schedulesByRoute
      .flat()
      .sort((left, right) => new Date(left.departureAt).getTime() - new Date(right.departureAt).getTime())
  };
}

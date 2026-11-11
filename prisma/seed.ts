import { existsSync } from "node:fs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { demoSeedDatabaseUrl } from "../src/lib/db/demo-seed-target";
import { demoRoutes } from "./demo-routes";

const VEHICLE_ID = "veh-araucana-24";
const CHAPELCO_ROUTE_ID = "route-chapelco";

function parseDurationMin(duration: string) {
  const hoursMatch = duration.match(/(\d+)\s*h/);
  const minutesMatch = duration.match(/(\d+)\s*m/);
  const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
  const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;

  return hours * 60 + minutes;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function localDateTime(date: Date, time: string) {
  return new Date(`${date.toISOString().slice(0, 10)}T${time}:00-03:00`);
}

function eachDateInclusive(start: string, end: string) {
  const dates: Date[] = [];
  const current = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);

  while (current <= last) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

async function seedVehicle(db: Prisma.TransactionClient) {
  await db.vehicle.createMany({
    skipDuplicates: true,
    data: {
      id: VEHICLE_ID,
      name: "Araucana 24",
      brand: "Mercedes-Benz",
      model: "Sprinter Minibus 19+1",
      licensePlate: "ARAU-24",
      templateKey: "mercedes-sprinter-19",
      isActive: true
    }
  });
  await db.seat.createMany({
    skipDuplicates: true,
    data: Array.from({ length: 24 }, (_, index) => ({
      vehicleId: VEHICLE_ID,
      number: String(index + 1).padStart(2, "0"),
      row: Math.floor(index / 4) + 1,
      column: (index % 4) + 1
    }))
  });
}

async function seedRoutesAndSchedules(db: Prisma.TransactionClient) {
  await db.travelRoute.createMany({
    skipDuplicates: true,
    data: [
      ...demoRoutes.map((route) => ({
        id: route.id,
        slug: route.slug,
        from: route.from,
        to: route.to,
        via: route.via,
        durationMin: parseDurationMin(route.duration),
        priceCents: route.price * 100,
        currency: "ARS",
        category: route.category,
        description: route.description,
        featured: route.featured ?? false,
        isActive: true,
        stops: route.stops
      })),
      {
        id: CHAPELCO_ROUTE_ID,
        slug: "chapelco",
        from: "San Martin de los Andes",
        to: "Chapelco",
        via: "Traslado hotel - Cerro Chapelco - hotel",
        durationMin: 90,
        priceCents: 2500000,
        currency: "ARS",
        category: "Invierno",
        description: "Traslado diario a Chapelco con busqueda por hotel y regreso incluido.",
        featured: true,
        isActive: true,
        bookingMode: "CHAPELCO",
        specialType: "CHAPELCO",
        serviceStartDate: new Date("2026-06-01T00:00:00.000Z"),
        serviceEndDate: new Date("2026-10-15T00:00:00.000Z"),
        stops: []
      }
    ]
  });

  const routes = await db.travelRoute.findMany({
    where: { id: { in: demoRoutes.map((route) => route.id) } },
    select: { id: true, slug: true }
  });
  const slugsById = new Map(routes.map((route) => [route.id, route.slug]));
  const schedules = demoRoutes.flatMap((route) => {
    if (slugsById.get(route.id) !== route.slug) return [];
    const durationMin = parseDurationMin(route.duration);
    return eachDateInclusive(route.serviceStart, route.serviceEnd).map((date) => {
      const departureAt = localDateTime(date, route.departureTime);
      return {
        id: `sched-${route.slug}-${dateKey(date)}`,
        routeId: route.id,
        vehicleId: VEHICLE_ID,
        departureAt,
        arrivalAt: addMinutes(departureAt, durationMin),
        status: "OPEN"
      };
    });
  });
  await db.schedule.createMany({ data: schedules, skipDuplicates: true });
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const prisma = new PrismaClient({ datasourceUrl: demoSeedDatabaseUrl(process.env) });
  try {
    await prisma.$transaction(async (db) => {
      await seedVehicle(db);
      await seedRoutesAndSchedules(db);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "No pudimos cargar la base de demostración.");
  process.exitCode = 1;
});

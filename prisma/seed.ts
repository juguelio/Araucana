import { PrismaClient } from "@prisma/client";
import { demoRoutes } from "./demo-routes";

const prisma = new PrismaClient();

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

async function seedVehicle() {
  await prisma.vehicle.upsert({
    where: { id: VEHICLE_ID },
    update: {
      name: "Araucana 24",
      brand: "Mercedes-Benz",
      model: "Sprinter Minibus 19+1",
      licensePlate: "ARAU-24",
      templateKey: "mercedes-sprinter-19",
      isActive: true
    },
    create: {
      id: VEHICLE_ID,
      name: "Araucana 24",
      brand: "Mercedes-Benz",
      model: "Sprinter Minibus 19+1",
      licensePlate: "ARAU-24",
      templateKey: "mercedes-sprinter-19",
      isActive: true
    }
  });

  for (let index = 1; index <= 24; index += 1) {
    const number = String(index).padStart(2, "0");

    await prisma.seat.upsert({
      where: {
        vehicleId_number: {
          vehicleId: VEHICLE_ID,
          number
        }
      },
      update: {
        row: Math.ceil(index / 4),
        column: ((index - 1) % 4) + 1
      },
      create: {
        vehicleId: VEHICLE_ID,
        number,
        row: Math.ceil(index / 4),
        column: ((index - 1) % 4) + 1
      }
    });
  }
}

async function clearDemoBookingData() {
  await prisma.payment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.passenger.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.travelRoute.deleteMany();
}

async function seedRoutesAndSchedules() {
  for (const route of demoRoutes) {
    const durationMin = parseDurationMin(route.duration);

    await prisma.travelRoute.create({
      data: {
        id: route.id,
        slug: route.slug,
        from: route.from,
        to: route.to,
        via: route.via,
        durationMin,
        priceCents: route.price * 100,
        currency: "ARS",
        category: route.category,
        description: route.description,
        featured: route.featured ?? false,
        isActive: true,
        stops: route.stops
      }
    });

    const serviceDates = eachDateInclusive(route.serviceStart, route.serviceEnd);

    await prisma.schedule.createMany({
      data: serviceDates.map((date) => {
        const departureAt = localDateTime(date, route.departureTime);

        return {
          id: `sched-${route.slug}-${dateKey(date)}`,
          routeId: route.id,
          vehicleId: VEHICLE_ID,
          departureAt,
          arrivalAt: addMinutes(departureAt, durationMin),
          status: "OPEN"
        };
      })
    });
  }

  await prisma.travelRoute.upsert({
    where: { slug: "chapelco" },
    update: {
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
    },
    create: {
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
  });
}

async function main() {
  await seedVehicle();
  await clearDemoBookingData();
  await seedRoutesAndSchedules();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

/**
 * Carga el servicio «San Martín de los Andes – Hua Hum y regreso» de la temporada 2027.
 *
 * Si ya hay una ruta activa con el mismo origen y destino (la del verano 2026, por ejemplo) la
 * reusa: le actualiza la tarifa y las fechas y le agrega las salidas que falten, en vez de dejar
 * dos «SMA → Hua Hum» en el panel.
 *
 * Datos del Excel de horarios (hoja «Verano 2027 Hua Hum»): del 2/1/2027 al 28/2/2027, todos los
 * días. Ida 10:30 → Yuco 11:30 → Hua Hum 12:00. Vuelta Hua Hum 17:00 → Yuco 17:30 → SMA 18:30.
 *
 * Tarifa provisoria 19-nov: $ 18.000 el viaje. Yuco queda como parada del recorrido, **sin tarifa
 * propia**: hasta que el cliente pase el precio de SMA–Yuco no se vende por separado (y para que se
 * venda tiene que ser menor que la tarifa del viaje, si no `getStopFares` la descarta).
 *
 * No migra ni borra nada: crea o actualiza las dos rutas por `slug` y agrega las salidas que
 * falten. Lo que ya existe con la misma ruta y la misma hora se saltea, así se puede correr dos veces.
 *
 *   npx tsx scripts/cargar-temporada-hua-hum.ts                        # muestra qué haría
 *   npx tsx scripts/cargar-temporada-hua-hum.ts --aplicar --vehicle <id>
 *   DATABASE_URL=postgresql://… npx tsx scripts/cargar-temporada-hua-hum.ts --aplicar --vehicle <id>
 */
import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const PRECIO_CENTS = 1_800_000;
const DESDE = "2027-01-02";
const HASTA = "2027-02-28";
const ZONA = "-03:00";

type Servicio = {
  slug: string;
  from: string;
  to: string;
  via: string;
  hora: string;
  duracionMin: number;
  stops: Array<{ name: string; km: number; minutes: number; note: string }>;
};

const SERVICIOS: Servicio[] = [
  {
    slug: "sma-hua-hum-verano-2027",
    from: "San Martin de los Andes",
    to: "Hua Hum",
    via: "Lago Lacar - Yuco",
    hora: "10:30",
    duracionMin: 90,
    stops: [
      { name: "S. M. Andes", km: 0, minutes: 0, note: "Sale 10:30" },
      { name: "Yuco", km: 0, minutes: 60, note: "Pasa 11:30" },
      { name: "Hua Hum", km: 0, minutes: 90, note: "Llega 12:00" }
    ]
  },
  {
    slug: "hua-hum-sma-verano-2027",
    from: "Hua Hum",
    to: "San Martin de los Andes",
    via: "Yuco - Lago Lacar",
    hora: "17:00",
    duracionMin: 90,
    stops: [
      { name: "Hua Hum", km: 0, minutes: 0, note: "Sale 17:00" },
      { name: "Yuco", km: 0, minutes: 30, note: "Pasa 17:30" },
      { name: "S. M. Andes", km: 0, minutes: 90, note: "Llega 18:30" }
    ]
  }
];

function dias(desde: string, hasta: string) {
  const salida: string[] = [];
  const cursor = new Date(`${desde}T00:00:00${ZONA}`);
  const fin = new Date(`${hasta}T00:00:00${ZONA}`);
  while (cursor <= fin) {
    salida.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return salida;
}

function arg(nombre: string) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");

  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "(inesperado)";
    }
  })();

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const naves = await prisma.vehicle.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
    const pedida = arg("--vehicle");
    // Sin --vehicle: la nave que ya corre este servicio; si no hay, la que más salidas tiene.
    const usada =
      (await prisma.schedule.groupBy({
        by: ["vehicleId"],
        where: { route: { from: SERVICIOS[0].from, to: SERVICIOS[0].to } },
        _count: { vehicleId: true },
        orderBy: { _count: { vehicleId: "desc" } },
        take: 1
      }))[0]?.vehicleId ??
      (await prisma.schedule.groupBy({
        by: ["vehicleId"],
        _count: { vehicleId: true },
        orderBy: { _count: { vehicleId: "desc" } },
        take: 1
      }))[0]?.vehicleId;
    const nave = pedida
      ? naves.find((n) => n.id === pedida || n.name.toLowerCase() === pedida.toLowerCase())
      : naves.find((n) => n.id === usada) ?? naves[0];

    if (!nave) {
      console.error(`No encontré la nave ${pedida ?? ""}. Hay ${naves.length}:`);
      for (const n of naves) console.error(`  ${n.id}  ${n.name}`);
      process.exitCode = 1;
      return;
    }

    const fechas = dias(DESDE, HASTA);
    console.log(`Base: ${host}`);
    console.log(`Temporada: ${DESDE} → ${HASTA} (${fechas.length} días) · tarifa $ ${(PRECIO_CENTS / 100).toLocaleString("es-AR")}`);
    console.log(`Nave: ${nave.name} (${nave.id})`);
    console.log(aplicar ? "Modo: APLICAR (escribe)" : "Modo: dry-run (no escribe; usá --aplicar)");
    console.log("");

    for (const servicio of SERVICIOS) {
      // Reusa la ruta del mismo origen y destino si ya está: una sola «SMA → Hua Hum» en el panel.
      const existente =
        (await prisma.travelRoute.findFirst({
          where: { from: servicio.from, to: servicio.to, isActive: true },
          select: { id: true, slug: true, priceCents: true }
        })) ?? (await prisma.travelRoute.findUnique({ where: { slug: servicio.slug }, select: { id: true, slug: true, priceCents: true } }));
      const salidas = existente
        ? await prisma.schedule.count({
            where: { routeId: existente.id, departureAt: { gte: new Date(`${DESDE}T00:00:00${ZONA}`), lte: new Date(`${HASTA}T23:59:59${ZONA}`) } }
          })
        : 0;
      const faltan = fechas.length - salidas;
      const nombreRuta = existente ? existente.slug : servicio.slug;
      console.log(
        `${servicio.from} → ${servicio.to}: ${existente ? `reusa ${nombreRuta} (tarifa $ ${(existente.priceCents / 100).toLocaleString("es-AR")} → $ ${(PRECIO_CENTS / 100).toLocaleString("es-AR")})` : `se crea ${nombreRuta}`}`
      );
      console.log(`  salidas ${salidas}/${fechas.length} de la temporada, faltan ${faltan}`);
      if (!aplicar) continue;

      const datos = {
        from: servicio.from,
        to: servicio.to,
        via: servicio.via,
        durationMin: servicio.duracionMin,
        priceCents: PRECIO_CENTS,
        currency: "ARS",
        category: "Verano",
        description: `Servicio ${servicio.from} - ${servicio.to} y regreso, temporada 2027.`,
        isActive: true,
        serviceStartDate: new Date(`${DESDE}T00:00:00${ZONA}`),
        serviceEndDate: new Date(`${HASTA}T00:00:00${ZONA}`),
        stops: servicio.stops
      };
      const ruta = existente
        ? await prisma.travelRoute.update({ where: { id: existente.id }, data: datos })
        : await prisma.travelRoute.create({ data: { slug: servicio.slug, ...datos } });

      let creadas = 0;
      for (const fecha of fechas) {
        const departureAt = new Date(`${fecha}T${servicio.hora}:00${ZONA}`);
        const ya = await prisma.schedule.findFirst({ where: { routeId: ruta.id, departureAt }, select: { id: true } });
        if (ya) continue;
        await prisma.schedule.create({
          data: {
            routeId: ruta.id,
            vehicleId: nave.id,
            departureAt,
            arrivalAt: new Date(departureAt.getTime() + servicio.duracionMin * 60_000),
            status: "OPEN"
          }
        });
        creadas += 1;
      }
      console.log(`  → ${creadas} salidas creadas (${servicio.hora} ${servicio.from} → ${servicio.to})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

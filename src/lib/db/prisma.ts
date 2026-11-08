import { PrismaClient, type Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/** Desde cuántos ms una consulta se anota como lenta en el log (evento consulta_lenta). */
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS) || 300;

function createClient() {
  const client = new PrismaClient({
    log: [
      { emit: "event", level: "query" },
      ...(process.env.NODE_ENV === "development" ? (["error", "warn"] as const) : (["error"] as const)).map((level) => ({ emit: "stdout" as const, level }))
    ]
  });
  // Sólo la forma de la consulta y su duración: nunca los parámetros (datos de pasajeros).
  client.$on("query", (event: Prisma.QueryEvent) => {
    if (event.duration >= SLOW_QUERY_MS) {
      console.warn(JSON.stringify({ evento: "consulta_lenta", ms: event.duration, sql: event.query.slice(0, 500) }));
    }
  });
  return client as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Corre un comando de Prisma sólo si `DATABASE_URL` apunta a una base local.
 *
 * Uso: `npm run prisma:push` (ya envuelto) o
 *      `DATABASE_URL="postgresql://…@127.0.0.1:5433/araucana_local" npx tsx scripts/local-db-only.ts prisma db push`
 *
 * No hay escape por variable de entorno: las operaciones que borran o reescriben datos no van
 * contra una base remota. Para producción se usan migraciones y backup/restore, no esto.
 */
import { spawnSync } from "node:child_process";
import { assertLocalDatabase } from "../src/lib/db/local-database";

const [command, ...args] = process.argv.slice(2);
const invocation = [command, ...args].filter(Boolean).join(" ");

if (!command) {
  console.error("[db-guard] Uso: tsx scripts/local-db-only.ts <comando> [...argumentos]");
  process.exit(2);
}

try {
  const target = assertLocalDatabase(process.env.DATABASE_URL, `«${invocation}»`);
  console.log(`[db-guard] base local ${target.host}/${target.database} → ${invocation}`);
} catch (error) {
  console.error(`[db-guard] BLOQUEADO: ${(error as Error).message}`);
  process.exit(1);
}

const result = spawnSync(command, args, { stdio: "inherit", env: process.env });

if (result.error) {
  console.error(`[db-guard] No se pudo ejecutar ${command}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

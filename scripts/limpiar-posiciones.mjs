/**
 * Borra el historial de posiciones más viejo que la retención (`RETENCION_DIAS`, 30 por defecto).
 *
 * Por qué existe: `DriverLocationSample` guarda una fila por cada reporte del panel del chofer (cada 3 s
 * ⇒ ~1.200 filas por hora por chofer) y hasta #321 no lo leía nadie, así que tampoco lo limpiaba nadie.
 * Sin purga, la base del cliente crece para siempre por un dato que el mapa sólo mira de las últimas 8 h.
 *
 * Reglas (mismas que `migrate-deploy.mjs`, por el mismo motivo):
 * - **No borra nada sin `CONFIRMAR=si`.** Imprime a qué base apunta y cuántas filas borraría (con
 *   `--dry-run` sólo cuenta). Borrar historial por accidente en la base del cliente no se deshace.
 * - Si el host parece de producción (Neon, o no es local) y no está `CONFIRMAR=si`, se niega.
 * - Usa `DIRECT_URL` si está: el pooler no hace falta para un DELETE largo.
 *
 * Uso:
 *   node scripts/limpiar-posiciones.mjs --dry-run          # cuenta, no borra
 *   CONFIRMAR=si node scripts/limpiar-posiciones.mjs       # borra de verdad
 */
import { PrismaClient } from "@prisma/client";

const RETENCION_DIAS = Number(process.env.RETENCION_DIAS ?? 30);
const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
const confirmado = process.env.CONFIRMAR === "si";

// Un valor inválido (vacío, "abc") o negativo no puede llegar al DELETE: `Date.now() - (-5 * día)` cae
// en el futuro y borraría TODO el historial, incluido el de hoy. Se valida antes de abrir la conexión.
if (!Number.isInteger(RETENCION_DIAS) || RETENCION_DIAS < 1) {
  console.error(`[limpieza] RETENCION_DIAS inválido: ${JSON.stringify(process.env.RETENCION_DIAS ?? 30)}. Tiene que ser un entero >= 1. No se toca nada.`);
  process.exit(1);
}

function describir(url) {
  try {
    const parsed = new URL(url);
    const base = (parsed.pathname || "").replace(/^\//, "");
    return `${parsed.hostname}/${base}`;
  } catch {
    return "(URL de base ilegible)";
  }
}

function esLocal(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("[limpieza] falta DATABASE_URL (o DIRECT_URL). No se toca nada.");
  process.exit(1);
}

const destino = describir(url);
const local = esLocal(url);
console.log(`[limpieza] destino: ${destino}${local ? " (local)" : " (NO local)"}`);
console.log(`[limpieza] retención: ${RETENCION_DIAS} días · modo: ${dryRun ? "contar" : "borrar"}`);

if (!dryRun && !confirmado) {
  console.error(
    "[limpieza] se niega a borrar sin CONFIRMAR=si. Probá primero con --dry-run para ver cuántas filas son."
  );
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });
const corte = new Date(Date.now() - RETENCION_DIAS * 24 * 60 * 60 * 1000);

try {
  const vencidas = await prisma.driverLocationSample.count({ where: { recordedAt: { lt: corte } } });
  const total = await prisma.driverLocationSample.count();
  console.log(`[limpieza] filas antes del ${corte.toISOString()}: ${vencidas} de ${total}`);

  if (vencidas === 0) {
    console.log("[limpieza] nada para borrar.");
  } else if (dryRun) {
    console.log("[limpieza] dry-run: no se borró nada.");
  } else {
    const { count } = await prisma.driverLocationSample.deleteMany({ where: { recordedAt: { lt: corte } } });
    console.log(`[limpieza] borradas ${count} filas. Quedan ${total - count}.`);
  }
} finally {
  await prisma.$disconnect();
}

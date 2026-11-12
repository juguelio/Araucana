/**
 * Aplica las migraciones pendientes durante el build de Vercel.
 *
 * Existe por el incidente del PR #56: el build era `prisma generate && next build`, así que un PR con
 * migración deployaba código que consultaba columnas que la base todavía no tenía → 500 en producción
 * y revert de emergencia (PR #60). Con esto, la migración corre antes de que el código salga: si la
 * migración falla, el deploy falla y sigue sirviendo la versión anterior.
 *
 * Reglas:
 * - Sólo corre en Vercel (`VERCEL=1`). Un `npm run build` local nunca migra nada: el `.env` de
 *   desarrollo apunta a la base compartida y no queremos que un build de escritorio la toque.
 * - `SKIP_MIGRATIONS=1` lo saltea a mano (emergencias, builds de preview sin base).
 * - Usa `DIRECT_URL` si está, porque DDL por el pooler de Neon falla o se cuelga; si no, `DATABASE_URL`.
 * - Sin URL de base, falla: un deploy sin base no puede servir nada.
 */
import { spawnSync } from "node:child_process";

/** Host y base, sin credenciales, para dejar rastro en el log del deploy. */
function describir(url) {
  try {
    const parsed = new URL(url);
    const base = (parsed.pathname || "").replace(/^\//, "");
    return `${parsed.hostname}/${base}${parsed.hostname.includes("-pooler") ? " (pooler)" : ""}`;
  } catch {
    return "(URL de base ilegible)";
  }
}

export function decidir(env = process.env) {
  if (env.VERCEL !== "1") {
    return { correr: false, motivo: "no es un build de Vercel: las migraciones no se aplican desde local" };
  }
  if (env.SKIP_MIGRATIONS === "1") {
    return { correr: false, motivo: "SKIP_MIGRATIONS=1" };
  }
  const url = env.DIRECT_URL || env.DATABASE_URL;
  if (!url) {
    return { correr: false, error: "falta DIRECT_URL y DATABASE_URL: no hay base contra la cual migrar" };
  }
  return { correr: true, url, motivo: `migrando ${describir(url)}${env.DIRECT_URL ? " (DIRECT_URL)" : " (DATABASE_URL)"}` };
}

function main() {
  const decision = decidir();

  if (decision.error) {
    console.error(`[migraciones] ${decision.error}`);
    process.exit(1);
  }

  if (!decision.correr) {
    console.log(`[migraciones] se saltea: ${decision.motivo}`);
    return;
  }

  console.log(`[migraciones] ${decision.motivo}`);
  const resultado = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: decision.url }
  });

  if (resultado.status !== 0) {
    console.error("[migraciones] falló `prisma migrate deploy`: el deploy se corta acá para no servir código contra una base sin migrar.");
    process.exit(resultado.status ?? 1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}

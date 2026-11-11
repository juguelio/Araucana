/**
 * Guarda de operaciones que reescriben el esquema o borran datos.
 *
 * El `.env` de este repo apunta a la Neon de producción. `npm run prisma:push` sin URL explícita
 * cargaría ese archivo y escribiría en la base del cliente. Esta guarda exige que `DATABASE_URL`
 * apunte a una base local y **no tiene escape por variable de entorno**.
 *
 * La carga demo (`prisma/seed.ts`) va por otro camino: exige `DEMO_DATABASE_URL` local y sólo
 * agrega filas que falten (`createMany skipDuplicates`), sin borrar nada — ver
 * `src/lib/db/demo-seed-target.ts`.
 */

export type DatabaseTarget = {
  host: string;
  database: string;
  isLocal: boolean;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export class UnsafeDatabaseTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDatabaseTargetError";
  }
}

/** Describe la base destino sin exponer credenciales. `null` si la URL no es válida. */
export function describeDatabaseTarget(url: string | undefined | null): DatabaseTarget | null {
  if (!url || !url.trim()) {
    return null;
  }

  try {
    const parsed = new URL(url.trim());
    if (!parsed.protocol.startsWith("postgres")) {
      return null;
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    const database = parsed.pathname.replace(/^\//, "") || "(sin nombre)";

    return { host, database, isLocal: LOCAL_HOSTS.has(host) };
  } catch {
    return null;
  }
}

/** Devuelve la base destino o lanza: fuera de `localhost` no se ejecuta nada. */
export function assertLocalDatabase(url: string | undefined | null, operation = "La operación"): DatabaseTarget {
  const target = describeDatabaseTarget(url);

  if (!target) {
    throw new UnsafeDatabaseTargetError(
      `${operation} necesita una DATABASE_URL válida y explícita a una base local. Ejemplo: ` +
        'DATABASE_URL="postgresql://usuario@127.0.0.1:5433/araucana_local" npm run prisma:push'
    );
  }

  if (!target.isLocal) {
    throw new UnsafeDatabaseTargetError(
      `${operation} reescribe el esquema o borra datos. ` +
        `Se niega a correr contra ${target.host}/${target.database}: sólo acepta 127.0.0.1 o localhost. ` +
        "Para una base remota usá migraciones aprobadas o un backup/restore, nunca esto."
    );
  }

  return target;
}

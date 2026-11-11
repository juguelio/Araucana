/**
 * Guarda de operaciones destructivas sobre la base.
 *
 * `prisma/seed.ts` **borra** reservas, pagos, pasajeros, salidas y rutas antes de cargar los datos
 * demo; `prisma db push` puede reescribir el esquema. Cuando el seed corrió con la `DATABASE_URL`
 * del `.env` (producción) se perdieron los datos reales.
 *
 * La regla es binaria y sin escape por variable de entorno: estas operaciones sólo aceptan una base
 * local. Para una base remota se usa backup/restore o un script que no borre nada.
 */

export type DatabaseTarget = {
  host: string;
  database: string;
  isLocal: boolean;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export class UnsafeSeedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeSeedTargetError";
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

/**
 * Devuelve la base destino o lanza. Se llama al empezar el seed **y** dentro de la función que borra
 * datos: si mañana alguien reordena el archivo o llama `clearDemoBookingData()` por su cuenta, sigue
 * bloqueado.
 */
export function assertLocalDatabase(url: string | undefined | null, operation = "El seed"): DatabaseTarget {
  const target = describeDatabaseTarget(url);

  if (!target) {
    throw new UnsafeSeedTargetError(
      `${operation} necesita una DATABASE_URL válida y explícita. Ejemplo: ` +
        'DATABASE_URL="postgresql://usuario@127.0.0.1:5433/araucana_local" npm run prisma:seed'
    );
  }

  if (!target.isLocal) {
    throw new UnsafeSeedTargetError(
      `${operation} borra o reescribe datos y después carga datos demo. ` +
        `Se niega a correr contra ${target.host}/${target.database}: sólo acepta 127.0.0.1 o localhost. ` +
        "Para una base remota usá un backup/restore o un script que no borre nada."
    );
  }

  return target;
}

/** Alias histórico: el seed. */
export function assertSeedTarget(url: string | undefined | null): DatabaseTarget {
  return assertLocalDatabase(url, "El seed");
}

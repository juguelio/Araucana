const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function databaseIdentity(url: URL) {
  const host = localHosts.has(url.hostname) ? "loopback" : url.hostname.replace(/-pooler(?=\.)/, "");
  return `${host}:${url.port || "5432"}${decodeURIComponent(url.pathname)}`;
}

export function demoSeedDatabaseUrl(env: Readonly<Record<string, string | undefined>>) {
  const target = env.DEMO_DATABASE_URL?.trim();
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    throw new Error("La carga de demostración está deshabilitada en producción.");
  }
  if (!target) {
    throw new Error("Configurá DEMO_DATABASE_URL con una base local de demostración.");
  }

  const url = new URL(target);
  const overridesHost = ["host", "hostaddr", "socket"].some((key) => url.searchParams.has(key));
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !localHosts.has(url.hostname) || url.pathname.length <= 1 || overridesHost) {
    throw new Error("DEMO_DATABASE_URL debe apuntar a una base PostgreSQL local.");
  }

  for (const configured of [env.DATABASE_URL, env.DATABASE_URL_UNPOOLED, env.DIRECT_URL]) {
    if (configured && databaseIdentity(url) === databaseIdentity(new URL(configured))) {
      throw new Error("La base de demostración coincide con la base habitual de Araucana.");
    }
  }

  return target;
}

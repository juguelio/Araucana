import { headers } from "next/headers";

/**
 * Origen absoluto del sitio para armar links que se comparten fuera de la app (el voucher que se manda
 * por WhatsApp, #166). Sale del request y no de una constante: el mismo código sirve en local, en el
 * preview de Vercel y en producción.
 */
export const FALLBACK_ORIGIN = "http://localhost:3200";

type Cabeceras = { get(nombre: string): string | null };

export function originFromHeaders(cabeceras: Cabeceras, fallback = FALLBACK_ORIGIN) {
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host");
  if (!host) return fallback;
  const protocolo =
    cabeceras.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocolo}://${host}`;
}

export async function siteOrigin() {
  return originFromHeaders(await headers());
}

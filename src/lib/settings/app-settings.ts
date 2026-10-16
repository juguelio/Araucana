import { prisma } from "@/lib/db/prisma";

/**
 * Configuración editable desde el panel.
 *
 * Existe para que una clave que antes vivía sólo en variables de entorno del hosting —y por lo
 * tanto dependía de que un tercero la cargara— se pueda pegar desde el panel. Si la variable de
 * entorno está presente, gana ella (así producción y desarrollo pueden diferir sin sorpresas).
 */

export const AIRLABS_KEY_SETTING = "airlabs.apiKey";

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const value = row?.value?.trim();
  return value ? value : null;
}

/** Guarda el valor; con `null` o vacío, borra la configuración. */
export async function setSetting(key: string, value: string | null, updatedBy?: string | null): Promise<void> {
  const limpio = (value ?? "").trim();
  if (!limpio) {
    await prisma.appSetting.deleteMany({ where: { key } });
    return;
  }

  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: limpio, updatedBy: updatedBy ?? null },
    update: { value: limpio, updatedBy: updatedBy ?? null }
  });
}

export type SecretSource = "env" | "panel" | "none";

export function resolveSecret(envValue: string | null | undefined, storedValue: string | null | undefined): string | null {
  return (envValue ?? "").trim() || (storedValue ?? "").trim() || null;
}

export function secretSource(envValue: string | null | undefined, storedValue: string | null | undefined): SecretSource {
  if ((envValue ?? "").trim()) return "env";
  if ((storedValue ?? "").trim()) return "panel";
  return "none";
}

/** Muestra sólo las puntas: al navegador nunca le llega la clave entera. */
export function maskSecret(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (v.length <= 8) return "••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

/** La clave de AirLabs efectiva: variable de entorno primero, panel después. */
export async function getAirLabsKey(): Promise<string | null> {
  return resolveSecret(process.env.AIRLABS_API_KEY, await getSetting(AIRLABS_KEY_SETTING).catch(() => null));
}

export async function airLabsKeyState(): Promise<{ key: string | null; source: SecretSource; masked: string | null }> {
  const stored = await getSetting(AIRLABS_KEY_SETTING).catch(() => null);
  const source = secretSource(process.env.AIRLABS_API_KEY, stored);
  const key = resolveSecret(process.env.AIRLABS_API_KEY, stored);
  return { key, source, masked: maskSecret(key) };
}

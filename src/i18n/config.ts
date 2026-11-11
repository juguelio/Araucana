/**
 * Idiomas de la web pública.
 *
 * El español no lleva prefijo (`/`, `/rutas`): las URLs de siempre siguen igual.
 * Inglés y portugués se sirven con prefijo (`/en`, `/en/rutas`, `/pt`, …) y el
 * middleware los reescribe a la misma página, así que no hay rutas duplicadas.
 */

export const LOCALES = ["es", "en", "pt"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";

/** Etiquetas cortas para el selector. */
export const LOCALE_LABELS: Record<Locale, string> = { es: "ES", en: "EN", pt: "PT" };

/** Nombre del idioma en su propio idioma, para el `aria-label` del selector. */
export const LOCALE_NAMES: Record<Locale, string> = { es: "Español", en: "English", pt: "Português" };

/** Tags BCP-47 para `<html lang>` y `hreflang`. */
export const LOCALE_TAGS: Record<Locale, string> = { es: "es-AR", en: "en", pt: "pt-BR" };

export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** `/rutas` + `en` → `/en/rutas`. El idioma por defecto se queda sin prefijo. */
export function localizePath(path: string, locale: Locale): string {
  const conBarra = path.startsWith("/") ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return conBarra || "/";
  return conBarra === "/" ? `/${locale}` : `/${locale}${conBarra}`;
}

/** `/pt/rutas?x=1` → `{ locale: "pt", path: "/rutas?x=1" }`. Sin prefijo: idioma por defecto. */
export function splitLocale(pathnameWithSearch: string): { locale: Locale; path: string } {
  const [pathname, search] = pathnameWithSearch.split("?");
  const [first, ...rest] = pathname.split("/").filter(Boolean);
  if (isLocale(first)) {
    const resto = rest.length ? `/${rest.join("/")}` : "/";
    return { locale: first, path: search ? `${resto}?${search}` : resto };
  }
  return { locale: DEFAULT_LOCALE, path: pathnameWithSearch || "/" };
}

/** Rutas que nunca se traducen: panel, auth, API y archivos. */
export const PRIVATE_PREFIXES = [
  "/admin",
  "/api",
  "/login",
  "/app",
  "/chofer",
  "/registro",
  "/acceso-pendiente",
  "/inicializar-admin",
  "/_next",
  "/_vercel"
] as const;

export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Headers internos que deja el middleware: idioma resuelto y ruta sin prefijo. */
export const LOCALE_HEADER = "x-araucana-locale";
export const PATH_HEADER = "x-araucana-path";

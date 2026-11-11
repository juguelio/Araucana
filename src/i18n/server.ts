import { headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_HEADER, PATH_HEADER, isLocale, type Locale } from "./config";
import { getDictionary, type Dictionary } from "./dictionaries";

/** Idioma de la request actual, resuelto por el middleware. */
export async function getLocale(): Promise<Locale> {
  const value = (await headers()).get(LOCALE_HEADER);
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getI18n(): Promise<{ locale: Locale; dict: Dictionary }> {
  const locale = await getLocale();
  return { locale, dict: getDictionary(locale) };
}

/** Ruta pública actual, sin el prefijo de idioma (para `hreflang` y el selector). */
export async function currentPath(): Promise<string> {
  return (await headers()).get(PATH_HEADER) ?? "/";
}

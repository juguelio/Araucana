"use client";

import { usePathname } from "next/navigation";
import { LOCALES, LOCALE_LABELS, LOCALE_NAMES, localizePath, splitLocale } from "@/i18n/config";
import "./language-switcher.css";

/**
 * Selector ES / EN / PT. Conserva la página en la que está el visitante.
 *
 * Va con `<a href>` y no con `next/link` a propósito: los tres idiomas se sirven
 * con la MISMA página (el middleware reescribe `/en/rutas` a `/rutas`), así que
 * la navegación cliente reusa el payload cacheado del otro idioma y el sitio
 * queda con los textos anteriores. La recarga completa resetea el caché del
 * router y además actualiza el `lang` del documento.
 */
export function LanguageSwitcher({ label, switchTo }: { label: string; switchTo: string }) {
  const { locale, path } = splitLocale(usePathname() || "/");

  return (
    <nav className="language-switcher" aria-label={label}>
      {LOCALES.map((item) => (
        <a
          key={item}
          href={localizePath(path, item)}
          hrefLang={item}
          title={`${switchTo} ${LOCALE_NAMES[item]}`}
          aria-current={item === locale ? "true" : undefined}
        >
          {LOCALE_LABELS[item]}
        </a>
      ))}
    </nav>
  );
}

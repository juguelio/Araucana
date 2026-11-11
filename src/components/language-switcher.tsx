"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOCALES, LOCALE_LABELS, LOCALE_NAMES, localizePath, splitLocale } from "@/i18n/config";
import "./language-switcher.css";

/** Selector ES / EN / PT. Conserva la página en la que está el visitante. */
export function LanguageSwitcher({ label, switchTo }: { label: string; switchTo: string }) {
  const { locale, path } = splitLocale(usePathname() || "/");

  return (
    <nav className="language-switcher" aria-label={label}>
      {LOCALES.map((item) => (
        <Link
          key={item}
          href={localizePath(path, item)}
          hrefLang={item}
          title={`${switchTo} ${LOCALE_NAMES[item]}`}
          aria-current={item === locale ? "true" : undefined}
          onClick={(event) => {
            // Sin recarga completa: el locale se resuelve en el servidor con la navegación.
            if (item === locale) event.preventDefault();
          }}
        >
          {LOCALE_LABELS[item]}
        </Link>
      ))}
    </nav>
  );
}

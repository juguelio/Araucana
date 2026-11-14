"use client";

import Link from "next/link";
import { useState } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";

type Labels = { open: string; close: string; menu: string; whatsapp: string; language: string; switchTo: string };

/**
 * Menú mobile. Los anclajes llegan con "/" delante: desde /rutas o /en/rutas, un
 * "#servicios" relativo no lleva a ninguna sección de la portada.
 */
export function MobileNav({ items, labels }: { items: { label: string; href: string }[]; labels: Labels }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="mobile-menu-button" type="button" aria-expanded={open} aria-controls="mobile-navigation" aria-label={open ? labels.close : labels.open} onClick={() => setOpen(!open)}><span /><span /><span /></button>
      {open && (
        <div className="mobile-navigation" id="mobile-navigation">
          <nav aria-label={labels.menu}>
            {items.map((item) => <Link href={item.href} key={`${item.href}:${item.label}`} onClick={() => setOpen(false)}>{item.label}</Link>)}
            <a className="mobile-whatsapp" href="https://wa.me/5492944649049" target="_blank" rel="noreferrer">{labels.whatsapp} ↗</a>
            <LanguageSwitcher label={labels.language} switchTo={labels.switchTo} />
          </nav>
        </div>
      )}
    </>
  );
}

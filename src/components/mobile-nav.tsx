"use client";

import Link from "next/link";
import { useState } from "react";

// Los anclajes van con "/" delante: desde /rutas o /reservas/... un "#servicios" relativo no lleva a
// ninguna sección de la portada.
const items = [["Inicio", "/"], ["Traslados", "/rutas"], ["Servicios", "/#servicios"], ["Destinos", "/#destinos"], ["Grupos y empresas", "/#contacto"], ["Nosotros", "/#nosotros"], ["Contacto", "/#contacto"]];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return <><button className="mobile-menu-button" type="button" aria-expanded={open} aria-controls="mobile-navigation" aria-label={open ? "Cerrar menú" : "Abrir menú"} onClick={() => setOpen(!open)}><span /><span /><span /></button>{open && <div className="mobile-navigation" id="mobile-navigation"><nav aria-label="Navegación mobile">{items.map(([label, href]) => <Link href={href} key={label} onClick={() => setOpen(false)}>{label}</Link>)}<a className="mobile-whatsapp" href="https://wa.me/5492944649049" target="_blank" rel="noreferrer">WhatsApp ↗</a></nav></div>}</>;
}

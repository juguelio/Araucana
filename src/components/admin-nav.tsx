"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type AdminNavLink = { href: string; label: string };

/**
 * Enlaces del panel con la sección actual marcada (`aria-current="page"`). Es un componente cliente
 * porque además de `usePathname` necesita saber si la tira horizontal sigue más allá del borde
 * (en pantallas angostas el menú es una fila deslizable y sin barra visible). Los enlaces y los
 * roles los decide `AdminShell`.
 */
export function AdminNav({ links }: { links: AdminNavLink[] }) {
  const pathname = usePathname() ?? "";
  const actual = (href: string) => (href === "/" ? false : href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));

  const scroller = useRef<HTMLDivElement>(null);
  const [bordes, setBordes] = useState({ izquierda: false, derecha: false });

  const medir = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const maximo = el.scrollWidth - el.clientWidth;
    setBordes({
      izquierda: el.scrollLeft > 4,
      derecha: maximo > 4 && el.scrollLeft < maximo - 4,
    });
  }, []);

  useEffect(() => {
    medir();
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      el.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
    };
  }, [medir]);

  /** Al entrar a una sección, su enlace se trae a la vista: si está fuera de la tira, el menú
   *  parecía no marcar nada. */
  useEffect(() => {
    const activo = scroller.current?.querySelector('[aria-current="page"]');
    activo?.scrollIntoView({ block: "nearest", inline: "center" });
    medir();
  }, [pathname, medir]);

  const desplazar = (direccion: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: direccion * Math.round(el.clientWidth * 0.7), behavior: "smooth" });
  };

  return (
    <div className="admin-nav-row" data-izquierda={bordes.izquierda} data-derecha={bordes.derecha}>
      <div className="admin-nav-scroller" ref={scroller}>
        <nav aria-label="Administracion">
          {links.map((link) => (
            <Link href={link.href} key={link.href} aria-current={actual(link.href) ? "page" : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      {bordes.izquierda ? (
        <button type="button" className="admin-nav-step" data-dir="atras" aria-label="Ver las secciones anteriores" onClick={() => desplazar(-1)}>
          <span aria-hidden="true">‹</span>
        </button>
      ) : null}
      {bordes.derecha ? (
        <button type="button" className="admin-nav-step" data-dir="adelante" aria-label="Ver más secciones" onClick={() => desplazar(1)}>
          <span aria-hidden="true">›</span>
        </button>
      ) : null}
    </div>
  );
}

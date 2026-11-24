"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type AdminNavLink = { href: string; label: string; activeFor?: string[]; externo?: boolean };
export type AdminNavGrupo = { titulo: string | null; enlaces: AdminNavLink[] };

/**
 * Enlaces del panel con la sección actual marcada (`aria-current="page"`), en grupos con su título
 * (24-nov). Es un componente cliente porque además de `usePathname` necesita saber si la tira
 * horizontal sigue más allá del borde: en pantallas angostas el menú es una fila deslizable y sin
 * barra visible, y ahí los títulos no se ven (los grupos quedan separados por una línea). Los
 * enlaces, los grupos y los roles los decide `AdminShell`.
 */
export function AdminNav({ grupos }: { grupos: AdminNavGrupo[] }) {
  const pathname = usePathname() ?? "";
  const actual = (link: AdminNavLink) => {
    const prefijos = link.activeFor?.length ? link.activeFor : [link.href];
    return prefijos.some((href) =>
      href === "/" ? false : href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`)
    );
  };

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
        <nav aria-label="Administración">
          {grupos.map((grupo, indice) => (
            <div
              className="admin-nav-grupo"
              key={grupo.titulo ?? `grupo-${indice}`}
              role="group"
              aria-labelledby={grupo.titulo ? `admin-nav-${indice}` : undefined}
              data-pie={grupo.enlaces.every((link) => link.externo) || undefined}
            >
              {grupo.titulo ? (
                <span className="admin-nav-titulo" id={`admin-nav-${indice}`}>{grupo.titulo}</span>
              ) : null}
              {grupo.enlaces.map((link) =>
                link.externo ? (
                  <a href={link.href} key={link.href} target="_blank" rel="noopener" className="admin-nav-externo">
                    {link.label} <span aria-hidden="true">↗</span>
                    <span className="sr-only"> (se abre en otra pestaña)</span>
                  </a>
                ) : (
                  <Link href={link.href} key={link.href} aria-current={actual(link) ? "page" : undefined}>
                    {link.label}
                  </Link>
                )
              )}
            </div>
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

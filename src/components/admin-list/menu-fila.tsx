"use client";

import { useEffect, useRef, type ReactNode } from "react";
import "./menu-fila.css";

/**
 * Menú «⋯» de una fila de un listado del panel (reservas, naves): las acciones que no son la
 * principal (editar, cancelar, WhatsApp, comprobante…) quedan acá en vez de ocupar la fila.
 *
 * Es un `<details>`, así que abre y cierra sin JavaScript; esto sólo lo cierra al tocar afuera o con
 * Escape. Los modales de adentro se dibujan en el `body` (portal), así que siguen abiertos aunque el
 * menú se cierre.
 */
export function MenuFila({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const cerrarAfuera = (event: PointerEvent) => {
      if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    const cerrarConEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.open) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", cerrarAfuera);
    document.addEventListener("keydown", cerrarConEscape);
    return () => {
      document.removeEventListener("pointerdown", cerrarAfuera);
      document.removeEventListener("keydown", cerrarConEscape);
    };
  }, []);

  return (
    <details className="menu-fila" ref={ref}>
      <summary className="menu-fila-boton" aria-label={etiqueta} title={etiqueta}>
        ⋯
      </summary>
      <div
        className="menu-fila-lista"
        onClick={(event) => {
          // Elegir una opción cierra el menú (el modal que abra sigue abierto: está en el body).
          // «Copiar voucher» (`data-mantener`) no lo cierra: así se ve el «¡Voucher copiado!».
          const destino = event.target as HTMLElement;
          if (destino.closest("[data-mantener]")) return;
          if (destino.closest("a, button") && ref.current) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}

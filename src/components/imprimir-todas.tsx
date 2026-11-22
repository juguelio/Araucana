"use client";

import { useEffect, useRef } from "react";

function imprimirTodas() {
  // Si antes se imprimió una sola orden, se saca esa marca para que salgan todas.
  document.documentElement.removeAttribute("data-imprimir-una");
  document.querySelectorAll("[data-imprimir]").forEach((nodo) => nodo.removeAttribute("data-imprimir"));
  window.print();
}

/**
 * «Imprimir todas»: cada orden de la pantalla empieza en su propia hoja. Con `alAbrir`
 * (la hoja de varios vuelos marcados en Aeropuerto) el diálogo de impresión se abre solo, una vez.
 */
export function ImprimirTodas({ alAbrir = false, cantidad }: { alAbrir?: boolean; cantidad: number }) {
  const yaImprimio = useRef(false);
  useEffect(() => {
    if (!alAbrir) return;
    // Un respiro para que el navegador termine de armar la página antes del diálogo. La marca se pone
    // al imprimir (no antes) porque React puede montar el efecto dos veces y cancelar la primera espera.
    const espera = window.setTimeout(() => {
      if (yaImprimio.current) return;
      yaImprimio.current = true;
      imprimirTodas();
    }, 300);
    return () => window.clearTimeout(espera);
  }, [alAbrir]);

  return (
    <button className="button" type="button" onClick={imprimirTodas}>
      {cantidad === 1 ? "Imprimir" : `Imprimir las ${cantidad} órdenes`}
    </button>
  );
}

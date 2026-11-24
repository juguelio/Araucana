"use client";

function imprimirTodas() {
  // Si antes se imprimió una sola orden, se saca esa marca para que salgan todas.
  document.documentElement.removeAttribute("data-imprimir-una");
  document.querySelectorAll("[data-imprimir]").forEach((nodo) => nodo.removeAttribute("data-imprimir"));
  window.print();
}

/** Abre la impresión de la selección actual. */
export function ImprimirTodas({ cantidad }: { cantidad: number }) {
  return (
    <button className="button" type="button" onClick={imprimirTodas}>
      {cantidad === 1 ? "Imprimir" : `Imprimir las ${cantidad} órdenes`}
    </button>
  );
}

"use client";

/**
 * Botón de impresión de la orden de servicio. Va como client component porque `window.print()` no
 * existe del lado del servidor; no manda nada al backend.
 */
export function ImprimirButton() {
  return (
    <button className="ghost-button no-print" type="button" onClick={() => window.print()}>
      Imprimir
    </button>
  );
}

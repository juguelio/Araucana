"use client";

/** Imprimir/guardar en PDF el voucher (#166). En papel sale sólo el documento, sin menú ni botones. */
export function PrintButton() {
  return (
    <button className="button" type="button" onClick={() => window.print()}>
      Imprimir o guardar en PDF
    </button>
  );
}

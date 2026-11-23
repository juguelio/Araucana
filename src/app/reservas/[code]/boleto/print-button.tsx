"use client";

/** Imprime la copia del boleto (#370). En papel salen los tres cuerpos, sin menú ni botones. */
export function PrintButton() {
  return (
    <button className="button" type="button" onClick={() => window.print()}>
      Imprimir o guardar en PDF
    </button>
  );
}

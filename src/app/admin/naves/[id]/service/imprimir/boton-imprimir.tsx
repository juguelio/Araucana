"use client";

export function BotonImprimir() {
  return <button type="button" className="button" onClick={() => window.print()}>Imprimir</button>;
}

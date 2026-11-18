"use client";

import { useSyncExternalStore } from "react";
import { hojaDelChoferHref } from "@/lib/airport/flight-selection";

/**
 * Vuelos marcados en Aeropuerto, por día. Cada tarjeta tiene su casilla y su «Hoja del chofer»; si el
 * vuelo está marcado junto con otros, la hoja abre las órdenes de todos los marcados juntas, para
 * imprimirlas en las menos hojas posibles. Vive en memoria: al recargar la página se vacía.
 */
const marcados = new Map<string, string[]>();
const oyentes = new Set<() => void>();
const VACIO: string[] = [];

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

function alternar(date: string, flightId: string) {
  const actuales = marcados.get(date) ?? VACIO;
  marcados.set(date, actuales.includes(flightId) ? actuales.filter((id) => id !== flightId) : [...actuales, flightId]);
  oyentes.forEach((oyente) => oyente());
}

function useMarcados(date: string) {
  return useSyncExternalStore(suscribir, () => marcados.get(date) ?? VACIO, () => VACIO);
}

export function MarcarVuelo({ date, flightId, flightNumber }: { date: string; flightId: string; flightNumber: string }) {
  const seleccion = useMarcados(date);
  return (
    <label className="aero-marcar" title="Marcá varios vuelos para imprimir sus hojas del chofer juntas">
      <input
        type="checkbox"
        checked={seleccion.includes(flightId)}
        onChange={() => alternar(date, flightId)}
        aria-label={`Seleccionar ${flightNumber} para la hoja del chofer`}
      />
      <span>Juntar</span>
    </label>
  );
}

export function HojaDelChofer({ date, flightId }: { date: string; flightId: string }) {
  const seleccion = useMarcados(date);
  const juntos = seleccion.includes(flightId) && seleccion.length > 1;
  return (
    <a
      className="ghost-button"
      href={hojaDelChoferHref(date, juntos ? seleccion : [flightId])}
      target="_blank"
      rel="noreferrer"
      title={juntos
        ? `Hojas del chofer de los ${seleccion.length} vuelos marcados, juntas para imprimir`
        : "Hoja del chofer de este vuelo: verla, imprimirla o descargarla en Excel"}
    >
      {juntos ? `Hoja del chofer (${seleccion.length} vuelos)` : "Hoja del chofer"}
    </a>
  );
}

"use client";

import { useState } from "react";
import { hojaDelChoferHref } from "@/lib/airport/flight-selection";
import { RowModal } from "../reservas/row-modal";

export type VueloParaLaHoja = {
  id: string;
  number: string;
  /** «Llega 13:25» / «Sale 16:00». */
  hora: string;
  pasajeros: number;
  /** Los otros vuelos de su recorrida: se imprimen juntos porque la hoja los une en una orden. */
  recorrida: string[];
};

/**
 * «Hoja del chofer» de un vuelo: abre un modal con todos los vuelos del día que tienen pasajeros, con
 * el propio (y los de su recorrida) ya marcados. Se marcan los que se quieren imprimir juntos y la hoja
 * se abre en otra pestaña con todas sus órdenes, para imprimirlas en las menos hojas posibles.
 * Reemplaza a la casilla «Juntar» de cada tarjeta.
 */
export function HojaDelChoferModal({ date, vuelo, vuelos }: { date: string; vuelo: VueloParaLaHoja; vuelos: VueloParaLaHoja[] }) {
  const iniciales = vuelos.filter((item) => item.id === vuelo.id || vuelo.recorrida.includes(item.number)).map((item) => item.id);
  const [marcados, setMarcados] = useState<string[]>(iniciales);
  const alternar = (id: string) => setMarcados((actuales) => (actuales.includes(id) ? actuales.filter((item) => item !== id) : [...actuales, id]));
  // La hoja respeta el orden del día, no el orden en que se marcaron.
  const elegidos = vuelos.filter((item) => marcados.includes(item.id)).map((item) => item.id);

  return (
    <RowModal
      trigger="Hoja del chofer"
      triggerLabel={`Hoja del chofer del ${vuelo.number}`}
      triggerClassName="ghost-button"
      modalClassName="aero-coordinar-modal"
      eyebrow="Imprimir"
      title={`Hoja del chofer · ${vuelo.number}`}
      subtitle="Marcá los vuelos que querés imprimir juntos: la hoja se abre en otra pestaña con la orden de cada uno, en las menos hojas posibles."
    >
      <div className="reservas-modal-form aero-coordinar-form">
        <fieldset>
          <legend>Vuelos del día con pasajeros</legend>
          {vuelos.map((item) => (
            <label key={item.id} className="aero-coordinar-vuelo">
              <input type="checkbox" checked={marcados.includes(item.id)} onChange={() => alternar(item.id)} />
              <span>
                <strong>{item.number}</strong> · {item.hora} · {item.pasajeros} {item.pasajeros === 1 ? "pasajero" : "pasajeros"}
                {item.recorrida.length ? ` · recorrida con ${item.recorrida.join(", ")}` : ""}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="form-actions">
          {elegidos.length ? (
            <a className="button" href={hojaDelChoferHref(date, elegidos)} target="_blank" rel="noreferrer">
              {elegidos.length === 1 ? "Abrir hoja del chofer" : `Abrir hoja del chofer (${elegidos.length} vuelos)`}
            </a>
          ) : (
            <span className="muted">Marcá al menos un vuelo.</span>
          )}
          <button className="ghost-button" type="button" onClick={() => setMarcados(vuelos.map((item) => item.id))}>Marcar todos</button>
          <button className="ghost-button" type="button" onClick={() => setMarcados([])}>Ninguno</button>
        </div>
      </div>
    </RowModal>
  );
}

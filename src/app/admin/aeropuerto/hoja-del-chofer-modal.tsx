"use client";

import { useState } from "react";
import { claveDeOrden, hojaDeOrdenesHref, type OrdenElegida } from "@/lib/airport/flight-selection";
import { RowModal } from "../reservas/row-modal";

/**
 * Una orden del día, como la imprime la hoja del chofer: la de un vuelo o, en una recorrida que sale con
 * varias combis, la de cada combi (con gente de todos sus vuelos).
 */
export type OrdenParaLaHoja = OrdenElegida & {
  /** Los vuelos de la orden: el propio, o todos los de la recorrida. */
  flightIds: string[];
  /** «AR1657 + JA3184». */
  vuelos: string;
  /** «recorrida 13:30» (partidas) / «llega 15:20» (arribos). */
  hora: string;
  /** «1913 · Escobar Joel Miguel A», «sin nave asignada» o `null` si el vuelo no tiene combi. */
  combi: string | null;
  pasajeros: number;
};

/**
 * «Hoja del chofer» de un vuelo: un modal con las órdenes del día, una por combi en las recorridas (lo que
 * recibe cada chofer), con las de este vuelo ya marcadas. Las marcadas se abren juntas en otra pestaña,
 * listas para imprimir con una hoja por orden.
 */
export function HojaDelChoferModal({ date, flightId, flightNumber, ordenes }: {
  date: string;
  flightId: string;
  flightNumber: string;
  ordenes: OrdenParaLaHoja[];
}) {
  const iniciales = ordenes.filter((orden) => orden.flightIds.includes(flightId)).map(claveDeOrden);
  const [marcadas, setMarcadas] = useState<string[]>(iniciales);
  const alternar = (clave: string) =>
    setMarcadas((actuales) => (actuales.includes(clave) ? actuales.filter((item) => item !== clave) : [...actuales, clave]));
  // La hoja respeta el orden del día, no el orden en que se marcaron.
  const elegidas = ordenes.filter((orden) => marcadas.includes(claveDeOrden(orden)));

  return (
    <RowModal
      trigger="Hoja del chofer"
      triggerLabel={`Hoja del chofer del ${flightNumber}`}
      triggerClassName="ghost-button"
      modalClassName="aero-coordinar-modal"
      eyebrow="Imprimir"
      title={`Hoja del chofer · ${flightNumber}`}
      subtitle="Marcá las órdenes que querés imprimir juntas. En una recorrida con varias combis hay una orden por combi, con su chofer y los pasajeros de todos sus vuelos."
    >
      <div className="reservas-modal-form aero-coordinar-form">
        <fieldset>
          <legend>Órdenes del día</legend>
          {ordenes.map((orden) => {
            const clave = claveDeOrden(orden);
            return (
              <label key={clave} className="aero-coordinar-vuelo">
                <input type="checkbox" checked={marcadas.includes(clave)} onChange={() => alternar(clave)} />
                <span>
                  <strong>{orden.vuelos}</strong> · {orden.hora}
                  {orden.combi ? <> · <strong>{orden.combi}</strong></> : null} · {orden.pasajeros} {orden.pasajeros === 1 ? "pasajero" : "pasajeros"}
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="form-actions">
          {elegidas.length ? (
            <a className="button" href={hojaDeOrdenesHref(date, elegidas)} target="_blank" rel="noreferrer">
              {elegidas.length === 1 ? "Abrir hoja del chofer" : `Abrir hoja del chofer (${elegidas.length} órdenes)`}
            </a>
          ) : (
            <span className="muted">Marcá al menos una orden.</span>
          )}
          <button className="ghost-button" type="button" onClick={() => setMarcadas(ordenes.map(claveDeOrden))}>Marcar todas</button>
          <button className="ghost-button" type="button" onClick={() => setMarcadas([])}>Ninguna</button>
        </div>
      </div>
    </RowModal>
  );
}

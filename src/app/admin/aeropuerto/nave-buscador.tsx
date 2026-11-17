"use client";

import { useState } from "react";

export type NaveElegible = {
  id: string;
  name: string;
  /** Butacas que vende para el aeropuerto (las chicas dejan 4 para el equipaje). */
  seats: number;
  internalNumber: string | null;
  licensePlate: string | null;
};

const normalizar = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Lista de naves con buscador para el modal de la combi del vuelo: se escribe el nombre, el interno o
 * la patente y se elige con un toque. Va dentro del formulario de asignación (`vehicleId`).
 */
export function NaveBuscador({ naves, flightNumber }: { naves: NaveElegible[]; flightNumber: string }) {
  const [busqueda, setBusqueda] = useState("");
  const termino = normalizar(busqueda);
  const visibles = termino
    ? naves.filter((nave) => normalizar([nave.name, nave.internalNumber, nave.licensePlate].filter(Boolean).join(" ")).includes(termino))
    : naves;

  return (
    <div className="nave-buscador">
      <label className="nave-buscador-campo">
        Buscar nave
        <input
          type="search"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          placeholder="Nombre, interno o patente"
          autoComplete="off"
          aria-label={`Buscar nave para ${flightNumber}`}
        />
      </label>
      <div className="nave-buscador-lista" role="radiogroup" aria-label={`Naves para ${flightNumber}`}>
        {visibles.length === 0 ? (
          <p className="muted">Ninguna nave coincide con «{busqueda}».</p>
        ) : (
          visibles.map((nave) => (
            <label key={nave.id} className="nave-buscador-opcion">
              <input type="radio" name="vehicleId" value={nave.id} required />
              <span>
                <strong>{nave.name}</strong>
                <small className="muted">
                  {[nave.internalNumber ? `Int. ${nave.internalNumber}` : null, nave.licensePlate, `${nave.seats} lugares para aeropuerto`]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

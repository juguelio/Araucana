"use client";

import { useState } from "react";

export type ChoferElegible = {
  id: string;
  /** Nombre, o el email si no tiene nombre cargado. */
  label: string;
  email: string;
};

const normalizar = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Lista de choferes con buscador, igual que la de naves (`NaveBuscador`): se escribe el nombre o el
 * email y se elige con un toque. «Sin chofer» queda siempre arriba y es la opción por defecto. Va
 * dentro del formulario de asignación (`driverId`).
 */
export function ChoferBuscador({ choferes, flightNumber }: { choferes: ChoferElegible[]; flightNumber: string }) {
  const [busqueda, setBusqueda] = useState("");
  const termino = normalizar(busqueda);
  const visibles = termino
    ? choferes.filter((chofer) => normalizar(`${chofer.label} ${chofer.email}`).includes(termino))
    : choferes;

  return (
    <div className="nave-buscador">
      <label className="nave-buscador-campo">
        Buscar chofer
        <input
          type="search"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          placeholder="Nombre o email"
          autoComplete="off"
          aria-label={`Buscar chofer para ${flightNumber}`}
        />
      </label>
      <div className="nave-buscador-lista" role="radiogroup" aria-label={`Choferes para ${flightNumber}`}>
        <label className="nave-buscador-opcion">
          <input type="radio" name="driverId" value="" defaultChecked />
          <span>
            <strong>Sin chofer</strong>
            <small className="muted">Se puede asignar después</small>
          </span>
        </label>
        {visibles.length === 0 ? (
          <p className="muted">Ningún chofer coincide con «{busqueda}».</p>
        ) : (
          visibles.map((chofer) => (
            <label key={chofer.id} className="nave-buscador-opcion">
              <input type="radio" name="driverId" value={chofer.id} />
              <span>
                <strong>{chofer.label}</strong>
                {chofer.label !== chofer.email ? <small className="muted">{chofer.email}</small> : null}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

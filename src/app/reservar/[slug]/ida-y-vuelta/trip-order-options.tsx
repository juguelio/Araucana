"use client";

import { OPCIONES_DE_ORDEN, type OrdenDeViaje } from "./trip-order";

/**
 * El control del orden del viaje (#189): las dos opciones visibles al mismo tiempo, con la elegida
 * marcada. Antes había una sola flecha en el medio de la barra, que invertía el orden y vaciaba los
 * vuelos ya elegidos; el cliente lo reportó como «me la anula».
 */
export function TripOrderOptions({
  orden,
  onElegir,
  aviso
}: {
  orden: OrdenDeViaje;
  onElegir: (nuevo: OrdenDeViaje) => void;
  aviso?: string;
}) {
  return (
    <>
      <div className="trip-order-options" role="radiogroup" aria-label="Orden del viaje">
        {OPCIONES_DE_ORDEN.map((opcion) => {
          const elegida = opcion.valor === orden;
          return (
            <button
              key={opcion.valor}
              type="button"
              role="radio"
              aria-checked={elegida}
              className="trip-order-option"
              data-elegido={elegida}
              onClick={() => onElegir(opcion.valor)}
            >
              <span className="trip-order-option-marca" aria-hidden="true">{elegida ? "✓" : ""}</span>
              <b className="trip-order-option-titulo">{opcion.titulo}</b>
              <span className="trip-order-option-ruta">{opcion.ruta}</span>
              <span className="trip-order-option-ayuda">{opcion.ayuda}</span>
            </button>
          );
        })}
      </div>
      {aviso ? <p className="trip-order-aviso" role="status">{aviso}</p> : null}
    </>
  );
}

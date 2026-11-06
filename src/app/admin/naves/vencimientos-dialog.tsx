"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import type { ComplianceLevel } from "@/lib/vehicles/compliance";

export type FilaVencimiento = {
  tipo: string;
  /** dd/mm/aaaa · "—" si la unidad no tiene la fecha cargada. */
  fecha: string;
  /** "Vencido hace 3 días" · "Vence en 21 días" · "Al día" · "Sin dato". */
  estado: string;
  level: ComplianceLevel | null;
};

type VencimientosDialogProps = {
  /** Cómo se llama la unidad en la lista (interno y/o nombre). */
  unidad: string;
  /** Patente y modelo, para no confundir dos unidades parecidas. */
  detalle: string;
  /** Los tres papeles, ya ordenados por urgencia. */
  filas: FilaVencimiento[];
  /** Cuántos papeles están vencidos o por vencer: el número del botón. */
  pendientes: number;
  /** Peor nivel de la unidad, para pintar el botón. */
  nivel: ComplianceLevel | null;
  editarHref: string;
};

/**
 * Botón de vencimientos por unidad: el detalle de lo que hay que renovar se abre en un modal.
 * La alerta vive en la fila de cada nave (no en un bloque aparte de la página) y el botón la
 * mantiene visible sin ocupar lugar: número en rojo si hay algo vencido, ámbar si está por vencer.
 */
export function VencimientosDialog({ unidad, detalle, filas, pendientes, nivel, editarHref }: VencimientosDialogProps) {
  const [abierto, setAbierto] = useState(false);
  const tituloId = useId();

  useEffect(() => {
    if (!abierto) return;
    const alPresionar = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAbierto(false);
    };
    document.addEventListener("keydown", alPresionar);
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", alPresionar);
      document.body.style.overflow = overflowPrevio;
    };
  }, [abierto]);

  const tono = nivel ?? "ok";
  // Sin ninguna fecha cargada no hay "al día" que afirmar: el botón lo dice con un guion.
  const conFechas = filas.some((fila) => fila.level !== null);
  const estadoBoton = pendientes > 0 ? tono : conFechas ? "ok" : "sin-dato";
  const etiquetaBoton = pendientes > 0 ? pendientes : conFechas ? "OK" : "—";

  return (
    <>
      <button
        className="fleet-docs-button"
        type="button"
        data-nivel={estadoBoton}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        title="Papeles vencidos o que vencen dentro de los próximos 90 días"
        onClick={() => setAbierto(true)}
      >
        Vencimientos
        <span className="fleet-docs-count" data-nivel={estadoBoton}>
          {etiquetaBoton}
        </span>
      </button>

      {abierto
        ? createPortal(
            <div className="fleet-docs-backdrop" role="presentation" onClick={() => setAbierto(false)}>
              <div
                className="fleet-docs-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={tituloId}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="fleet-docs-head">
                  <div>
                    <span className="eyebrow">Vencimientos</span>
                    <h2 id={tituloId}>{unidad}</h2>
                    <p className="muted">{detalle}</p>
                  </div>
                  <button
                    className="fleet-docs-close"
                    type="button"
                    aria-label="Cerrar"
                    onClick={() => setAbierto(false)}
                  >
                    ×
                  </button>
                </div>

                <ul className="fleet-docs-list">
                  {filas.map((fila) => (
                    <li className="fleet-docs-row" data-nivel={fila.level ?? "sin-dato"} key={fila.tipo}>
                      <span className="fleet-docs-tipo">{fila.tipo}</span>
                      <span className="fleet-docs-fecha">{fila.fecha}</span>
                      <span className="fleet-docs-estado">{fila.estado}</span>
                    </li>
                  ))}
                </ul>

                <div className="fleet-docs-foot">
                  <p className="muted">
                    Renovar no bloquea la venta: es para mover el trámite antes de que la unidad quede parada.
                  </p>
                  <Link className="ghost-button" href={editarHref}>
                    Cargar fechas
                  </Link>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

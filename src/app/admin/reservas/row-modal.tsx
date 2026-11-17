"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type RowModalProps = {
  /** Lo que se ve en la celda: la etiqueta de estado, el nombre del comprobante, un botón. */
  trigger: ReactNode;
  /** Texto accesible del disparador, para cuando la celda sólo muestra una etiqueta. */
  triggerLabel: string;
  triggerClassName?: string;
  /** Clase extra del modal, para un formulario más ancho (por ejemplo, cargar un vuelo). */
  modalClassName?: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Los formularios del modal. Se arman en el servidor, con sus server actions. */
  children: ReactNode;
};

/**
 * Modal de una fila del listado de reservas: la celda (estado, pago, comprobante) se vuelve un
 * botón que abre las opciones de esa reserva sin salir del listado. Los formularios de adentro son
 * los mismos server actions del detalle, con `listQuery` para volver al listado filtrado.
 */
export function RowModal({ trigger, triggerLabel, triggerClassName = "reservas-celda-boton", modalClassName, eyebrow, title, subtitle, children }: RowModalProps) {
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

  return (
    <>
      <button
        className={triggerClassName}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={() => setAbierto(true)}
      >
        {trigger}
      </button>
      {abierto
        ? createPortal(
            <div className="fleet-docs-backdrop" role="presentation" onClick={() => setAbierto(false)}>
              <div
                className={`fleet-docs-modal reservas-modal${modalClassName ? ` ${modalClassName}` : ""}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={tituloId}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="fleet-docs-head">
                  <div>
                    <span className="eyebrow">{eyebrow}</span>
                    <h2 id={tituloId}>{title}</h2>
                    {subtitle ? <p className="muted">{subtitle}</p> : null}
                  </div>
                  <button className="fleet-docs-close" type="button" aria-label="Cerrar" onClick={() => setAbierto(false)}>
                    ×
                  </button>
                </div>
                <div className="reservas-modal-body">{children}</div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

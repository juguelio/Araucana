"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";

/**
 * Botón de cancelar/borrar de una reserva (#108).
 *
 * Cancelar pide el motivo antes de enviar: el cliente pidió saber por qué se canceló y que quede
 * escrito. El texto va en un campo oculto del mismo formulario, así el server action lo recibe y lo
 * guarda en la reserva; el servidor lo vuelve a exigir, no depende de este prompt.
 */
export function ConfirmReservationButton({ operation, compact = false }: { operation: "cancel" | "delete"; compact?: boolean }) {
  const { pending } = useFormStatus();
  const deleting = operation === "delete";
  const reasonRef = useRef<HTMLInputElement>(null);

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (deleting) {
      if (!window.confirm("¿Borrar definitivamente esta reserva?")) event.preventDefault();
      return;
    }

    const reason = window.prompt("Motivo de la cancelación (queda guardado en la reserva):");
    if (reason === null) {
      event.preventDefault();
      return;
    }
    const motivo = reason.trim();
    if (motivo.length < 3) {
      event.preventDefault();
      window.alert("Escribí el motivo de la cancelación (al menos 3 caracteres).");
      return;
    }
    if (reasonRef.current) reasonRef.current.value = motivo;
  }

  return (
    <>
      {deleting ? null : <input ref={reasonRef} name="reason" type="hidden" defaultValue="" />}
      <button
        className={`${deleting ? "danger-button" : "ghost-button"}${compact ? " table-action" : ""}`}
        type="submit"
        name="operation"
        value={operation}
        disabled={pending}
        aria-label={deleting ? "Borrar reserva" : "Cancelar reserva"}
        onClick={handleClick}
      >
        {deleting ? "Borrar" : "Cancelar"}{compact ? "" : " reserva"}
      </button>
    </>
  );
}

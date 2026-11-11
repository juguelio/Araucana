"use client";

import { useFormStatus } from "react-dom";

export function ConfirmReservationButton({ operation, compact = false }: { operation: "cancel" | "delete"; compact?: boolean }) {
  const { pending } = useFormStatus();
  const deleting = operation === "delete";
  return (
    <button
      className={`${deleting ? "danger-button" : "ghost-button"}${compact ? " table-action" : ""}`}
      type="submit"
      name="operation"
      value={operation}
      disabled={pending}
      aria-label={deleting ? "Borrar reserva" : "Cancelar reserva"}
      onClick={(event) => {
        if (!window.confirm(deleting ? "¿Borrar definitivamente esta reserva?" : "¿Cancelar esta reserva y liberar sus lugares?")) {
          event.preventDefault();
        }
      }}
    >
      {deleting ? "Borrar" : "Cancelar"}{compact ? "" : " reserva"}
    </button>
  );
}

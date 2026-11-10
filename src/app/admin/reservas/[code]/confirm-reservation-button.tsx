"use client";

export function ConfirmReservationButton({ operation }: { operation: "cancel" | "delete" }) {
  const deleting = operation === "delete";
  return (
    <button
      className={deleting ? "danger-button" : "ghost-button"}
      type="submit"
      onClick={(event) => {
        if (!window.confirm(deleting ? "¿Borrar definitivamente esta reserva?" : "¿Cancelar esta reserva y liberar sus lugares?")) {
          event.preventDefault();
        }
      }}
    >
      {deleting ? "Borrar reserva" : "Cancelar reserva"}
    </button>
  );
}

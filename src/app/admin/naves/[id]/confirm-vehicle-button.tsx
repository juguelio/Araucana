"use client";

import { useFormStatus } from "react-dom";

/**
 * Botón de la ficha de la nave que pide confirmación antes de enviar: inactivar la saca de las
 * salidas que se pueden asignar, y borrar no se deshace. Archivar (cuando ya tuvo viajes) avisa que
 * la nave queda inactiva en vez de desaparecer.
 */
export function ConfirmVehicleButton({ label, pregunta, className }: { label: string; pregunta: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(pregunta)) event.preventDefault();
      }}
    >
      {pending ? "Guardando…" : label}
    </button>
  );
}

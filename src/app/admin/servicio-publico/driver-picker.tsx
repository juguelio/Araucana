"use client";

import { useActionState } from "react";
import { savePublicServiceDriverAction, type DriverState } from "./actions";

type Driver = { id: string; name: string | null; email: string };

/** Selector de chofer por salida: el mismo dato de «Salidas del día», a mano en la boletería. */
export function DriverPicker({
  scheduleId,
  driverId,
  drivers,
  fecha,
  terminal
}: {
  scheduleId: string;
  driverId: string | null;
  drivers: Driver[];
  fecha: string;
  terminal: string | null;
}) {
  const [state, formAction, pending] = useActionState<DriverState, FormData>(savePublicServiceDriverAction, {});

  return (
    <form action={formAction} className="sp-chofer-form">
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <input type="hidden" name="fecha" value={fecha} />
      {terminal ? <input type="hidden" name="terminal" value={terminal} /> : null}
      <select name="driverId" defaultValue={driverId ?? ""} aria-label="Chofer de la salida">
        <option value="">Sin chofer</option>
        {drivers.map((driver) => (
          <option key={driver.id} value={driver.id}>
            {driver.name?.trim() || driver.email}
          </option>
        ))}
      </select>
      <button className="ghost-button" type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Asignar"}
      </button>
      {state.error ? <span className="sp-error" role="alert">{state.error}</span> : null}
    </form>
  );
}

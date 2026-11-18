"use client";

import { startTransition, useActionState } from "react";
import { DropSelect, OriginField } from "./dispatch-desk";
import { FleetConflictWarning } from "../fleet-assignment-form";
import { saveScheduleCrewAction, type CrewState } from "./actions";

export type Option = { id: string; label: string };

/** Nave y chofer de una salida de ruta en una fila: dos selectores y un botón. */
export function ScheduleCrewForm({ scheduleId, unitKind = "PRIMARY", dateKey, vehicleId, driverId, vehicles, drivers }: {
  /** La salida (nave principal) o la nave que se le sumó, según `unitKind`. */
  scheduleId: string;
  unitKind?: "PRIMARY" | "EXTRA";
  dateKey: string;
  vehicleId: string;
  driverId: string | null;
  vehicles: Option[];
  drivers: Option[];
}) {
  const [state, dispatch, pending] = useActionState<CrewState, FormData>(saveScheduleCrewAction, {});
  return (
    // Como FleetAssignmentForm: el botón «Confirmar y guardar» manda su valor (la confirmación).
    <form className="sd-crew" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget, event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : undefined);
      startTransition(() => dispatch(data));
    }}>
      <OriginField />
      <input type="hidden" name="id" value={scheduleId} />
      <input type="hidden" name="kind" value={unitKind} />
      <input type="hidden" name="date" value={dateKey} />
      <label>
        <span>Nave</span>
        <DropSelect name="vehicleId" defaultValue={vehicleId}>
          {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>)}
        </DropSelect>
      </label>
      <label>
        <span>Chofer</span>
        <DropSelect name="driverId" defaultValue={driverId ?? ""} data-falta={!driverId || undefined}>
          <option value="">Sin chofer</option>
          {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.label}</option>)}
        </DropSelect>
      </label>
      <button className="ghost-button" type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</button>
      {state.error ? <p className="sd-error" role="alert">{state.error}</p> : null}
      <FleetConflictWarning conflicts={state.conflicts} confirmation={state.confirmation} />
    </form>
  );
}

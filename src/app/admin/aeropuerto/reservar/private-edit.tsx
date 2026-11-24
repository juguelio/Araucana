"use client";

import { useState, useActionState } from "react";
import type { PrivateStop } from "@/lib/airport/private-transfer";
import { PrivateStopsFields, type PrivateVehicleOption } from "./private-stops-fields";
import { updatePrivateTransfer } from "./private-edit-action";

export function PrivateTransferEdit({ code, initialStops, initialVehicle, vehicles }: {
  code: string; initialStops: PrivateStop[]; initialVehicle: string | null; vehicles: PrivateVehicleOption[];
}) {
  const [stops, setStops] = useState(initialStops);
  const [vehicle, setVehicle] = useState(initialVehicle ?? "");
  const [result, save, pending] = useActionState(async () => updatePrivateTransfer(code, stops, initialVehicle !== null && vehicle !== initialVehicle ? { previous: initialVehicle, next: vehicle } : null), { ok: "" });
  return <form action={save}>
    <fieldset disabled={pending} className="private-transfer-fields">
      <PrivateStopsFields stops={stops} onChange={setStops} vehicles={vehicles} vehicleId={vehicle} onVehicle={initialVehicle === null ? undefined : setVehicle} />
      <button className="button" type="submit">{pending ? "Guardando…" : initialVehicle === null ? "Guardar paradas" : "Guardar paradas y nave"}</button>
    </fieldset>
    {result.error && <p role="alert">{result.error}</p>}
    {result.ok && <p role="status">{result.ok}</p>}
  </form>;
}

"use client";

import { useActionState } from "react";
import type { AirportExtras } from "@/lib/airport/extras";
import { initialAdminFormState } from "../../form-state";
import { saveExtrasAction } from "./actions";

const pesos = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

export function ExtrasEditor({ initialExtras }: { initialExtras: AirportExtras }) {
  const [result, save, pending] = useActionState(saveExtrasAction, initialAdminFormState);
  const errors = result.fieldErrors;

  return (
    <form action={save}>
      <h2>Extras y corte de reservas</h2>
      <p className="muted">Se suman a la tarifa por persona en los dos sentidos del traslado. Cada reserva guarda el valor vigente al momento de reservar.</p>
      <div className="checkout-fields">
        <label>Recargo por zona (ARS por reserva)
          <input name="zoneExtra" inputMode="decimal" defaultValue={pesos(initialExtras.zoneExtraCents)} aria-invalid={Boolean(errors.zoneExtra)} />
          <small className="muted">Se cobra cuando el punto cae en el perímetro con recargo (naranja) y el mapa está aplicado.</small>
          {errors.zoneExtra ? <span className="field-error" role="alert">{errors.zoneExtra}</span> : null}
        </label>
        <label>Equipaje deportivo (ARS por bulto)
          <input name="sportsLuggage" inputMode="decimal" defaultValue={pesos(initialExtras.sportsLuggageCents)} aria-invalid={Boolean(errors.sportsLuggage)} />
          <small className="muted">Esquí, snowboard, bicicleta, tabla. En 0 no se ofrece en el checkout.</small>
          {errors.sportsLuggage ? <span className="field-error" role="alert">{errors.sportsLuggage}</span> : null}
        </label>
        <label>Cierre de reservas de arribos (minutos antes de aterrizar)
          <input name="arrivalCutoff" type="number" min={0} max={180} step={1} defaultValue={initialExtras.arrivalCutoffMinutes} aria-invalid={Boolean(errors.arrivalCutoff)} />
          <small className="muted">Si el vuelo está demorado se cuenta desde el horario estimado.</small>
          {errors.arrivalCutoff ? <span className="field-error" role="alert">{errors.arrivalCutoff}</span> : null}
        </label>
      </div>
      <div className="form-actions">
        <button className="button" type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar extras"}</button>
      </div>
      {result.message ? <p role="status" className={result.status === "error" ? "field-error" : "muted"}>{result.message}</p> : null}
    </form>
  );
}

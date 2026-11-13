"use client";

import { useActionState } from "react";
import type { AirportOfficePickup } from "@/lib/airport/office-pickup";
import { initialAdminFormState } from "../../form-state";
import { saveOfficePickupAction } from "./actions";

export function OfficePickupEditor({ initialPickup }: { initialPickup: AirportOfficePickup }) {
  const [result, save, pending] = useActionState(saveOfficePickupAction, initialAdminFormState);
  const errors = result.fieldErrors;
  const [lat, lng] = initialPickup.point ?? [null, null];

  return (
    <form action={save}>
      <h2>Salir desde la sucursal</h2>
      <p className="muted">
        Atajo del checkout del aeropuerto: con un toque deja el traslado apuntando a la oficina, en vez de
        buscar la dirección a mano. Aparece sólo si está activo y tiene un punto.
      </p>
      <div className="checkout-fields">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" name="enabled" defaultChecked={initialPickup.enabled} />
          Mostrar el atajo en el checkout
        </label>
        <label>Nombre del atajo
          <input name="label" defaultValue={initialPickup.label} maxLength={60} aria-invalid={Boolean(errors.label)} />
          <small className="muted">Se lee en el botón: «Salir desde …» / «Ir a …».</small>
          {errors.label ? <span className="field-error" role="alert">{errors.label}</span> : null}
        </label>
        <label>Dirección de la oficina
          <input name="address" defaultValue={initialPickup.address} maxLength={160} aria-invalid={Boolean(errors.address)} />
          <small className="muted">Es la dirección que queda en la reserva y en la orden de servicio del chofer.</small>
          {errors.address ? <span className="field-error" role="alert">{errors.address}</span> : null}
        </label>
        <label>Latitud
          <input name="lat" inputMode="decimal" defaultValue={lat ?? ""} placeholder="-40.1571" aria-invalid={Boolean(errors.point)} />
        </label>
        <label>Longitud
          <input name="lng" inputMode="decimal" defaultValue={lng ?? ""} placeholder="-71.3521" aria-invalid={Boolean(errors.point)} />
          <small className="muted">Se copian del mapa (clic derecho sobre la oficina → «copiar coordenadas»).</small>
          {errors.point ? <span className="field-error" role="alert">{errors.point}</span> : null}
        </label>
      </div>
      <div className="form-actions">
        <button className="button" type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar atajo"}</button>
      </div>
      {result.message ? <p role="status" className={result.status === "error" ? "field-error" : "muted"}>{result.message}</p> : null}
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { AirportDraggableMap } from "@/components/airport-draggable-map";
import { AirportGooglePickup } from "@/components/airport-google-pickup";
import { AirportPlaceSearch, type AirportSelectedPlace } from "@/components/airport-place-search";
import { googlePickupConfigured } from "@/lib/airport/google-maps";
import { isInsideAirportPickupZone, OUTSIDE_PICKUP_ZONE, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import { AdminFormAlert } from "../../form-ui";
import { initialAdminFormState, type AdminFormState } from "../../form-state";

type PickupAddressFormProps = {
  action: (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
  code: string;
  address: string;
  point: PickupPoint | null;
  coverage: AirportCoverage;
  airport: boolean;
};

export function PickupAddressForm({ action, code, address, point, coverage, airport }: PickupAddressFormProps) {
  const [state, formAction, pending] = useActionState(action, initialAdminFormState);
  const [text, setText] = useState(address);
  const [pin, setPin] = useState(point);
  const [approximate, setApproximate] = useState(false);
  const [reference, setReference] = useState<AirportSelectedPlace | null>(null);
  const [useGoogle, setUseGoogle] = useState(googlePickupConfigured);
  const [confirmed, setConfirmed] = useState(false);
  const maxLength = airport ? 160 : 180;
  const outside = pin && coverage.enabled && !isInsideAirportPickupZone(pin, coverage);

  function markPoint(nextPoint: PickupPoint) {
    setPin(nextPoint);
    setApproximate(false);
    setReference(null);
    setConfirmed(false);
  }

  function selectPlace(place: AirportSelectedPlace) {
    const google = place.source === "google";
    setText(google ? "" : place.label.slice(0, maxLength));
    setPin(google ? null : place.point);
    setReference(google ? place : null);
    setApproximate(place.approximate);
    setConfirmed(false);
  }

  return (
    <form className="admin-form-grid" action={formAction}>
      <AdminFormAlert state={state} />
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="latitude" value={pin?.[0] ?? ""} />
      <input type="hidden" name="longitude" value={pin?.[1] ?? ""} />
      <AirportPlaceSearch coverage={coverage} useGoogle={useGoogle} disabled={pending}
        onChange={() => { setConfirmed(false); setReference(null); }} onSelect={selectPlace} />
      {useGoogle ? (
        <AirportGooglePickup coverage={coverage} point={pin} reference={reference} approximate={approximate}
          disabled={pending} onPoint={markPoint} onUnavailable={() => setUseGoogle(false)} />
      ) : (
        <AirportDraggableMap point={pin} approximate={approximate} disabled={pending} onSelect={markPoint}
          onMove={(nextPoint) => { markPoint(nextPoint); return true; }} />
      )}
      {outside ? <p className="form-alert error" role="status">{OUTSIDE_PICKUP_ZONE}</p> : null}
      <label className="span-2">
        {airport ? "Dirección o referencia (opcional)" : "Dirección"}
        <input name="address" autoComplete="street-address" maxLength={maxLength}
          required={!airport} value={text} disabled={pending}
          onChange={(event) => { setText(event.target.value); setConfirmed(false); }} />
      </label>
      {pin && !outside ? (
        <label style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center" }}>
          <input type="checkbox" name="confirmed" checked={confirmed} disabled={pending}
            style={{ width: "auto", minHeight: 0 }} onChange={(event) => setConfirmed(event.target.checked)} />
          Confirmo que el mapa marca el lugar correcto
        </label>
      ) : null}
      <div className="form-actions" style={{ gridColumn: "1 / -1" }}>
        <button type="submit" className="button" disabled={pending || !pin || !confirmed || Boolean(outside)}>
          {pending ? "Guardando…" : "Guardar dirección"}
        </button>
      </div>
    </form>
  );
}

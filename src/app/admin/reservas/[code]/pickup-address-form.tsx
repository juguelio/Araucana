"use client";

import { useState } from "react";
import { AirportDraggableMap } from "@/components/airport-draggable-map";
import { AirportGooglePickup } from "@/components/airport-google-pickup";
import { AirportPlaceSearch, type AirportSelectedPlace } from "@/components/airport-place-search";
import type { PickupPrecision } from "@/lib/airport/place-suggestions";
import { googlePickupConfigured } from "@/lib/airport/google-maps";
import { OUTSIDE_PICKUP_ZONE, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import { PICKUP_WITHOUT_POINT, type PickupAddressDraft } from "./pickup-address";

export type { PickupAddressDraft } from "./pickup-address";

type PickupAddressFieldsProps = {
  pickup: PickupAddressDraft;
  coverage: AirportCoverage;
  airport: boolean;
  changed: boolean;
  outside: boolean;
  disabled: boolean;
  onChange: (pickup: PickupAddressDraft) => void;
};

export function PickupAddressFields({ pickup, coverage, airport, changed, outside, disabled, onChange }: PickupAddressFieldsProps) {
  const [approximate, setApproximate] = useState(false);
  const [precision, setPrecision] = useState<PickupPrecision | null>(null);
  const [reference, setReference] = useState<{ point: PickupPoint; approximate: boolean } | null>(null);
  const [useGoogle, setUseGoogle] = useState(googlePickupConfigured);
  const maxLength = airport ? 160 : 180;
  const { address, point, confirmed } = pickup;

  function markPoint(nextPoint: PickupPoint) {
    setApproximate(false);
    setReference(null);
    onChange({ ...pickup, point: nextPoint, confirmed: false });
  }

  function selectPlace(place: AirportSelectedPlace) {
    const google = place.source === "google";
    // Google siempre resuelve el punto; las sugerencias sin coordenadas (calle del
    // nomenclador que ningún geocoder ubica) sólo completan el domicilio.
    setReference(google && place.point ? { point: place.point, approximate: place.approximate } : null);
    setApproximate(place.approximate);
    setPrecision(place.precision);
    onChange({
      address: google ? "" : place.label.slice(0, maxLength),
      point: google ? null : place.point,
      confirmed: false
    });
  }

  /**
   * El nombre del alojamiento que el buscador no encuentra se carga tal cual (#268): queda como
   * texto, sin inventar coordenadas. Sólo el aeropuerto lo admite así.
   */
  function useTypedText(text: string) {
    setReference(null);
    setApproximate(false);
    setPrecision("none");
    onChange({ address: text.trim().slice(0, maxLength), point: null, confirmed: false });
  }

  return (
    <>
      <AirportPlaceSearch coverage={coverage} useGoogle={useGoogle} disabled={disabled}
        onChange={() => { setReference(null); }} onSelect={selectPlace}
        onUseText={airport ? useTypedText : undefined} />
      {useGoogle ? (
        <AirportGooglePickup coverage={coverage} point={point} reference={reference} approximate={approximate}
          disabled={disabled} onPoint={markPoint} onUnavailable={() => setUseGoogle(false)} />
      ) : (
        <AirportDraggableMap point={point} approximate={approximate} precision={precision} disabled={disabled} onSelect={markPoint}
          onMove={(nextPoint) => { markPoint(nextPoint); return true; }} />
      )}
      {changed && outside ? <p className="form-alert error" role="status">{OUTSIDE_PICKUP_ZONE}</p> : null}
      {changed && !point ? (
        <p className="muted reservation-edit-wide" role="status">
          {airport ? PICKUP_WITHOUT_POINT : "Marcá el nuevo punto en el mapa."}
        </p>
      ) : null}
      <label className="span-2">
        {airport ? "Dirección o referencia (opcional)" : "Dirección"}
        <input name="address" autoComplete="street-address" maxLength={maxLength} value={address} disabled={disabled}
          onChange={(event) => onChange({ ...pickup, address: event.target.value, confirmed: false })} />
      </label>
      {changed && point && !outside ? (
        <label className="reservation-edit-confirm reservation-edit-wide">
          <input type="checkbox" name="confirmed" checked={confirmed} disabled={disabled}
            onChange={(event) => onChange({ ...pickup, confirmed: event.target.checked })} />
          Confirmo que el mapa marca el lugar correcto
        </label>
      ) : null}
    </>
  );
}

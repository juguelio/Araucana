"use client";

import { useState } from "react";
import { MapPointAddress } from "@/components/map-point-address";
import { AirportDraggableMap } from "@/components/airport-draggable-map";
import { AirportGooglePickup } from "@/components/airport-google-pickup";
import { AirportPlaceSearch, type AirportSelectedPlace } from "@/components/airport-place-search";
import type { PickupPrecision } from "@/lib/airport/place-suggestions";
import { googlePickupConfigured } from "@/lib/airport/google-maps";
import { OUTSIDE_PICKUP_ZONE, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import { FieldError } from "../../form-ui";
import { PICKUP_WITHOUT_POINT, type PickupAddressDraft } from "./pickup-address";

export type { PickupAddressDraft } from "./pickup-address";

type PickupAddressFieldsProps = {
  pickup: PickupAddressDraft;
  coverage: AirportCoverage;
  airport: boolean;
  changed: boolean;
  outside: boolean;
  disabled: boolean;
  addressError?: string;
  pointError?: string;
  onChange: (pickup: PickupAddressDraft) => void;
  onLodgingName: (name: string) => void;
};

export function PickupAddressFields({ pickup, coverage, airport, changed, outside, disabled, addressError, pointError, onChange, onLodgingName }: PickupAddressFieldsProps) {
  const [approximate, setApproximate] = useState(false);
  const [precision, setPrecision] = useState<PickupPrecision | null>(null);
  const [reference, setReference] = useState<{ point: PickupPoint; approximate: boolean } | null>(null);
  const [useGoogle, setUseGoogle] = useState(googlePickupConfigured);
  const [manual, setManual] = useState<{ point: PickupPoint; pending: boolean } | null>(null);
  const maxLength = airport ? 160 : 180;
  const { address, point, confirmed } = pickup;
  const showConfirmation = changed && point && !outside;
  const mapError = changed && outside ? OUTSIDE_PICKUP_ZONE
    : changed && !point && !airport ? "Marcá el nuevo punto en el mapa."
    : showConfirmation && !confirmed ? "Confirmá que el marcador está en el lugar correcto para guardar."
    : pointError;
  const textError = addressError ?? (changed && airport && !point && !address.trim()
    ? "Escribí una dirección o marcá el punto en el mapa." : undefined);

  function markPoint(nextPoint: PickupPoint) {
    setApproximate(false);
    setReference(null);
    setManual({ point: nextPoint, pending: true });
    setPrecision("exact");
    onChange({ ...pickup, address: "", point: nextPoint, confirmed: false });
  }

  function selectPlace(place: AirportSelectedPlace) {
    setManual(null);
    if (place.lodgingName) onLodgingName(place.lodgingName.slice(0, 120));
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
    setManual(null);
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
      {manual && manual.point === point ? <MapPointAddress point={point} onResult={(address) => {
        setManual({ point, pending: false });
        onChange({ ...pickup, address: address.slice(0, maxLength) });
      }} /> : null}
      {!showConfirmation && mapError ? <div className="reservation-edit-wide">
        <FieldError id="reservation-pickup-point-error" message={mapError} />
      </div> : null}
      {changed && airport && !point && address.trim() ? (
        <p className="muted reservation-edit-wide" role="status">{PICKUP_WITHOUT_POINT}</p>
      ) : null}
      <label className="span-2">
        {airport ? "Dirección o referencia (opcional)" : "Dirección"}
        <input name="address" autoComplete="street-address" maxLength={maxLength} value={address} disabled={disabled}
          aria-invalid={Boolean(textError)} aria-describedby={textError ? "reservation-pickup-address-error" : undefined}
          onChange={(event) => { setManual(null); onChange({ ...pickup, address: event.target.value, confirmed: false }); }} />
        <FieldError id="reservation-pickup-address-error" message={textError} />
      </label>
      {showConfirmation ? (
        <div className="reservation-edit-wide">
          <label className="reservation-edit-confirm">
            <input type="checkbox" name="confirmed" checked={confirmed} disabled={disabled || manual?.pending}
              aria-invalid={Boolean(mapError)} aria-describedby={mapError ? "reservation-pickup-point-error" : undefined}
              onChange={(event) => onChange({ ...pickup, confirmed: event.target.checked })} />
            Confirmo que el mapa marca el lugar correcto
          </label>
          <FieldError id="reservation-pickup-point-error" message={mapError} />
        </div>
      ) : null}
    </>
  );
}

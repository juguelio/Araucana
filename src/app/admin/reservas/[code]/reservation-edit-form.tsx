"use client";

import { useActionState, useState } from "react";
import { isInsideAirportPickupZone, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import type { PassengerDto } from "@/lib/booking/types";
import { AdminFormAlert, FieldError } from "../../form-ui";
import { errorState, initialAdminFormState, type AdminFormState } from "../../form-state";
import { PassengerFields, type PassengerDraft } from "./passenger-form";
import { PickupAddressFields, type PickupAddressDraft } from "./pickup-address-form";

type ReservationEditFormProps = {
  action: (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
  code: string;
  passenger: PassengerDto;
  financial?: { operation: "price" | "correctPayment"; currency: string; total: string; method: string; reference: string };
  /** Quién derivó la venta (#109); vacío cuando la reserva se vendió directo. */
  referredBy: string;
  transfer?: { address: string; point: PickupPoint | null; notes: string; airport: boolean; direction?: string; coverage: AirportCoverage };
};

export function ReservationEditForm({ action, code, passenger, transfer, financial, referredBy: initialReferredBy }: ReservationEditFormProps) {
  const [draft, setDraft] = useState<PassengerDraft>({ ...passenger, nationality: passenger.nationality ?? "" });
  const [pickup, setPickup] = useState<PickupAddressDraft>({
    address: transfer?.address ?? "", point: transfer?.point ?? null, confirmed: false
  });
  const [notes, setNotes] = useState(transfer?.notes ?? "");
  const [total, setTotal] = useState(financial?.total ?? "");
  const [method, setMethod] = useState(financial?.method ?? "");
  const [reference, setReference] = useState(financial?.reference ?? "");
  const [referredBy, setReferredBy] = useState(initialReferredBy);
  const priceChanged = Boolean(financial && total.trim() !== financial.total);
  const methodChanged = financial?.operation === "correctPayment" && method.trim() !== financial.method;
  const referenceChanged = financial?.operation === "correctPayment" && reference.trim() !== financial.reference;
  const changedPassenger = (Object.keys(draft) as (keyof PassengerDraft)[])
    .filter((field) => draft[field].trim() !== (passenger[field] ?? "").trim());
  const addressChanged = pickup.address.trim() !== (transfer?.address ?? "").trim()
    || pickup.point?.[0] !== transfer?.point?.[0] || pickup.point?.[1] !== transfer?.point?.[1];
  const notesChanged = notes.trim() !== (transfer?.notes ?? "").trim();
  const referredByChanged = referredBy.trim() !== initialReferredBy.trim();
  const outside = Boolean(transfer?.coverage.enabled && pickup.point && !isInsideAirportPickupZone(pickup.point, transfer.coverage));
  const hasChanges = changedPassenger.length > 0 || addressChanged || notesChanged || referredByChanged
    || priceChanged || methodChanged || referenceChanged;
  const canSave = hasChanges && (!addressChanged || Boolean(pickup.point && pickup.confirmed && !outside));

  const [state, formAction, pending] = useActionState(async (previous: AdminFormState, _formData: FormData) => {
    if (!canSave) return errorState(addressChanged ? "Confirmá el nuevo punto en el mapa." : "No hay cambios para guardar.");
    const changes = new FormData();
    changes.set("code", code);
    for (const field of changedPassenger) changes.set(field, draft[field]);
    if (notesChanged) changes.set("notes", notes);
    // Se manda siempre que cambió, incluso vacío: así el panel puede borrar el origen cargado.
    if (referredByChanged) changes.set("referredBy", referredBy.trim());
    if (addressChanged && pickup.point && pickup.confirmed) {
      changes.set("address", pickup.address);
      changes.set("latitude", String(pickup.point[0]));
      changes.set("longitude", String(pickup.point[1]));
      changes.set("confirmed", "on");
    }
    if (financial && (priceChanged || methodChanged || referenceChanged)) {
      changes.set("financialOperation", financial.operation);
      if (priceChanged) changes.set("customPrice", total);
      if (methodChanged) changes.set("method", method);
      if (referenceChanged) changes.set("reference", reference);
    }
    return action(previous, changes);
  }, initialAdminFormState);

  return (
    <form className="admin-form-grid reservation-edit-form" action={formAction} noValidate>
      <h3 className="reservation-edit-wide">Pasajero</h3>
      <PassengerFields passenger={draft} errors={state.fieldErrors} disabled={pending}
        onChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))} />
      {transfer ? (
        <>
          <h3 className="reservation-edit-wide">{transfer.direction === "ARRIVAL" ? "Dirección de destino" : "Dirección de búsqueda"}</h3>
          <PickupAddressFields pickup={pickup} coverage={transfer.coverage} airport={transfer.airport}
            changed={addressChanged} outside={outside} disabled={pending} onChange={setPickup} />
          <label className="reservation-edit-wide">
            Notas del traslado
            <textarea name="notes" maxLength={300} value={notes} disabled={pending}
              onChange={(event) => setNotes(event.target.value)} />
          </label>
        </>
      ) : null}
      <h3 className="reservation-edit-wide">Origen de la venta</h3>
      <label className="span-2">
        Derivado por (opcional)
        <input name="referredBy" maxLength={120} value={referredBy} disabled={pending} placeholder="Ej. una agencia de viajes"
          onChange={(event) => setReferredBy(event.target.value)} />
        <small>Quién vendió la reserva. En las reservas de aeropuerto sale en la columna «Derivado por» de la orden de servicio.</small>
      </label>
      {financial ? (
        <>
          <h3 className="reservation-edit-wide">{financial.operation === "correctPayment" ? "Pago registrado" : "Precio"}</h3>
          <label className="span-2">
            Precio total ({financial.currency})
            <input name="customPrice" inputMode="decimal" value={total} disabled={pending}
              aria-invalid={Boolean(state.fieldErrors.customPrice)}
              aria-describedby={state.fieldErrors.customPrice ? "reservation-price-error" : undefined}
              onChange={(event) => setTotal(event.target.value)} />
            <FieldError id="reservation-price-error" message={state.fieldErrors.customPrice} />
          </label>
          {financial.operation === "correctPayment" ? (
            <>
              <label>Forma de pago<input name="method" maxLength={60} value={method} disabled={pending}
                onChange={(event) => setMethod(event.target.value)} /></label>
              <label>Referencia (opcional)<input name="reference" maxLength={120} value={reference} disabled={pending}
                onChange={(event) => setReference(event.target.value)} /></label>
            </>
          ) : null}
        </>
      ) : null}
      <div className="form-actions reservation-edit-wide">
        <button type="submit" className="button" disabled={pending || !canSave}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
      <AdminFormAlert state={state} />
    </form>
  );
}

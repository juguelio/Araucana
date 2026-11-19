"use client";

import { useActionState, useState } from "react";
import { MAX_SPORTS_LUGGAGE } from "@/lib/airport/extras";
import { isInsideAirportPickupZone, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import { MAX_PASSENGERS, minimoDePasajeros, totalAlEditar, type ReservationPriceBasis } from "@/lib/booking/reservation-edit";
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
  /**
   * Cantidad de pasajeros y adicionales editables (#267). `undefined` en una reserva cancelada:
   * ya liberó su lugar y la orden de servicio no se imprime.
   */
  counts?: {
    /** Base del total: tarifa, tarifas de menores y adicionales guardados. */
    price: ReservationPriceBasis;
    totalCents: number;
    currency: string;
    /** Es un traslado al aeropuerto: se edita el equipaje deportivo. */
    airport: boolean;
    /** El pago ya está cobrado: la diferencia del total se muestra y se confirma antes de guardar. */
    paymentApproved: boolean;
    /** Hay un comprobante por revisar: la plata no se mueve hasta resolverlo. */
    paymentReceiptPending: boolean;
  };
  transfer?: { address: string; point: PickupPoint | null; notes: string; airport: boolean; direction?: string; coverage: AirportCoverage };
};

export function ReservationEditForm({ action, code, passenger, transfer, financial, referredBy: initialReferredBy, counts }: ReservationEditFormProps) {
  const [draft, setDraft] = useState<PassengerDraft>({ ...passenger, nationality: passenger.nationality ?? "" });
  const [pickup, setPickup] = useState<PickupAddressDraft>({
    address: transfer?.address ?? "", point: transfer?.point ?? null, confirmed: false
  });
  const [notes, setNotes] = useState(transfer?.notes ?? "");
  const [total, setTotal] = useState(financial?.total ?? "");
  const [method, setMethod] = useState(financial?.method ?? "");
  const [reference, setReference] = useState(financial?.reference ?? "");
  const [referredBy, setReferredBy] = useState(initialReferredBy);
  const [passengerCount, setPassengerCount] = useState(counts ? String(counts.price.passengerCount) : "");
  const [sportsLuggage, setSportsLuggage] = useState(counts ? String(counts.price.sportsLuggageCount) : "");
  const [acknowledged, setAcknowledged] = useState(false);
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
  const money = (cents: number) => new Intl.NumberFormat("es-AR", {
    style: "currency", currency: counts?.currency ?? "ARS", maximumFractionDigits: 2
  }).format(cents / 100);

  // La cantidad y el equipaje se validan acá para no mandar un número imposible; el cupo lo decide
  // el servidor, que es el único que ve las otras reservas del servicio.
  const minimo = counts ? minimoDePasajeros(counts.price) : 1;
  const parsedCount = Number(passengerCount);
  const countValid = Number.isInteger(parsedCount) && parsedCount >= minimo && parsedCount <= MAX_PASSENGERS;
  const parsedLuggage = Number(sportsLuggage);
  const luggageValid = Number.isInteger(parsedLuggage) && parsedLuggage >= 0 && parsedLuggage <= MAX_SPORTS_LUGGAGE;
  const countTouched = Boolean(counts && parsedCount !== counts.price.passengerCount);
  const luggageTouched = Boolean(counts?.airport && parsedLuggage !== counts.price.sportsLuggageCount);
  const countChanged = countTouched && countValid;
  const luggageChanged = luggageTouched && luggageValid;
  // Una reserva vieja con datos fuera de regla no bloquea corregir otras cosas: sólo se exige un
  // valor válido cuando el operador toca el campo.
  const countsValid = !counts || ((!countTouched || countValid) && (!luggageTouched || luggageValid));
  // Con un comprobante por revisar, el servidor no mueve la plata: ni se ofrece tocar la cantidad.
  const countsLocked = Boolean(counts?.paymentReceiptPending);
  // Mismo cálculo que el servidor: si el total guardado fue corregido a mano, no se recalcula.
  const proposal = counts ? totalAlEditar({
    basis: counts.price,
    totalCents: counts.totalCents,
    passengerCount: countValid ? parsedCount : counts.price.passengerCount,
    sportsLuggageCount: counts.airport && luggageValid ? parsedLuggage : counts.price.sportsLuggageCount
  }) : null;
  const totalChanged = Boolean(proposal?.seRecalcula && proposal.totalCents !== counts?.totalCents);
  // Un precio escrito a mano manda sobre la cuenta automática: ahí no hay diferencia que confirmar.
  const needsAcknowledgement = Boolean(counts?.paymentApproved && totalChanged && !priceChanged);
  const hasChanges = changedPassenger.length > 0 || addressChanged || notesChanged || referredByChanged
    || countChanged || luggageChanged || priceChanged || methodChanged || referenceChanged;
  const canSave = hasChanges && countsValid && (!needsAcknowledgement || acknowledged)
    && (!addressChanged || Boolean(pickup.point && pickup.confirmed && !outside));

  const [state, formAction, pending] = useActionState(async (previous: AdminFormState, _formData: FormData) => {
    if (!canSave) {
      if (counts && countTouched && !countValid) return errorState(`La cantidad de pasajeros tiene que estar entre ${minimo} y ${MAX_PASSENGERS}.`);
      if (counts?.airport && luggageTouched && !luggageValid) return errorState(`El equipaje deportivo tiene que estar entre 0 y ${MAX_SPORTS_LUGGAGE} bultos.`);
      if (needsAcknowledgement && !acknowledged) return errorState("Confirmá la diferencia del total antes de guardar.");
      return errorState(addressChanged ? "Confirmá el nuevo punto en el mapa." : "No hay cambios para guardar.");
    }
    const changes = new FormData();
    changes.set("code", code);
    for (const field of changedPassenger) changes.set(field, draft[field]);
    if (notesChanged) changes.set("notes", notes);
    // Se manda siempre que cambió, incluso vacío: así el panel puede borrar el origen cargado.
    if (referredByChanged) changes.set("referredBy", referredBy.trim());
    if (countChanged) changes.set("passengerCount", String(parsedCount));
    if (luggageChanged) changes.set("sportsLuggageCount", String(parsedLuggage));
    if (needsAcknowledgement && acknowledged) changes.set("acknowledgeTotalChange", "on");
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
      <PassengerFields passenger={draft} errors={state.fieldErrors} disabled={pending} optionalDocument={Boolean(transfer?.airport)}
        onChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))} />
      {counts ? (
        <>
          <h3 className="reservation-edit-wide">Cantidad de pasajeros</h3>
          <label>
            Lugares que ocupa la reserva
            <input name="passengerCount" type="number" inputMode="numeric" min={minimo} max={MAX_PASSENGERS} step={1}
              value={passengerCount} disabled={pending || countsLocked}
              aria-invalid={!countValid || Boolean(state.fieldErrors.passengerCount)}
              aria-describedby={state.fieldErrors.passengerCount ? "reservation-count-error" : undefined}
              onChange={(event) => { setPassengerCount(event.target.value); setAcknowledged(false); }} />
            <small>
              {countsLocked
                ? "Hay un comprobante por revisar: resolvé el pago para cambiar la cantidad o el equipaje."
                : `Es la cantidad que sale en la orden de servicio y la que ocupa lugares en el ${counts.airport ? "vuelo" : "servicio"}. No puede superar los lugares libres.`}
            </small>
            <FieldError id="reservation-count-error" message={state.fieldErrors.passengerCount} />
          </label>
          {counts.airport ? (
            <label>
              Equipaje deportivo (bultos)
              <input name="sportsLuggageCount" type="number" inputMode="numeric" min={0} max={MAX_SPORTS_LUGGAGE} step={1}
                value={sportsLuggage} disabled={pending || countsLocked}
                aria-invalid={!luggageValid || Boolean(state.fieldErrors.sportsLuggageCount)}
                aria-describedby={state.fieldErrors.sportsLuggageCount ? "reservation-luggage-error" : undefined}
                onChange={(event) => { setSportsLuggage(event.target.value); setAcknowledged(false); }} />
              <small>
                {counts.price.sportsLuggageUnitCents > 0
                  ? `${money(counts.price.sportsLuggageUnitCents)} por bulto: el total se recalcula con ese precio.`
                  : "Esta reserva se vendió sin precio por bulto: el total no cambia."}
              </small>
              <FieldError id="reservation-luggage-error" message={state.fieldErrors.sportsLuggageCount} />
            </label>
          ) : null}
          {counts.airport && counts.price.zoneExtraCents > 0 ? (
            <p className="reservation-edit-wide muted">Recargo por zona ya incluido en el total: {money(counts.price.zoneExtraCents)}.</p>
          ) : null}
        </>
      ) : null}
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
      {proposal && !priceChanged && (countChanged || luggageChanged) ? (
        <div className="reservation-edit-wide">
          {proposal.seRecalcula ? (
            <p className={needsAcknowledgement ? "form-alert error" : "muted"} role="status">
              {needsAcknowledgement ? "El pago ya está aprobado. " : ""}
              El total pasa de {money(counts!.totalCents)} a <strong>{money(proposal.totalCents)}</strong>
              {proposal.deltaCents !== 0 ? ` (diferencia ${proposal.deltaCents > 0 ? "+" : "−"}${money(Math.abs(proposal.deltaCents))})` : ""}.
              {needsAcknowledgement ? " Se actualiza también el monto del pago." : ""}
            </p>
          ) : (
            <p className="muted">
              El precio de esta reserva no sale del cálculo automático (está corregido a mano o tiene una tarifa
              especial): cambiar la cantidad o el equipaje no lo modifica.
            </p>
          )}
          {needsAcknowledgement ? (
            <label className="checkbox-row">
              <input type="checkbox" checked={acknowledged} disabled={pending}
                onChange={(event) => setAcknowledged(event.target.checked)} />
              Confirmo la diferencia del total y la actualización del pago
            </label>
          ) : null}
        </div>
      ) : null}
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

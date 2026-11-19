"use client";

import { useActionState, useState } from "react";
import { MAX_SPORTS_LUGGAGE } from "@/lib/airport/extras";
import { chargesZoneExtra, isInsideAirportPickupZone, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import { MAX_PASSENGERS, errorDeMenores, totalAlEditar, type ReservationPriceBasis } from "@/lib/booking/reservation-edit";
import type { PassengerDto } from "@/lib/booking/types";
import { AdminFormAlert, FieldError } from "../../form-ui";
import { errorState, initialAdminFormState, type AdminFormState } from "../../form-state";
import { PassengerFields, type PassengerDraft } from "./passenger-form";
import { canSavePickup, pickupFormFields } from "./pickup-address";
import { PickupAddressFields, type PickupAddressDraft } from "./pickup-address-form";
import { ServiceMoveFields, type ServiceMoveDraft } from "./service-move-fields";
import type { ServiceMove } from "./editar/service-options";

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
    /** Tarifa sin cargo por discapacidad: es de un solo pasajero adulto, sin menores. */
    disability: boolean;
    /** Tarifa entera de la ruta (la de bajar en el destino final). */
    routePriceCents: number;
    /** Destino final de la ruta y paradas intermedias con su tarifa (vacío si no tiene). */
    destination: string;
    stops: Array<{ name: string; priceCents: number }>;
    /** Parada donde baja hoy; vacío = destino final. */
    dropoffStop: string;
    /** Recargo por zona vigente hoy, para mostrar cuánto se suma si el punto entra en la zona. */
    zoneExtraConfigCents: number;
    /** El pago ya está cobrado: la diferencia del total se muestra y se confirma antes de guardar. */
    paymentApproved: boolean;
    /** Hay un comprobante por revisar: la plata no se mueve hasta resolverlo. */
    paymentReceiptPending: boolean;
  };
  /** Pasar a otra salida, vuelo o fecha. `undefined` en una reserva cancelada (primero se restituye). */
  service?: ServiceMove;
  transfer?: { address: string; point: PickupPoint | null; notes: string; name: string; airport: boolean; direction?: string; coverage: AirportCoverage };
};

export function ReservationEditForm({ action, code, passenger, transfer, financial, referredBy: initialReferredBy, counts, service }: ReservationEditFormProps) {
  const [move, setMove] = useState<ServiceMoveDraft>(null);
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
  const [halfFare, setHalfFare] = useState(counts ? String(counts.price.halfFareCount) : "");
  const [freeFare, setFreeFare] = useState(counts ? String(counts.price.freeFareCount) : "");
  const [dropoff, setDropoff] = useState(counts?.dropoffStop ?? "");
  const [pickupName, setPickupName] = useState(transfer?.name ?? "");
  const [acknowledged, setAcknowledged] = useState(false);
  const priceChanged = Boolean(financial && total.trim() !== financial.total);
  const methodChanged = financial?.operation === "correctPayment" && method.trim() !== financial.method;
  const referenceChanged = financial?.operation === "correctPayment" && reference.trim() !== financial.reference;
  const changedPassenger = (Object.keys(draft) as (keyof PassengerDraft)[])
    .filter((field) => draft[field].trim() !== (passenger[field] ?? "").trim());
  const addressChanged = pickup.address.trim() !== (transfer?.address ?? "").trim()
    || pickup.point?.[0] !== transfer?.point?.[0] || pickup.point?.[1] !== transfer?.point?.[1];
  const notesChanged = notes.trim() !== (transfer?.notes ?? "").trim();
  const pickupNameChanged = pickupName.trim() !== (transfer?.name ?? "").trim();
  const referredByChanged = referredBy.trim() !== initialReferredBy.trim();
  const outside = Boolean(transfer?.coverage.enabled && pickup.point && !isInsideAirportPickupZone(pickup.point, transfer.coverage));
  const money = (cents: number) => new Intl.NumberFormat("es-AR", {
    style: "currency", currency: counts?.currency ?? "ARS", maximumFractionDigits: 2
  }).format(cents / 100);

  // La cantidad y el equipaje se validan acá para no mandar un número imposible; el cupo lo decide
  // el servidor, que es el único que ve las otras reservas del servicio.
  const parsedCount = Number(passengerCount);
  const countInRange = Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= MAX_PASSENGERS;
  const parsedHalf = Number(halfFare);
  const parsedFree = Number(freeFare);
  const minorsInRange = Number.isInteger(parsedHalf) && Number.isInteger(parsedFree) && parsedHalf >= 0 && parsedFree >= 0;
  const parsedLuggage = Number(sportsLuggage);
  const luggageValid = Number.isInteger(parsedLuggage) && parsedLuggage >= 0 && parsedLuggage <= MAX_SPORTS_LUGGAGE;
  const countTouched = Boolean(counts && parsedCount !== counts.price.passengerCount);
  const minorsTouched = Boolean(counts && (parsedHalf !== counts.price.halfFareCount || parsedFree !== counts.price.freeFareCount));
  const luggageTouched = Boolean(counts?.airport && parsedLuggage !== counts.price.sportsLuggageCount);
  // Otra salida de otra ruta: las paradas de esta ruta ya no aplican y la bajada vuelve al destino final.
  const otraRuta = move?.mode === "SEATED" && service?.mode === "SEATED" && move.routeId !== service.currentRouteId;
  const dropoffFinal = otraRuta ? "" : dropoff;
  const dropoffChanged = Boolean(counts && !otraRuta && dropoff !== counts.dropoffStop);
  // Pasajeros y menores se validan juntos: los menores van dentro del total y siempre queda un adulto.
  const minorsError = counts && countInRange && minorsInRange && (countTouched || minorsTouched)
    ? errorDeMenores({ passengerCount: parsedCount, halfFareCount: parsedHalf, freeFareCount: parsedFree })
      ?? (counts.disability && (parsedCount > 1 || parsedHalf > 0 || parsedFree > 0) ? "La tarifa sin cargo por discapacidad es para un solo pasajero." : null)
    : null;
  const countValid = countInRange && minorsInRange && !minorsError;
  const countChanged = countTouched && countValid;
  const minorsChanged = minorsTouched && countValid;
  const luggageChanged = luggageTouched && luggageValid;
  // Una reserva vieja con datos fuera de regla no bloquea corregir otras cosas: sólo se exige un
  // valor válido cuando el operador toca el campo.
  const countsValid = !counts || ((!countTouched && !minorsTouched) || countValid) && (!luggageTouched || luggageValid);
  // Con un comprobante por revisar, el servidor no mueve la plata: ni se ofrece tocar lo que cambia el total.
  const countsLocked = Boolean(counts?.paymentReceiptPending);
  // Recargo por zona: el servidor lo cobra o lo descuenta si el punto cambia de zona, igual que el alta.
  const zoneNow = counts?.price.zoneExtraCents ?? 0;
  const zoneNext = counts?.airport && transfer && addressChanged && pickup.point
    ? (chargesZoneExtra(pickup.point, transfer.coverage) ? (zoneNow || counts.zoneExtraConfigCents) : 0)
    : zoneNow;
  const zoneChanged = zoneNext !== zoneNow;
  const stopPrice = (name: string) => counts?.stops.find((stop) => stop.name === name)?.priceCents ?? counts?.routePriceCents ?? 0;
  // Tarifa por persona después del cambio de servicio: la de la ruta nueva o la del otro sentido.
  const movedPrice = move?.mode === "SEATED" && otraRuta ? move.priceCents
    : move?.mode === "AIRPORT" && service?.mode === "AIRPORT" && move.direction !== service.currentDirection
      ? service.prices[move.direction] ?? undefined
      : undefined;
  // Mismo cálculo que el servidor: si el total guardado fue corregido a mano, no se recalcula.
  const proposal = counts ? totalAlEditar({
    basis: counts.price,
    totalCents: counts.totalCents,
    passengerCount: countValid ? parsedCount : counts.price.passengerCount,
    halfFareCount: countValid ? parsedHalf : counts.price.halfFareCount,
    freeFareCount: countValid ? parsedFree : counts.price.freeFareCount,
    sportsLuggageCount: counts.airport && luggageValid ? parsedLuggage : counts.price.sportsLuggageCount,
    zoneExtraCents: zoneNext,
    priceCents: movedPrice ?? stopPrice(dropoffFinal)
  }) : null;
  const totalChanged = Boolean(proposal?.seRecalcula && proposal.totalCents !== counts?.totalCents);
  const moved = move !== null;
  const movesTotal = countChanged || minorsChanged || luggageChanged || dropoffChanged || zoneChanged || moved;
  // Un precio escrito a mano manda sobre la cuenta automática: ahí no hay diferencia que confirmar.
  const needsAcknowledgement = Boolean(counts?.paymentApproved && totalChanged && !priceChanged);
  const hasChanges = changedPassenger.length > 0 || addressChanged || notesChanged || pickupNameChanged || referredByChanged
    || countChanged || minorsChanged || luggageChanged || dropoffChanged || moved || priceChanged || methodChanged || referenceChanged;
  const savePickup = canSavePickup(addressChanged, pickup, { airport: Boolean(transfer?.airport), outside });
  const canSave = hasChanges && countsValid && (!needsAcknowledgement || acknowledged) && savePickup;

  const [state, formAction, pending] = useActionState(async (previous: AdminFormState, _formData: FormData) => {
    if (!canSave) {
      if (counts && (countTouched || minorsTouched) && !countValid) {
        return errorState(minorsError ?? `La cantidad de pasajeros tiene que estar entre 1 y ${MAX_PASSENGERS}.`);
      }
      if (counts?.airport && luggageTouched && !luggageValid) return errorState(`El equipaje deportivo tiene que estar entre 0 y ${MAX_SPORTS_LUGGAGE} bultos.`);
      if (needsAcknowledgement && !acknowledged) return errorState("Confirmá la diferencia del total antes de guardar.");
      return errorState(addressChanged ? "Confirmá el nuevo punto en el mapa." : "No hay cambios para guardar.");
    }
    const changes = new FormData();
    changes.set("code", code);
    for (const field of changedPassenger) changes.set(field, draft[field]);
    if (notesChanged) changes.set("notes", notes);
    if (pickupNameChanged) changes.set("pickupName", pickupName.trim());
    // Se manda siempre que cambió, incluso vacío: así el panel puede borrar el origen cargado.
    if (referredByChanged) changes.set("referredBy", referredBy.trim());
    if (countChanged) changes.set("passengerCount", String(parsedCount));
    if (luggageChanged) changes.set("sportsLuggageCount", String(parsedLuggage));
    if (minorsChanged) {
      changes.set("halfFareCount", String(parsedHalf));
      changes.set("freeFareCount", String(parsedFree));
    }
    // Vacío = baja en el destino final: viaja igual para poder volver atrás una parada intermedia.
    if (dropoffChanged) changes.set("dropoffStop", dropoff);
    if (move?.mode === "SEATED") changes.set("moveScheduleId", move.scheduleId);
    if (move?.mode === "AIRPORT") changes.set("moveFlightId", move.flightId);
    if (move?.mode === "CHAPELCO") {
      changes.set("moveServiceDate", move.serviceDate);
      changes.set("moveAscentSlot", move.ascentSlot);
    }
    if (needsAcknowledgement && acknowledged) changes.set("acknowledgeTotalChange", "on");
    // `pickupFormFields` decide si viajan coordenadas: sin punto va sólo el texto (#268).
    if (addressChanged) {
      for (const [field, value] of Object.entries(pickupFormFields(pickup))) changes.set(field, value);
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
      {service ? (
        <>
          <h3 className="reservation-edit-wide">
            {service.mode === "SEATED" ? "Salida" : service.mode === "AIRPORT" ? "Vuelo" : "Fecha y franja"}
          </h3>
          <ServiceMoveFields service={service} disabled={pending} error={state.fieldErrors.move}
            onChange={(draft) => { setMove(draft); setAcknowledged(false); }} />
        </>
      ) : null}
      {counts ? (
        <>
          <h3 className="reservation-edit-wide">Cantidad de pasajeros</h3>
          <label>
            Lugares que ocupa la reserva
            <input name="passengerCount" type="number" inputMode="numeric" min={1} max={MAX_PASSENGERS} step={1}
              value={passengerCount} disabled={pending || countsLocked}
              aria-invalid={(countTouched && !countValid) || Boolean(state.fieldErrors.passengerCount)}
              aria-describedby={state.fieldErrors.passengerCount ? "reservation-count-error" : undefined}
              onChange={(event) => { setPassengerCount(event.target.value); setAcknowledged(false); }} />
            <small>
              {countsLocked
                ? "Hay un comprobante por revisar: resolvé el pago para cambiar pasajeros, menores, bajada o equipaje."
                : `Es la cantidad que sale en la orden de servicio y la que ocupa lugares en el ${counts.airport ? "vuelo" : "servicio"}. No puede superar los lugares libres.`}
            </small>
            <FieldError id="reservation-count-error" message={state.fieldErrors.passengerCount} />
          </label>
          {counts.disability ? (
            <p className="muted">Tarifa sin cargo por discapacidad: es para un solo pasajero, sin menores.</p>
          ) : (
            <>
              <label>
                Media tarifa (4 a 8 años)
                <input name="halfFareCount" type="number" inputMode="numeric" min={0} max={MAX_PASSENGERS} step={1}
                  value={halfFare} disabled={pending || countsLocked}
                  aria-invalid={Boolean(minorsError) || Boolean(state.fieldErrors.halfFareCount)}
                  aria-describedby={minorsError || state.fieldErrors.halfFareCount ? "reservation-minors-error" : undefined}
                  onChange={(event) => { setHalfFare(event.target.value); setAcknowledged(false); }} />
              </label>
              <label>
                Sin cargo (menores de 4)
                <input name="freeFareCount" type="number" inputMode="numeric" min={0} max={MAX_PASSENGERS} step={1}
                  value={freeFare} disabled={pending || countsLocked}
                  aria-invalid={Boolean(minorsError)}
                  onChange={(event) => { setFreeFare(event.target.value); setAcknowledged(false); }} />
              </label>
              <p className="reservation-edit-wide muted">
                Los menores van dentro de los lugares de la reserva y tiene que quedar al menos un pasajero de tarifa entera.
              </p>
              <FieldError id="reservation-minors-error" message={minorsError ?? state.fieldErrors.halfFareCount} />
            </>
          )}
          {counts.stops.length > 0 && !otraRuta ? (
            <label className="span-2">
              Baja en
              <select name="dropoffStop" value={dropoff} disabled={pending || countsLocked}
                aria-invalid={Boolean(state.fieldErrors.dropoffStop)}
                onChange={(event) => { setDropoff(event.target.value); setAcknowledged(false); }}>
                <option value="">{counts.destination} (destino final) · {money(counts.routePriceCents)}</option>
                {counts.stops.map((stop) => (
                  <option key={stop.name} value={stop.name}>{stop.name} · {money(stop.priceCents)}</option>
                ))}
              </select>
              <small>La tarifa por persona es la de la parada donde baja.</small>
              <FieldError id="reservation-dropoff-error" message={state.fieldErrors.dropoffStop} />
            </label>
          ) : null}
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
          {counts.airport && zoneChanged ? (
            <p className="reservation-edit-wide form-alert" role="status">
              {zoneNext > 0
                ? `El punto nuevo está en la zona con recargo: se suman ${money(zoneNext)}.`
                : `El punto nuevo ya no está en la zona con recargo: se descuentan ${money(zoneNow)}.`}
            </p>
          ) : counts.airport && zoneNow > 0 ? (
            <p className="reservation-edit-wide muted">Recargo por zona incluido en el total: {money(zoneNow)}. Si movés el punto fuera de esa zona, se descuenta.</p>
          ) : null}
        </>
      ) : null}
      {transfer ? (
        <>
          <h3 className="reservation-edit-wide">{transfer.direction === "ARRIVAL" ? "Dirección de destino" : "Dirección de búsqueda"}</h3>
          <label className="reservation-edit-wide">
            Nombre del lugar (hotel, cabaña…)
            <input name="pickupName" maxLength={120} value={pickupName} disabled={pending}
              placeholder="Opcional: sale en la orden del chofer junto al domicilio"
              onChange={(event) => setPickupName(event.target.value)} />
          </label>
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
      {proposal && !priceChanged && movesTotal ? (
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
              especial): cambiar pasajeros, menores, bajada o adicionales no lo modifica.
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

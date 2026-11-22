"use client";

import { isPaihuen, PAIHUEN_UNIT_CENTS } from "@/lib/airport/paihuen";
import { SegmentStopFields } from "@/components/segment-stop-fields";
import { segmentPrice } from "@/lib/booking/segment-fares";

import { useActionState, useEffect, useRef, useState } from "react";
import { MAX_SPORTS_LUGGAGE } from "@/lib/airport/extras";
import { chargesZoneExtra, isInsideAirportPickupZone, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import { parseReservationPrice, reservationPriceCents, reservationPriceError } from "@/lib/booking/admin-price";
import { MAX_PASSENGERS, errorDeMenores, totalAlEditar, type ReservationPriceBasis } from "@/lib/booking/reservation-edit";
import type { PassengerDto, PublicRouteDto } from "@/lib/booking/types";
import { AdminFormAlert, FieldError } from "../../form-ui";
import { initialAdminFormState, type AdminFormState } from "../../form-state";
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
    route: PublicRouteDto;
    boardingStop: string;
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
  const formRef = useRef<HTMLFormElement>(null);
  const [move, setMove] = useState<ServiceMoveDraft>(null);
  const [serviceIncomplete, setServiceIncomplete] = useState(false);
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
  const [boarding, setBoarding] = useState(counts?.boardingStop ?? "");
  const [dropoff, setDropoff] = useState(counts?.dropoffStop ?? "");
  const [pickupName, setPickupName] = useState(transfer?.name ?? "");
  const [acknowledged, setAcknowledged] = useState(false);
  const [correctedFields, setCorrectedFields] = useState<Record<string, true>>({});

  function clearFieldErrors(...fields: string[]) {
    if (!fields.some((field) => state.fieldErrors[field] && !correctedFields[field])) return;
    setCorrectedFields((current) => ({ ...current, ...Object.fromEntries(fields.map((field) => [field, true])) }));
  }
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
  const validMinorCount = (value: number) => Number.isInteger(value) && value >= 0 && value <= MAX_PASSENGERS;
  const minorsInRange = validMinorCount(parsedHalf) && validMinorCount(parsedFree);
  const parsedLuggage = Number(sportsLuggage);
  const luggageValid = Number.isInteger(parsedLuggage) && parsedLuggage >= 0 && parsedLuggage <= MAX_SPORTS_LUGGAGE;
  const countTouched = Boolean(counts && parsedCount !== counts.price.passengerCount);
  const minorsTouched = Boolean(counts && (parsedHalf !== counts.price.halfFareCount || parsedFree !== counts.price.freeFareCount));
  const luggageTouched = Boolean(counts?.airport && parsedLuggage !== counts.price.sportsLuggageCount);
  // Otra salida de otra ruta: las paradas de esta ruta ya no aplican y la bajada vuelve al destino final.
  const otraRuta = move?.mode === "SEATED" && service?.mode === "SEATED" && move.routeId !== service.currentRouteId;
  const dropoffFinal = otraRuta ? "" : dropoff;
  const boardingChanged = Boolean(counts && !otraRuta && boarding !== counts.boardingStop);
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
  const unidadActual = counts?.price.paihuenUnitCents ?? 0;
  const unidadFinal = counts?.airport && counts.currency === "ARS" && (addressChanged || pickupNameChanged)
    ? (isPaihuen(pickupName, pickup.address, pickup.point) ? PAIHUEN_UNIT_CENTS : 0) : unidadActual;
  const zoneChanged = zoneNext !== zoneNow;
  const stopPrice = counts && segmentPrice(counts.route, boarding, dropoffFinal);
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
    paihuenUnitCents: unidadFinal,
    zoneExtraCents: zoneNext,
    priceCents: movedPrice ?? stopPrice
  }) : null;
  const totalChanged = Boolean(proposal?.seRecalcula && proposal.totalCents !== counts?.totalCents);
  const moved = move !== null;
  const movesTotal = countChanged || minorsChanged || luggageChanged || boardingChanged || dropoffChanged || zoneChanged || unidadFinal !== unidadActual || moved;
  // Un precio escrito a mano manda sobre la cuenta automática: ahí no hay diferencia que confirmar.
  const needsAcknowledgement = Boolean(counts?.paymentApproved && totalChanged && !priceChanged);
  const hasChanges = changedPassenger.length > 0 || addressChanged || notesChanged || pickupNameChanged || referredByChanged
    || countChanged || minorsChanged || luggageChanged || boardingChanged || dropoffChanged || moved || priceChanged || methodChanged || referenceChanged;
  const savePickup = canSavePickup(addressChanged, pickup, { airport: Boolean(transfer?.airport), outside });
  const priceInputError = priceChanged && !reservationPriceCents.safeParse(parseReservationPrice(total)).success
    ? reservationPriceError : undefined;
  const canSave = hasChanges && countsValid && !serviceIncomplete && !priceInputError && (!needsAcknowledgement || acknowledged) && savePickup;

  const [state, formAction, pending] = useActionState(async (previous: AdminFormState, _formData: FormData) => {
    if (!canSave) return previous;
    setCorrectedFields({});
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
    if (boardingChanged) changes.set("boardingStop", boarding);
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

  useEffect(() => {
    if (Object.keys(state.fieldErrors).length) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')?.focus();
    }
  }, [state]);

  const errors = Object.fromEntries(Object.entries(state.fieldErrors).filter(([field]) => !correctedFields[field]));
  const countError = countTouched && !countInRange
    ? `Ingresá una cantidad entera entre 1 y ${MAX_PASSENGERS} pasajeros.` : counts?.disability && minorsError ? minorsError : errors.passengerCount;
  const minorRangeError = `Ingresá una cantidad entera de 0 a ${MAX_PASSENGERS}.`;
  const halfError = minorsTouched && !validMinorCount(parsedHalf) ? minorRangeError : errors.halfFareCount;
  const freeError = minorsTouched && !validMinorCount(parsedFree) ? minorRangeError : errors.freeFareCount;
  const luggageError = luggageTouched && !luggageValid
    ? `Ingresá una cantidad entera entre 0 y ${MAX_SPORTS_LUGGAGE} bultos.` : errors.sportsLuggageCount;
  const combinedMinorsError = minorsError ?? errors.minors;
  const priceError = priceInputError ?? errors.customPrice;
  const totalError = needsAcknowledgement && !acknowledged
    ? "Confirmá la diferencia del total antes de guardar." : errors.totalChange;

  return (
    <form ref={formRef} className="admin-form-grid reservation-edit-form" action={formAction} noValidate
      onChange={(event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
          clearFieldErrors(target.name);
          if (["passengerCount", "halfFareCount", "freeFareCount"].includes(target.name)) {
            clearFieldErrors("passengerCount", "halfFareCount", "freeFareCount", "minors", "totalChange");
          }
        }
      }}>
      <h3 className="reservation-edit-wide">Pasajero</h3>
      <PassengerFields passenger={draft} errors={errors} disabled={pending} optionalDocument={Boolean(transfer?.airport)}
        onChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))} />
      {service ? (
        <>
          <h3 className="reservation-edit-wide">
            {service.mode === "SEATED" ? "Salida" : service.mode === "AIRPORT" ? "Vuelo" : "Fecha y franja"}
          </h3>
          <ServiceMoveFields service={service} disabled={pending} error={errors.move} dateError={errors.serviceDate} slotError={errors.ascentSlot}
            onChange={(draft, incomplete = false) => {
              setMove(draft);
              setServiceIncomplete(incomplete);
              setAcknowledged(false);
              clearFieldErrors("move", "serviceDate", "ascentSlot", "totalChange");
            }} />
        </>
      ) : null}
      {counts ? (
        <>
          <h3 className="reservation-edit-wide">Cantidad de pasajeros</h3>
          <label>
            Lugares que ocupa la reserva
            <input name="passengerCount" type="number" inputMode="numeric" min={1} max={MAX_PASSENGERS} step={1}
              value={passengerCount} disabled={pending || countsLocked}
              aria-invalid={Boolean(countError)}
              aria-describedby={countError ? "reservation-count-error" : undefined}
              onChange={(event) => { setPassengerCount(event.target.value); setAcknowledged(false); }} />
            <small>
              {countsLocked
                ? "Hay un comprobante por revisar: resolvé el pago para cambiar pasajeros, menores, bajada o equipaje."
                : `Es la cantidad que sale en la orden de servicio y la que ocupa lugares en el ${counts.airport ? "vuelo" : "servicio"}. No puede superar los lugares libres.`}
            </small>
            <FieldError id="reservation-count-error" message={countError} />
          </label>
          {counts.disability ? (
            <p className="muted">Tarifa sin cargo por discapacidad: es para un solo pasajero, sin menores.</p>
          ) : (
            <>
              <label>
                Media tarifa (4 a 8 años)
                <input name="halfFareCount" type="number" inputMode="numeric" min={0} max={MAX_PASSENGERS} step={1}
                  value={halfFare} disabled={pending || countsLocked}
                  aria-invalid={Boolean(halfError || combinedMinorsError)}
                  aria-describedby={[halfError && "reservation-half-error", combinedMinorsError && "reservation-minors-error"].filter(Boolean).join(" ") || undefined}
                  onChange={(event) => { setHalfFare(event.target.value); setAcknowledged(false); }} />
                <FieldError id="reservation-half-error" message={halfError} />
              </label>
              <label>
                Sin cargo (menores de 4)
                <input name="freeFareCount" type="number" inputMode="numeric" min={0} max={MAX_PASSENGERS} step={1}
                  value={freeFare} disabled={pending || countsLocked}
                  aria-invalid={Boolean(freeError || combinedMinorsError)}
                  aria-describedby={[freeError && "reservation-free-error", combinedMinorsError && "reservation-minors-error"].filter(Boolean).join(" ") || undefined}
                  onChange={(event) => { setFreeFare(event.target.value); setAcknowledged(false); }} />
                <FieldError id="reservation-free-error" message={freeError} />
              </label>
              <p className="reservation-edit-wide muted">
                Los menores van dentro de los lugares de la reserva y tiene que quedar al menos un pasajero de tarifa entera.
              </p>
              <FieldError id="reservation-minors-error" message={combinedMinorsError} />
            </>
          )}
          {counts.route.bookingMode === "SEATED" && !otraRuta && (
            <>
              <SegmentStopFields route={counts.route} boarding={boarding} dropoff={dropoff} disabled={pending || countsLocked}
                dropoffErrorId={errors.dropoffStop ? "reservation-dropoff-error" : undefined}
                onChange={(start, end) => { setBoarding(start); setDropoff(end); setAcknowledged(false); }} />
              <FieldError id="reservation-dropoff-error" message={errors.dropoffStop} />
            </>
          )}
          {counts.airport ? (
            <label>
              Equipaje deportivo (bultos)
              <input name="sportsLuggageCount" type="number" inputMode="numeric" min={0} max={MAX_SPORTS_LUGGAGE} step={1}
                value={sportsLuggage} disabled={pending || countsLocked}
                aria-invalid={Boolean(luggageError)}
                aria-describedby={luggageError ? "reservation-luggage-error" : undefined}
                onChange={(event) => { setSportsLuggage(event.target.value); setAcknowledged(false); }} />
              <small>
                {counts.price.sportsLuggageUnitCents > 0
                  ? `${money(counts.price.sportsLuggageUnitCents)} por bulto: el total se recalcula con ese precio.`
                  : "Esta reserva se vendió sin precio por bulto: el total no cambia."}
              </small>
              <FieldError id="reservation-luggage-error" message={luggageError} />
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
              aria-invalid={Boolean(errors.pickupName)} aria-describedby={errors.pickupName ? "reservation-pickup-name-error" : undefined}
              onChange={(event) => setPickupName(event.target.value)} />
            <FieldError id="reservation-pickup-name-error" message={errors.pickupName} />
          </label>
          <PickupAddressFields pickup={pickup} coverage={transfer.coverage} airport={transfer.airport}
            changed={addressChanged} outside={outside} disabled={pending} addressError={errors.address} pointError={errors.pickupPoint}
            onChange={(next) => { setPickup(next); clearFieldErrors("address", "pickupPoint", "totalChange"); }}
            onLodgingName={(name) => { setPickupName(name); clearFieldErrors("pickupName"); }} />
          <label className="reservation-edit-wide">
            Notas del traslado
            <textarea name="notes" maxLength={300} value={notes} disabled={pending}
              aria-invalid={Boolean(errors.notes)} aria-describedby={errors.notes ? "reservation-notes-error" : undefined}
              onChange={(event) => setNotes(event.target.value)} />
            <FieldError id="reservation-notes-error" message={errors.notes} />
          </label>
        </>
      ) : null}
      <h3 className="reservation-edit-wide">Origen de la venta</h3>
      <label className="span-2">
        Derivado por (opcional)
        <input name="referredBy" maxLength={120} value={referredBy} disabled={pending} placeholder="Ej. una agencia de viajes"
          aria-invalid={Boolean(errors.referredBy)} aria-describedby={errors.referredBy ? "reservation-origin-error" : undefined}
          onChange={(event) => setReferredBy(event.target.value)} />
        <small>Quién vendió la reserva. En las reservas de aeropuerto sale en la columna «Derivado por» de la orden de servicio.</small>
        <FieldError id="reservation-origin-error" message={errors.referredBy} />
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
              <input type="checkbox" name="totalChange" checked={acknowledged} disabled={pending}
                aria-invalid={Boolean(totalError)} aria-describedby={totalError ? "reservation-total-change-error" : undefined}
                onChange={(event) => setAcknowledged(event.target.checked)} />
              Confirmo la diferencia del total y la actualización del pago
            </label>
          ) : null}
          <FieldError id="reservation-total-change-error" message={totalError} />
        </div>
      ) : <FieldError id="reservation-total-change-error" message={errors.totalChange} />}
      {financial ? (
        <>
          <h3 className="reservation-edit-wide">{financial.operation === "correctPayment" ? "Pago registrado" : "Precio"}</h3>
          <label className="span-2">
            Precio total ({financial.currency})
            <input name="customPrice" inputMode="decimal" value={total} disabled={pending}
              aria-invalid={Boolean(priceError)}
              aria-describedby={priceError ? "reservation-price-error" : undefined}
              onChange={(event) => setTotal(event.target.value)} />
            <FieldError id="reservation-price-error" message={priceError} />
          </label>
          {financial.operation === "correctPayment" ? (
            <>
              <label>Forma de pago
                <input name="method" maxLength={60} value={method} disabled={pending}
                  aria-invalid={Boolean(errors.method)} aria-describedby={errors.method ? "reservation-method-error" : undefined}
                  onChange={(event) => setMethod(event.target.value)} />
                <FieldError id="reservation-method-error" message={errors.method} />
              </label>
              <label>Referencia (opcional)
                <input name="reference" maxLength={120} value={reference} disabled={pending}
                  aria-invalid={Boolean(errors.reference)} aria-describedby={errors.reference ? "reservation-reference-error" : undefined}
                  onChange={(event) => setReference(event.target.value)} />
                <FieldError id="reservation-reference-error" message={errors.reference} />
              </label>
            </>
          ) : null}
        </>
      ) : null}
      {!hasChanges && countsValid && savePickup && !serviceIncomplete && !pending ? <p className="muted reservation-edit-wide" role="status">No hay cambios para guardar.</p> : null}
      <div className="form-actions reservation-edit-wide">
        <button type="submit" className="button" disabled={pending || !canSave}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
      <AdminFormAlert state={state} />
    </form>
  );
}

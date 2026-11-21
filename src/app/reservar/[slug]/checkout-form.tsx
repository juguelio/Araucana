"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CheckoutScheduleDto, PublicRouteDto, SeatMapDto } from "@/lib/booking/types";
import {
  buildPassengerPayload,
  initialPassenger,
  PassengerFields,
  QuantityPicker,
  validateCheckoutPassenger,
  type PassengerFieldErrors,
  type PassengerForm
} from "./passenger-fields";
import { fareCounts, reservationTotalCents } from "@/lib/booking/passenger-fares";
import { corridorStops, destinationsFrom, segmentPrice } from "@/lib/booking/segment-fares";
import { SegmentStopFields } from "@/components/segment-stop-fields";
import { terminalConocida } from "@/lib/booking/terminals";
import { createReservationAction } from "./actions";
import { FormErrorSummary, useFocusFirstError } from "@/components/form-errors";

/** Orden en que se ven los campos del pasajero: define a cuál va el foco (#242). */
const PASSENGER_FIELD_ORDER = [
  "firstName",
  "lastName",
  "email",
  "phoneCountryCode",
  "phone",
  "documentType",
  "documentId"
] as const;

// Se mantienen los exports de siempre: los dos checkouts comparten la lógica del pasajero.
export {
  buildPassengerPayload,
  filterNationalityOptions,
  getNationalityOptions,
  validateCheckoutPassenger
} from "./passenger-fields";

type SelectedLeg = Pick<CheckoutScheduleDto, "id" | "availableSeats" | "departureAt" | "priceCents" | "currency"> & { boardingStop?: string; dropoffStop?: string };
type CheckoutFormProps = {
  route: PublicRouteDto;
  selectedSchedule: SelectedLeg | null;
  vuelta?: SelectedLeg | null;
  boardingStop?: string;
  destination?: string;
  initialLegacyStop?: string;
};

const bookableScheduleStatuses = new Set(["OPEN", "DOCUMENTATION"]);

export function filterBookableSchedules(schedules: CheckoutScheduleDto[], seatMaps: SeatMapDto[]) {
  const bookableSchedules = schedules.filter((schedule) => bookableScheduleStatuses.has(schedule.status));
  const bookableScheduleIds = new Set(bookableSchedules.map((schedule) => schedule.id));

  return {
    schedules: bookableSchedules,
    seatMaps: seatMaps.filter((seatMap) => bookableScheduleIds.has(seatMap.scheduleId))
  };
}

export function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Argentina/Salta"
  }).format(new Date(value)).replace(/\u00a0/g, " ");
}

function formatPrice(cents: number, currency: string) {
  if (cents <= 0) {
    return "Consultar";
  }

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(cents / 100);
}

export function CheckoutForm({ route, selectedSchedule, vuelta, boardingStop = "", destination = "", initialLegacyStop = "" }: CheckoutFormProps) {
  const router = useRouter();
  const [stopSelection, setStopSelection] = useState({ routeId: route.id, stop: initialLegacyStop });
  const legacyStop = stopSelection.routeId === route.id ? stopSelection.stop : "";
  const dropoffStop = destination || legacyStop;
  // Los micros salen y llegan a la terminal: el resumen lo dice antes de confirmar (#276).
  const terminalesDelViaje =
    route.bookingMode === "SEATED"
      ? { salida: terminalConocida(boardingStop || route.from), llegada: terminalConocida(dropoffStop || route.to) }
      : { salida: null, llegada: null };
  const [requestDisabilityFare, setRequestDisabilityFare] = useState(false);
  const [passengerCount, setPassengerCount] = useState(1);
  const [halfFareCount, setHalfFareCount] = useState(0);
  const [freeFareCount, setFreeFareCount] = useState(0);
  const [passenger, setPassenger] = useState<PassengerForm>(initialPassenger);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<PassengerFieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  // El error tiene que quedar a la vista y el foco ir al campo culpable, no a un cartel lejano.
  useFocusFirstError(fieldErrors, PASSENGER_FIELD_ORDER, formRef);
  const personas = passengerCount + halfFareCount + freeFareCount;
  const precioUnitario = segmentPrice(route, boardingStop, dropoffStop) ?? route.priceCents;
  const precioVuelta = vuelta?.priceCents ?? 0;
  const tarifas = fareCounts(personas, halfFareCount, freeFareCount);
  const totalPorEdad = reservationTotalCents(precioUnitario, tarifas) + (vuelta ? reservationTotalCents(precioVuelta, tarifas) : 0);
  const lugaresLibres = Math.min(selectedSchedule?.availableSeats ?? 0, vuelta?.availableSeats ?? Infinity);

  function updatePassenger(field: keyof PassengerForm, value: string) {
    setPassenger((current) => ({
      ...current,
      [field]: value
    }));
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const nextErrors = { ...current };
      delete nextErrors[field];
      return nextErrors;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setFieldErrors({});

    const passengerErrors = validateCheckoutPassenger(passenger);

    if (Object.keys(passengerErrors).length > 0) {
      setFieldErrors(passengerErrors);
      setError("Revisa los campos marcados.");
      return;
    }

    if (!selectedSchedule || personas > lugaresLibres) {
      setError("Revisá la salida elegida y la cantidad de lugares disponibles.");
      return;
    }
    setIsSubmitting(true);

    const result = await createReservationAction({
      scheduleId: selectedSchedule.id,
      boardingStop: boardingStop || undefined,
      dropoffStop: dropoffStop || undefined,
      requestDisabilityFare: requestDisabilityFare && personas === 1,
      passengerCount: personas,
      halfFareCount,
      freeFareCount,
      passenger: buildPassengerPayload(passenger)
    }, vuelta?.id, vuelta ? { boardingStop: vuelta.boardingStop, dropoffStop: vuelta.dropoffStop } : undefined);

    if (result.ok) {
      router.push(`/reservas/${result.code}`);
      return;
    }

    if (result.fieldErrors) {
      setFieldErrors(result.fieldErrors);
    }

    setError(result.message);
    setIsSubmitting(false);
  }

  if (!selectedSchedule) return null;
  return (
    <form className="checkout-layout" onSubmit={handleSubmit} ref={formRef} noValidate>
      <div className="checkout-main">
        {!corridorStops(route).length && destinationsFrom(route, "").length > 1 && (
          <section className="form-panel checkout-panel">
            <SegmentStopFields route={route} boarding="" dropoff={legacyStop} disabled={isSubmitting}
              onChange={(_, stop) => setStopSelection({ routeId: route.id, stop })} />
          </section>
        )}
        <section className="form-panel checkout-panel">
          <div>
            <p className="eyebrow">Cupos</p>
            <h2 className="route-title">¿Cuántos asientos comprás?</h2>
          </div>
          <div className="fare-pickers">
            <QuantityPicker
              label="Adultos (9 años o más)"
              value={passengerCount}
              max={Math.max(lugaresLibres - halfFareCount - freeFareCount, 1)}
              disabled={isSubmitting || !selectedSchedule}
              help={selectedSchedule ? `${lugaresLibres} lugares disponibles` : "Elegí una salida primero"}
              onChange={setPassengerCount}
            />
            <QuantityPicker
              label="Menores de 4 a 8 años · media tarifa"
              value={halfFareCount}
              min={0}
              max={Math.max(lugaresLibres - passengerCount - freeFareCount, 0)}
              disabled={isSubmitting || !selectedSchedule}
              help={selectedSchedule ? `${formatPrice(Math.round(precioUnitario / 2), selectedSchedule.currency)} cada uno` : "Elegí una salida primero"}
              onChange={setHalfFareCount}
            />
            <QuantityPicker
              label="Menores de 4 años · sin cargo"
              value={freeFareCount}
              min={0}
              max={Math.max(lugaresLibres - passengerCount - halfFareCount, 0)}
              disabled={isSubmitting || !selectedSchedule}
              help="Ocupan un lugar, no pagan"
              onChange={setFreeFareCount}
            />
          </div>
          {route.bookingMode === "SEATED" && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={requestDisabilityFare && personas === 1}
                disabled={isSubmitting || personas !== 1}
                onChange={(event) => setRequestDisabilityFare(event.target.checked)}
              />
              Solicitar viaje gratuito por discapacidad
            </label>
          )}
          {route.bookingMode === "SEATED" && <p className="muted">La solicitud es individual. Después de reservar, subí el comprobante para que administración confirme el viaje.</p>}
          <p className="muted">No hay asientos numerados: subís y te ubicás por orden de llegada. Tu reserva guarda los lugares del grupo.</p>
        </section>

        <section className="form-panel checkout-panel">
          <div>
            <p className="eyebrow">Pasajero</p>
            <h2 className="route-title">Datos del pasajero</h2>
          </div>
          <PassengerFields
            passenger={passenger}
            fieldErrors={fieldErrors}
            disabled={isSubmitting}
            onChange={updatePassenger}
          />
        </section>
      </div>

      <aside className="checkout-summary plain-card">
        <p className="eyebrow">Resumen</p>
        <h2 className="route-title">
          {boardingStop || route.from} → {dropoffStop || route.to}
        </h2>
        <div className="summary-list">
          <div>
            <span>Ruta</span>
            <strong>{route.via}</strong>
          </div>
          {terminalesDelViaje.salida ? (
            <div>
              <span>Sale de</span>
              <strong>{terminalesDelViaje.salida}</strong>
            </div>
          ) : null}
          {terminalesDelViaje.llegada ? (
            <div>
              <span>Llega a</span>
              <strong>{terminalesDelViaje.llegada}</strong>
            </div>
          ) : null}
          <div>
            <span>{boardingStop ? `Salida de ${route.from}` : "Fecha"}</span>
            <strong>{selectedSchedule ? formatDateTime(selectedSchedule.departureAt) : "Sin salida"}</strong>
          </div>
          <div>
            <span>Lugares</span>
            <strong>{personas} {personas === 1 ? "lugar" : "lugares"}</strong>
          </div>
          {halfFareCount > 0 ? (
            <div>
              <span>Menores 4 a 8</span>
              <strong>{halfFareCount} · media tarifa</strong>
            </div>
          ) : null}
          {freeFareCount > 0 ? (
            <div>
              <span>Menores de 4</span>
              <strong>{freeFareCount} · sin cargo</strong>
            </div>
          ) : null}
          <div>
            <span>{vuelta ? "Total ida y vuelta" : "Precio"}</span>
            <strong className="price">
              {requestDisabilityFare && personas === 1
                ? "Sin cargo, sujeto a aprobación"
                : formatPrice(totalPorEdad, selectedSchedule?.currency ?? route.currency)}
            </strong>
          </div>
        </div>
        <FormErrorSummary fieldErrors={fieldErrors} order={PASSENGER_FIELD_ORDER} />
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="button checkout-submit"
          type="submit"
          disabled={isSubmitting || personas > lugaresLibres}
        >
          {isSubmitting ? "Confirmando..." : "Confirmar reserva"}
        </button>
        <p className="muted legal-consent">
          Al confirmar, aceptás los <Link href="/terminos">términos y condiciones</Link> y la{" "}
          <Link href="/privacidad">política de privacidad</Link>.
        </p>
      </aside>
    </form>
  );
}

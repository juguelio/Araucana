"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
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
import { diaEfectivo, diasConSalidas } from "@/lib/booking/schedule-days";
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

/** Salida con el día ya etiquetado en hora argentina (lo arma la página en el servidor). */
export type CheckoutSchedule = CheckoutScheduleDto & { dayKey: string; dayLabel: string; timeLabel: string };

type CheckoutFormProps = {
  route: PublicRouteDto;
  schedules: CheckoutSchedule[];
  initialScheduleId?: string;
  initialFrom?: string;
  initialTo?: string;
  initialRoundTrip?: boolean;
  returnServices?: {
    route: Pick<PublicRouteDto, "from" | "to" | "bookingMode" | "currency" | "priceCents" | "stops">;
    schedules: Pick<CheckoutSchedule, "id" | "departureAt" | "availableSeats" | "priceCents">[];
  }[];
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

export function CheckoutForm({ route, schedules, initialScheduleId, initialFrom, initialTo, initialRoundTrip, returnServices = [] }: CheckoutFormProps) {
  const router = useRouter();
  // Sólo lo que se puede reservar de verdad: abiertas, con lugares y de hoy en adelante.
  // El día es el eje (igual que el alta del panel): con 258 salidas la tira plana era inusable.
  const bookableOptions = useMemo(() => ({
    schedules: schedules.filter((schedule) => bookableScheduleStatuses.has(schedule.status) && schedule.availableSeats > 0),
    seatMaps: [] as SeatMapDto[]
  }), [schedules]);
  const dias = useMemo(() => diasConSalidas(bookableOptions.schedules), [bookableOptions.schedules]);
  const salidaInicial = bookableOptions.schedules.find((schedule) => schedule.id === initialScheduleId) ?? bookableOptions.schedules[0];
  const [dia, setDia] = useState(salidaInicial?.dayKey ?? "");
  const diaElegido = diaEfectivo(dias, dia);
  const salidasDelDia = useMemo(
    () => bookableOptions.schedules.filter((schedule) => schedule.dayKey === diaElegido),
    [bookableOptions.schedules, diaElegido]
  );
  const [scheduleId, setScheduleId] = useState(salidaInicial?.id ?? "");
  const stops = corridorStops(route);
  const [boardingStop, setBoardingStop] = useState(stops.slice(1, -1).find((name) => name === initialFrom) ?? "");
  const [dropoffStop, setDropoffStop] = useState(() =>
    initialTo && initialTo !== route.to && segmentPrice(route, boardingStop, initialTo) !== undefined ? initialTo : "");
  const [roundTrip, setRoundTrip] = useState(Boolean(initialRoundTrip && stops.length));
  const [returnId, setReturnId] = useState("");
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
  const hasBookableSchedules = bookableOptions.schedules.length > 0;

  const selectedSchedule = useMemo(
    () => salidasDelDia.find((schedule) => schedule.id === scheduleId) ?? salidasDelDia[0] ?? null,
    [scheduleId, salidasDelDia]
  );

  const personas = passengerCount + halfFareCount + freeFareCount;
  const precioUnitario = segmentPrice(route, boardingStop, dropoffStop) ?? route.priceCents;
  const vueltas = useMemo(() => {
    if (!selectedSchedule || !roundTrip) return [];
    return returnServices.flatMap((service) => {
      const tarifa = segmentPrice(service.route, dropoffStop, boardingStop);
      if (tarifa === undefined) return [];
      return service.schedules.filter((s) => s.departureAt > selectedSchedule.departureAt)
        .map((s) => ({ ...s, priceCents: tarifa }));
    }).sort((a, b) => +new Date(a.departureAt) - +new Date(b.departureAt));
  }, [selectedSchedule, roundTrip, returnServices, boardingStop, dropoffStop]);
  const vuelta = roundTrip ? vueltas.find((s) => s.id === returnId) : undefined;
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

    if (!hasBookableSchedules || !selectedSchedule) {
      setError("Selecciona una salida disponible.");
      return;
    }

    if ((roundTrip && !vuelta) || personas > lugaresLibres) {
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
    }, vuelta?.id);

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

  return (
    <form className="checkout-layout" onSubmit={handleSubmit} ref={formRef} noValidate>
      <div className="checkout-main">
        <section className="form-panel checkout-panel">
          <div>
            <p className="eyebrow">Salida</p>
            <h2 className="route-title">Elegir salida</h2>
          </div>
          {hasBookableSchedules ? (
            <>
              <div className="checkout-dias" role="group" aria-label="Días con salidas">
                {dias.map((opcion) => (
                  <button
                    type="button"
                    key={opcion.key}
                    className={`dia-chip${opcion.key === diaElegido ? " activo" : ""}`}
                    aria-pressed={opcion.key === diaElegido}
                    title={`${opcion.count} ${opcion.count === 1 ? "salida" : "salidas"}`}
                    disabled={isSubmitting}
                    onClick={() => {
                      setDia(opcion.key);
                      const primera = bookableOptions.schedules.find((schedule) => schedule.dayKey === opcion.key);
                      if (primera) {
                        setScheduleId(primera.id);
                        setPassengerCount(1);
                      }
                    }}
                  >
                    {opcion.label}
                  </button>
                ))}
              </div>
              <fieldset className="schedule-picker" disabled={isSubmitting}>
                <legend>Salidas del día{boardingStop && ` desde ${route.from}`}</legend>
                <div className="schedule-rail" aria-label="Salidas del día">
                  {salidasDelDia.map((schedule) => (
                    <label className="schedule-option" key={schedule.id}>
                      <input
                        type="radio"
                        name="scheduleId"
                        value={schedule.id}
                        checked={selectedSchedule?.id === schedule.id}
                        onChange={(event) => {
                          setScheduleId(event.target.value);
                          setPassengerCount(1);
                        }}
                      />
                      <span className="schedule-card">
                        {/* El día ya está elegido arriba: acá va el estado, como en el panel. */}
                        <span className="schedule-date">{schedule.status === "DOCUMENTATION" ? "Documentación" : "Salida"}</span>
                        <strong className="schedule-time">{schedule.timeLabel}</strong>
                        <span className="schedule-seats">
                          {schedule.availableSeats} {schedule.availableSeats === 1 ? "asiento" : "asientos"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : null}
          {!hasBookableSchedules ? (
            <p className="muted">No hay salidas disponibles para reservar en este momento.</p>
          ) : null}
        </section>

        {destinationsFrom(route, "").length > 1 && (
          <section className="form-panel checkout-panel">
            <SegmentStopFields route={route} boarding={boardingStop} dropoff={dropoffStop} disabled={isSubmitting}
              onChange={(start, end) => { setBoardingStop(start); setDropoffStop(end); }} />
            {stops.length > 0 && (
              <>
                <label className="checkbox-row">
                  <input type="checkbox" checked={roundTrip} disabled={isSubmitting}
                    onChange={(event) => setRoundTrip(event.target.checked)} />
                  Ida y vuelta
                </label>
                {roundTrip && (
                  <label>
                    Vuelta · {dropoffStop || route.to} → {boardingStop || route.from}
                    <select value={vuelta?.id ?? ""} disabled={isSubmitting} onChange={(event) => setReturnId(event.target.value)}>
                      <option value="">{vueltas.length ? "Elegí la salida de vuelta" : "Sin vueltas disponibles después de la ida"}</option>
                      {vueltas.map((s) => <option key={s.id} value={s.id}>{formatDateTime(s.departureAt)} desde {route.to} · {s.availableSeats} lugares</option>)}
                    </select>
                    <small>Cada tramo tiene su reserva y su pago.</small>
                  </label>
                )}
              </>
            )}
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
          disabled={isSubmitting || !hasBookableSchedules || !selectedSchedule || (roundTrip && !vuelta)}
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

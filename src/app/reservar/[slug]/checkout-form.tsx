"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PublicRouteDto, ScheduleOptionDto, SeatMapDto } from "@/lib/booking/types";
import {
  buildPassengerPayload,
  initialPassenger,
  PassengerFields,
  QuantityPicker,
  validateCheckoutPassenger,
  type PassengerFieldErrors,
  type PassengerForm
} from "./passenger-fields";
import { createReservationAction } from "./actions";

// Se mantienen los exports de siempre: los dos checkouts comparten la lógica del pasajero.
export {
  buildPassengerPayload,
  filterNationalityOptions,
  getNationalityOptions,
  validateCheckoutPassenger
} from "./passenger-fields";

type CheckoutFormProps = {
  route: PublicRouteDto;
  schedules: ScheduleOptionDto[];
  initialScheduleId?: string;
};

const bookableScheduleStatuses = new Set(["OPEN", "DOCUMENTATION"]);

export function filterBookableSchedules(schedules: ScheduleOptionDto[], seatMaps: SeatMapDto[]) {
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

function formatScheduleDate(value: Date | string) {
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "America/Argentina/Salta"
  }).format(new Date(value)).replace(/\.$/, "");
}

function formatScheduleTime(value: Date | string) {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Salta"
  }).format(new Date(value));
}

function formatPrice(cents: number, currency: string) {
  if (cents <= 0) {
    return "Consultar";
  }

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(cents / 100);
}

export function CheckoutForm({ route, schedules, initialScheduleId }: CheckoutFormProps) {
  const router = useRouter();
  const bookableOptions = useMemo(() => ({
    schedules: schedules.filter((schedule) => bookableScheduleStatuses.has(schedule.status)),
    seatMaps: [] as SeatMapDto[]
  }), [schedules]);
  const firstScheduleId = bookableOptions.schedules[0]?.id ?? "";
  const preferredScheduleId = initialScheduleId && bookableOptions.schedules.some((schedule) => schedule.id === initialScheduleId) ? initialScheduleId : firstScheduleId;
  const [scheduleId, setScheduleId] = useState(preferredScheduleId);
  const [passengerCount, setPassengerCount] = useState(1);
  const [passenger, setPassenger] = useState<PassengerForm>(initialPassenger);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<PassengerFieldErrors>({});
  const hasBookableSchedules = bookableOptions.schedules.length > 0;

  const selectedSchedule = useMemo(
    () => bookableOptions.schedules.find((schedule) => schedule.id === scheduleId) ?? bookableOptions.schedules[0] ?? null,
    [scheduleId, bookableOptions.schedules]
  );
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

    setIsSubmitting(true);

    const result = await createReservationAction({
      scheduleId: selectedSchedule.id,
      passengerCount,
      passenger: buildPassengerPayload(passenger)
    });

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
    <form className="checkout-layout" onSubmit={handleSubmit} noValidate>
      <div className="checkout-main">
        <section className="form-panel checkout-panel">
          <div>
            <p className="eyebrow">Salida</p>
            <h2 className="route-title">Elegir salida</h2>
          </div>
          {hasBookableSchedules ? <fieldset className="schedule-picker" disabled={isSubmitting}>
            <legend>Salidas disponibles</legend>
            <div className="schedule-rail" aria-label="Salidas disponibles">
              {bookableOptions.schedules.map((schedule) => (
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
                    <span className="schedule-date">{formatScheduleDate(schedule.departureAt)}</span>
                    <strong className="schedule-time">{formatScheduleTime(schedule.departureAt)}</strong>
                    <span className="schedule-seats">{schedule.availableSeats} asientos</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset> : null}
          {!hasBookableSchedules ? (
            <p className="muted">No hay salidas disponibles para reservar en este momento.</p>
          ) : null}
        </section>

        <section className="form-panel checkout-panel">
          <div>
            <p className="eyebrow">Cupos</p>
            <h2 className="route-title">¿Cuántos asientos comprás?</h2>
          </div>
          <QuantityPicker
            label="Cantidad de asientos"
            value={passengerCount}
            max={selectedSchedule?.availableSeats}
            disabled={isSubmitting || !selectedSchedule}
            help={selectedSchedule ? `${selectedSchedule.availableSeats} lugares disponibles` : "Elegí una salida primero"}
            onChange={setPassengerCount}
          />
          <p className="muted">No se asignan asientos numerados. El equipo confirma los lugares disponibles.</p>
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
          {route.from} - {route.to}
        </h2>
        <div className="summary-list">
          <div>
            <span>Ruta</span>
            <strong>{route.via}</strong>
          </div>
          <div>
            <span>Fecha</span>
            <strong>{selectedSchedule ? formatDateTime(selectedSchedule.departureAt) : "Sin salida"}</strong>
          </div>
          <div>
            <span>Asientos</span>
            <strong>{passengerCount} {passengerCount === 1 ? "lugar" : "lugares"}</strong>
          </div>
          <div>
            <span>Precio</span>
            <strong className="price">
              {formatPrice((selectedSchedule?.priceCents ?? route.priceCents) * passengerCount, selectedSchedule?.currency ?? route.currency)}
            </strong>
          </div>
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="button checkout-submit"
          type="submit"
          disabled={isSubmitting || !hasBookableSchedules || !selectedSchedule}
        >
          {isSubmitting ? "Confirmando..." : "Confirmar reserva"}
        </button>
      </aside>
    </form>
  );
}

"use client";

import { useEffect, useState } from "react";
import { FieldError } from "../../form-ui";
import type { ServiceMove } from "./editar/service-options";

/** Lo que eligió el operador: `null` = se queda en el servicio actual. */
export type ServiceMoveDraft =
  | { mode: "SEATED"; scheduleId: string; routeId: string; priceCents: number }
  | { mode: "AIRPORT"; flightId: string; direction: "ARRIVAL" | "DEPARTURE" }
  | { mode: "CHAPELCO"; serviceDate: string; ascentSlot: string }
  | null;

type VueloDelDia = {
  id: string;
  number: string;
  direction: "ARRIVAL" | "DEPARTURE";
  airline: string | null;
  scheduledAt: string;
  available: number;
  bookable: boolean;
  reason: string | null;
};

const hora = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });

type Props = {
  service: ServiceMove;
  disabled: boolean;
  error?: string;
  onChange: (draft: ServiceMoveDraft) => void;
};

/**
 * «Servicio» en Editar reserva: pasar la reserva a otra salida, otro vuelo u otra fecha/franja.
 * Lo que se ofrece es orientativo: al guardar, el servidor mide el cupo y el horario de nuevo.
 */
export function ServiceMoveFields({ service, disabled, error, onChange }: Props) {
  if (service.mode === "SEATED") return <SalidaFields service={service} disabled={disabled} error={error} onChange={onChange} />;
  if (service.mode === "AIRPORT") return <VueloFields service={service} disabled={disabled} error={error} onChange={onChange} />;
  return <ChapelcoFields service={service} disabled={disabled} error={error} onChange={onChange} />;
}

function SalidaFields({ service, disabled, error, onChange }: Props & { service: Extract<ServiceMove, { mode: "SEATED" }> }) {
  const [scheduleId, setScheduleId] = useState(service.currentScheduleId);
  const actualEnLista = service.options.some((option) => option.id === service.currentScheduleId);
  return (
    <label className="reservation-edit-wide">
      Salida
      <select name="moveScheduleId" value={scheduleId} disabled={disabled}
        aria-invalid={Boolean(error)} aria-describedby={error ? "reservation-move-error" : undefined}
        onChange={(event) => {
          const id = event.target.value;
          setScheduleId(id);
          const option = service.options.find((item) => item.id === id);
          onChange(id === service.currentScheduleId || !option ? null : { mode: "SEATED", scheduleId: id, routeId: option.routeId, priceCents: option.priceCents });
        }}>
        {actualEnLista ? null : <option value={service.currentScheduleId}>La salida actual (ya pasó o está cerrada)</option>}
        {service.options.map((option) => (
          <option key={option.id} value={option.id} disabled={option.id !== service.currentScheduleId && option.free <= 0}>
            {option.id === service.currentScheduleId ? `${option.label} (actual)` : option.label}
          </option>
        ))}
      </select>
      <small>Salidas abiertas de los próximos 120 días. Al cambiar, se le asigna el primer asiento libre de la salida nueva.</small>
      <FieldError id="reservation-move-error" message={error} />
    </label>
  );
}

function VueloFields({ service, disabled, error, onChange }: Props & { service: Extract<ServiceMove, { mode: "AIRPORT" }> }) {
  const [date, setDate] = useState(service.currentDate);
  const [flights, setFlights] = useState<VueloDelDia[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [flightId, setFlightId] = useState(service.currentFlightId ?? "");

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let vigente = true;
    setLoading(true);
    setLoadError("");
    fetch(`/api/v1/airport/flights?slug=${encodeURIComponent(service.routeSlug)}&date=${date}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("No pudimos traer los vuelos de ese día.");
        return (await response.json()) as { flights: VueloDelDia[] };
      })
      .then((data) => { if (vigente) setFlights(data.flights); })
      .catch((caught: unknown) => { if (vigente) { setFlights([]); setLoadError(caught instanceof Error ? caught.message : "No pudimos traer los vuelos."); } })
      .finally(() => { if (vigente) setLoading(false); });
    return () => { vigente = false; };
  }, [date, service.routeSlug]);

  const elegir = (id: string) => {
    setFlightId(id);
    const vuelo = flights.find((item) => item.id === id);
    onChange(!vuelo || id === service.currentFlightId ? null : { mode: "AIRPORT", flightId: id, direction: vuelo.direction });
  };

  return (
    <>
      <p className="reservation-edit-wide muted">Vuelo actual: <strong>{service.currentLabel}</strong></p>
      <label>
        Día del vuelo
        <input type="date" value={date} disabled={disabled} onChange={(event) => { setDate(event.target.value); elegir(""); }} />
      </label>
      <label>
        Vuelo
        <select name="moveFlightId" value={flights.some((item) => item.id === flightId) ? flightId : ""} disabled={disabled || loading}
          aria-invalid={Boolean(error)} aria-describedby={error ? "reservation-move-error" : undefined}
          onChange={(event) => elegir(event.target.value)}>
          <option value="">{loading ? "Buscando vuelos…" : flights.length ? "Elegí un vuelo" : "No hay vuelos ese día"}</option>
          {flights.map((vuelo) => {
            const actual = vuelo.id === service.currentFlightId;
            return (
              <option key={vuelo.id} value={vuelo.id} disabled={!actual && !vuelo.bookable}>
                {vuelo.direction === "ARRIVAL" ? "Arribo" : "Salida"} {vuelo.number}{vuelo.airline ? ` (${vuelo.airline})` : ""} · {hora.format(new Date(vuelo.scheduledAt))}
                {actual ? " (actual)" : vuelo.bookable ? ` · ${vuelo.available} libres` : ` · ${vuelo.reason ?? "no disponible"}`}
              </option>
            );
          })}
        </select>
        <FieldError id="reservation-move-error" message={error || loadError} />
      </label>
      <p className="reservation-edit-wide muted">
        Si el vuelo nuevo es del otro sentido, la reserva pasa a la tarifa de ese sentido. La nave y el lugar en la recorrida se vuelven a armar en la orden de servicio.
      </p>
    </>
  );
}

function ChapelcoFields({ service, disabled, error, onChange }: Props & { service: Extract<ServiceMove, { mode: "CHAPELCO" }> }) {
  const [serviceDate, setServiceDate] = useState(service.serviceDate);
  const [ascentSlot, setAscentSlot] = useState(service.ascentSlot);
  const avisar = (fecha: string, franja: string) =>
    onChange(fecha === service.serviceDate && franja === service.ascentSlot ? null : { mode: "CHAPELCO", serviceDate: fecha, ascentSlot: franja });
  const slots = service.slots.includes(service.ascentSlot) ? service.slots : [service.ascentSlot, ...service.slots];
  return (
    <>
      <label>
        Fecha del servicio
        <input type="date" name="moveServiceDate" value={serviceDate} disabled={disabled}
          aria-invalid={Boolean(error)} aria-describedby={error ? "reservation-move-error" : undefined}
          onChange={(event) => { setServiceDate(event.target.value); avisar(event.target.value, ascentSlot); }} />
      </label>
      <label>
        Franja de subida
        <select name="moveAscentSlot" value={ascentSlot} disabled={disabled}
          onChange={(event) => { setAscentSlot(event.target.value); avisar(serviceDate, event.target.value); }}>
          {slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
        </select>
      </label>
      <p className="reservation-edit-wide muted">Al cambiar de día o de franja, la reserva sale de la vuelta asignada y queda para asignar en el tablero de Chapelco.</p>
      <FieldError id="reservation-move-error" message={error} />
    </>
  );
}

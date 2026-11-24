"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PassengerFields, buildPassengerPayload, initialPassenger, validateCheckoutPassenger, type PassengerFieldErrors } from "@/app/reservar/[slug]/passenger-fields";
import { PrivateAirportContext, type PrivateAirportLeg } from "@/app/reservar/[slug]/private-airport-context";
import { parseReservationPrice } from "@/lib/booking/admin-price";
import { nuevaClaveDeIdempotencia } from "@/lib/booking/idempotency";
import { privatePassengerCount, type PrivateStop } from "@/lib/airport/private-transfer";
import { effectiveFlightTime } from "@/lib/airport/round-trip-summary";
import { PrivateStopsFields, type PrivateVehicleOption } from "./private-stops-fields";
import type { AirportFares } from "@/lib/airport/fares";

function emptyLeg() {
  return {
    manualFor: "", number: "", time: "", price: "", vehicleId: "",
    stops: [{ destination: "", passengers: 1 }] as PrivateStop[]
  };
}
type Draft = ReturnType<typeof emptyLeg>;

function manualKey(leg: PrivateAirportLeg) {
  return `${leg.direction}/${leg.date}`;
}

function legPayload(leg: PrivateAirportLeg, draft: Draft) {
  const manual = !leg.flight && draft.manualFor === manualKey(leg);
  return {
    flightNumber: leg.flight?.number ?? (manual ? draft.number.trim() : ""),
    serviceDate: leg.date,
    privateFlight: manual ? { number: draft.number.trim(), scheduledAt: `${leg.date}T${draft.time}:00-03:00` } : undefined,
    privateTransfer: {
      flightId: leg.flight?.id, stops: draft.stops, vehicleId: draft.vehicleId || undefined,
      totalCents: parseReservationPrice(draft.price)
    }
  };
}

export function AirportTransferChoice({ children, fares, vehicles, slug }: {
  children: ReactNode; fares: AirportFares; vehicles: PrivateVehicleOption[]; slug: string
}) {
  const router = useRouter();
  const [privada, setPrivada] = useState(false);
  const [first, setFirst] = useState(emptyLeg);
  const [second, setSecond] = useState(emptyLeg);
  const [passenger, setPassenger] = useState(initialPassenger);
  const [errors, setErrors] = useState<PassengerFieldErrors>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [referredBy, setReferredBy] = useState("");
  const attempt = useRef({ request: "", key: "" });

  async function submit(event: FormEvent<HTMLFormElement>, legs: PrivateAirportLeg[]) {
    event.preventDefault();
    if (pending) return;
    setError("");
    const drafts = [first, second];
    const [ida, vuelta] = legs.map((leg, i) => legPayload(leg, drafts[i]));
    if (!ida.flightNumber || (vuelta && !vuelta.flightNumber)) {
      setError(!ida.flightNumber ? "Elegí el vuelo de ida." : "Elegí el vuelo de vuelta.");
      return;
    }
    if (vuelta) {
      const outbound = legs[0].flight ?? ida.privateFlight!;
      const inbound = legs[1].flight ?? vuelta.privateFlight!;
      if (effectiveFlightTime(inbound) <= effectiveFlightTime(outbound)) {
        setError("El vuelo de vuelta tiene que ser posterior al de ida.");
        return;
      }
    }
    const issues = validateCheckoutPassenger(passenger, true, true);
    setErrors(issues);
    if (Object.keys(issues).length) { setError("Revisá los datos del titular."); return; }
    const count = privatePassengerCount(first.stops);
    if (count > 24 || (vuelta && count !== privatePassengerCount(second.stops))) {
      setError("El grupo admite hasta 24 pasajeros y debe tener la misma cantidad en ambos tramos."); return;
    }
    if (ida.privateTransfer.totalCents == null || (vuelta && vuelta.privateTransfer.totalCents == null)) {
      setError("Ingresá el precio total de cada tramo con hasta dos decimales."); return;
    }

    const direction = legs[0].direction;
    const body = {
      routeSlug: slug, passengerCount: count, passenger: buildPassengerPayload(passenger), referredBy: referredBy.trim() || undefined,
      ...(vuelta ? { firstLeg: direction, arrival: direction === "ARRIVAL" ? ida : vuelta, departure: direction === "DEPARTURE" ? ida : vuelta } : { ...ida, direction })
    };
    setPending(true);
    try {
      const request = JSON.stringify(body);
      if (request !== attempt.current.request) attempt.current = { request, key: nuevaClaveDeIdempotencia() };
      const response = await fetch(`/api/v1/airport/reservations${vuelta ? "/round-trip" : ""}?source=admin`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, idempotencyKey: attempt.current.key })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "No se pudo crear la reserva.");
      const booked = vuelta ? data.roundTrip[direction === "ARRIVAL" ? "arrival" : "departure"] : data.reservation;
      router.push(`/admin/reservas/${booked.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la reserva.");
      setPending(false);
    }
  }

  function renderForm(search: ReactNode, legs: PrivateAirportLeg[], flightError: string) {
    return <form onSubmit={event => submit(event, legs)} className="form-panel checkout-panel">
      <div inert={pending} className="private-transfer-fields">
        <h2 className="route-title">Traslado privado de aeropuerto</h2>
        {search}
        {flightError && <p className="error" role="alert">{flightError}</p>}
        {legs.map((leg, i) => {
          const [draft, change] = i === 0 ? [first, setFirst] as const : [second, setSecond] as const;
          const manual = !leg.flight && draft.manualFor === manualKey(leg);
          return <section key={leg.direction} className="leg-card private-leg">
            <h3>{i === 0 ? "Ida" : "Vuelta"} · {leg.direction === "ARRIVAL" ? "Dónde bajan" : "Dónde se buscan"}</h3>
            <button type="button" className="ghost-button" aria-expanded={manual} onClick={() => {
              leg.clearFlight();
              change({ ...draft, manualFor: manual ? "" : manualKey(leg), number: "", time: "" });
            }}>{manual ? "Volver a elegir de la lista" : "Cargar vuelo fuera de la lista"}</button>
            {manual && <>
              <label>Número de vuelo o matrícula<input required minLength={3} maxLength={24} value={draft.number}
                onChange={e => change({ ...draft, number: e.target.value })} /></label>
              <label>Hora del vuelo<input type="time" required value={draft.time} onChange={e => change({ ...draft, time: e.target.value })} /></label>
            </>}
            <PrivateStopsFields stops={draft.stops} vehicles={vehicles} vehicleId={draft.vehicleId}
              onChange={stops => change({ ...draft, stops })} onVehicle={vehicleId => change({ ...draft, vehicleId })} />
            <label>Precio total del tramo ({fares[leg.direction]?.currency})<input inputMode="decimal" required value={draft.price}
              onChange={e => change({ ...draft, price: e.target.value })} /></label>
          </section>;
        })}
        <h3>Datos del titular</h3>
        <PassengerFields passenger={passenger} fieldErrors={errors} optionalIdentity optionalDocument
          onChange={(key, value) => setPassenger({ ...passenger, [key]: value })} />
        <label>Derivado por (opcional)<input maxLength={120} value={referredBy} onChange={e => setReferredBy(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="button" disabled={pending}>{pending ? "Guardando…" : "Crear reserva privada"}</button>
      </div>
    </form>;
  }

  const place = first.stops.length > 1 ? `${first.stops.length} paradas` : first.stops[0].destination.trim() || "Alojamiento o dirección";
  return <PrivateAirportContext.Provider value={privada ? { place, renderForm } : null}>
    <label className="checkbox-row"><input type="checkbox" checked={privada} disabled={pending}
      onChange={e => { setPrivada(e.target.checked); setError(""); }} />Privada · nave exclusiva para el grupo</label>
    {children}
  </PrivateAirportContext.Provider>;
}

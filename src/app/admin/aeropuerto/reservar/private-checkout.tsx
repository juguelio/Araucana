"use client";

import { Activity, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PassengerFields, buildPassengerPayload, initialPassenger, validateCheckoutPassenger, type PassengerFieldErrors } from "@/app/reservar/[slug]/passenger-fields";
import { parseReservationPrice } from "@/lib/booking/admin-price";
import { nuevaClaveDeIdempotencia } from "@/lib/booking/idempotency";
import { privatePassengerCount, type PrivateStop } from "@/lib/airport/private-transfer";
import { PrivateStopsFields, type PrivateVehicleOption } from "./private-stops-fields";
import type { AirportFares } from "@/lib/airport/fares";

type Direction = "ARRIVAL" | "DEPARTURE";
type Flight = { id: string; number: string; direction: Direction; scheduledAt: string; privateBookable?: boolean; bookable: boolean };
type Props = { children: ReactNode; initialDate: string; initialDirection: Direction; initialFlightId?: string; roundTrip: boolean;
  initialFlights: Flight[]; fares: AirportFares; vehicles: PrivateVehicleOption[]; slug: string };

function initialLeg(date: string, flightNumber = "") {
  return { date, flightNumber, manualTime: "", manual: false, price: "", vehicleId: "", stops: [{ destination: "", passengers: 1 }] as PrivateStop[] };
}
type Leg = ReturnType<typeof initialLeg>;

function PrivateLeg({ leg, change, direction, initialDate, initialFlights, vehicles, slug, fares }: Pick<Props, "initialDate" | "initialFlights" | "vehicles" | "slug" | "fares"> & {
  leg: Leg; change: (leg: Leg) => void; direction: Direction;
}) {
  const [loaded, setLoaded] = useState({ date: initialDate, flights: initialFlights, error: "" });
  useEffect(() => {
    if (leg.date === initialDate || !leg.date) return;
    const abort = new AbortController();
    const params = new URLSearchParams({ slug, date: leg.date });
    fetch(`/api/v1/airport/flights?${params}`, { signal: abort.signal })
      .then(async res => {
        if (!res.ok) throw new Error();
        const { flights } = await res.json();
        if (!abort.signal.aborted) setLoaded({ date: leg.date, flights, error: "" });
      }).catch(() => { if (!abort.signal.aborted) setLoaded({ date: leg.date, flights: [], error: "No se pudieron cargar los vuelos de ese día." }); });
    return () => abort.abort();
  }, [leg.date, initialDate, slug]);
  const flights = leg.date === initialDate ? initialFlights : loaded.date === leg.date ? loaded.flights : [];
  const choices = flights.filter(f => f.direction === direction && (f.privateBookable ?? f.bookable));
  return <section className="leg-card private-leg">
    <h3>{direction === "ARRIVAL" ? "Desde el aeropuerto · dónde bajan" : "Hacia el aeropuerto · dónde se buscan"}</h3>
    <label>Fecha del vuelo<input type="date" required value={leg.date} onChange={e => change({ ...leg, date: e.target.value, flightNumber: "" })} /></label>
    <label>Vuelo
      <select required value={leg.manual ? "manual" : leg.flightNumber} onChange={e => change({ ...leg, manual: e.target.value === "manual", flightNumber: e.target.value === "manual" ? "" : e.target.value })}>
        <option value="">Elegí el vuelo</option>
        {choices.map(f => <option key={f.id} value={f.number}>{f.number} · {new Date(f.scheduledAt).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Salta", hour: "2-digit", minute: "2-digit" })}</option>)}
        <option value="manual">Cargar vuelo fuera de la lista</option>
      </select>
    </label>
    {leg.date !== initialDate && loaded.date === leg.date && loaded.error && <p role="alert">{loaded.error}</p>}
    {leg.manual && <>
      <label>Número de vuelo o matrícula<input required minLength={3} maxLength={24} value={leg.flightNumber} onChange={e => change({ ...leg, flightNumber: e.target.value })} /></label>
      <label>Hora del vuelo<input type="time" required value={leg.manualTime} onChange={e => change({ ...leg, manualTime: e.target.value })} /></label>
    </>}
    <PrivateStopsFields stops={leg.stops} vehicles={vehicles} vehicleId={leg.vehicleId} onChange={stops => change({ ...leg, stops })} onVehicle={vehicleId => change({ ...leg, vehicleId })} />
    <label>Precio total del tramo ({fares[direction]?.currency})<input inputMode="decimal" required value={leg.price} onChange={e => change({ ...leg, price: e.target.value })} /></label>
  </section>;
}

export function AirportTransferChoice({ children, ...props }: Props) {
  const router = useRouter();
  const [privada, setPrivada] = useState(false);
  const [direction, setDirection] = useState(props.initialDirection);
  const [roundTrip, setRoundTrip] = useState(props.roundTrip);
  const [first, setFirst] = useState(() => initialLeg(props.initialDate, props.initialFlights.find(f => f.id === props.initialFlightId)?.number));
  const [second, setSecond] = useState(() => initialLeg(props.initialDate));
  const [passenger, setPassenger] = useState(initialPassenger);
  const [errors, setErrors] = useState<PassengerFieldErrors>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [referredBy, setReferredBy] = useState("");
  const attempt = useRef("");
  const reverse = direction === "ARRIVAL" ? "DEPARTURE" : "ARRIVAL";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    const issues = validateCheckoutPassenger(passenger, true, true);
    setErrors(issues);
    if (Object.keys(issues).length) { setError("Revisá los datos del titular."); return; }
    const count = privatePassengerCount(first.stops);
    if (count > 24 || (roundTrip && count !== privatePassengerCount(second.stops))) {
      setError("El grupo admite hasta 24 pasajeros y debe tener la misma cantidad en ambos tramos."); return;
    }
    function payload(leg: Leg) {
      return { flightNumber: leg.flightNumber.trim(), serviceDate: leg.date,
        privateFlight: leg.manual ? { number: leg.flightNumber.trim(), scheduledAt: `${leg.date}T${leg.manualTime}:00-03:00` } : undefined,
        privateTransfer: { stops: leg.stops, vehicleId: leg.vehicleId || undefined, totalCents: parseReservationPrice(leg.price) } };
    }
    const ida = payload(first);
    const vuelta = payload(second);
    if (ida.privateTransfer.totalCents == null || (roundTrip && vuelta.privateTransfer.totalCents == null)) {
      setError("Ingresá el precio total de cada tramo con hasta dos decimales."); return;
    }
    setPending(true);
    try {
      attempt.current ||= nuevaClaveDeIdempotencia();
      const body = { idempotencyKey: attempt.current, routeSlug: props.slug, passengerCount: count,
        passenger: buildPassengerPayload(passenger), referredBy: referredBy.trim() || undefined,
        ...(roundTrip ? { firstLeg: direction, arrival: direction === "ARRIVAL" ? ida : vuelta, departure: direction === "DEPARTURE" ? ida : vuelta } : { ...ida, direction }) };
      const response = await fetch(`/api/v1/airport/reservations${roundTrip ? "/round-trip" : ""}?source=admin`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "No se pudo crear la reserva.");
      const booked = roundTrip ? data.roundTrip[direction === "ARRIVAL" ? "arrival" : "departure"] : data.reservation;
      router.push(`/admin/reservas/${booked.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la reserva."); setPending(false);
    }
  }
  return <>
    <label className="checkbox-row"><input type="checkbox" checked={privada} disabled={pending} onChange={e => setPrivada(e.target.checked)} />Privada · nave exclusiva para el grupo</label>
    <Activity mode={privada ? "hidden" : "visible"}>{children}</Activity>
    {privada && <form onSubmit={submit} className="form-panel checkout-panel">
      <fieldset disabled={pending} className="private-transfer-fields">
        <h2 className="route-title">Traslado privado de aeropuerto</h2>
        <label>Sentido de la ida<select value={direction} onChange={e => { setDirection(e.target.value as Direction); setFirst({ ...first, flightNumber: "" }); setSecond({ ...second, flightNumber: "" }); }}>
          {props.fares.ARRIVAL && <option value="ARRIVAL">Desde el aeropuerto</option>}
          {props.fares.DEPARTURE && <option value="DEPARTURE">Hacia el aeropuerto</option>}
        </select></label>
        {props.fares[reverse] && <label className="checkbox-row"><input type="checkbox" checked={roundTrip} onChange={e => setRoundTrip(e.target.checked)} />Ida y vuelta</label>}
        <PrivateLeg {...props} leg={first} change={setFirst} direction={direction} />
        {roundTrip && <PrivateLeg {...props} leg={second} change={setSecond} direction={reverse} />}
        <h3>Datos del titular</h3>
        <PassengerFields passenger={passenger} fieldErrors={errors} optionalIdentity optionalDocument onChange={(key, value) => setPassenger({ ...passenger, [key]: value })} />
        <label>Derivado por (opcional)<input maxLength={120} value={referredBy} onChange={e => setReferredBy(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="button">{pending ? "Guardando…" : "Crear reserva privada"}</button>
      </fieldset>
    </form>}
  </>;
}

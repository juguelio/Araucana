"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { buildPassengerPayload, validateCheckoutPassenger } from "./checkout-form";

/** Mismo shape que usa el checkout común (se deriva, así no se duplica el tipo). */
type PassengerForm = Parameters<typeof buildPassengerPayload>[0];

/**
 * Checkout del aeropuerto: **el pasajero elige el vuelo, no una salida fija**.
 * El aeropuerto no define sus salidas — están supeditadas a los vuelos (demoras, cancelaciones),
 * así que acá se elige el día, se ven los vuelos de ese día y se reserva sobre el vuelo elegido.
 */

type AirportRouteProps = {
  slug: string;
  from: string;
  to: string;
  priceCents: number;
  currency: string;
  description: string;
};

type FlightOption = {
  id: string;
  number: string;
  direction: "ARRIVAL" | "DEPARTURE";
  airline: string | null;
  scheduledAt: string;
  estimatedAt: string | null;
  status: string;
  available: number;
  bookable: boolean;
  reason: string | null;
};

type AirportCheckoutFormProps = {
  route: AirportRouteProps;
  initialDate: string;
  initialFlights: FlightOption[];
};

const sentidoTexto = (d: "ARRIVAL" | "DEPARTURE") => (d === "ARRIVAL" ? "Arribo" : "Salida");

const initialPassenger: PassengerForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  phoneCountryCode: "54",
  documentType: "DNI",
  documentId: "",
  nationality: "Argentina"
};

function hhmm(iso: string | null) {
  if (!iso) return "—";
  return new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);
}

function estadoTexto(vuelo: FlightOption) {
  if (vuelo.status === "CANCELLED") return "Cancelado";
  if (vuelo.status === "DIVERTED") return "Desviado";
  const min = Math.round(((vuelo.estimatedAt ? new Date(vuelo.estimatedAt) : new Date(vuelo.scheduledAt)).getTime() - new Date(vuelo.scheduledAt).getTime()) / 60000);
  if (min >= 30) return `Demorado ${min} min`;
  return "En horario";
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

export function AirportCheckoutForm({ route, initialDate, initialFlights }: AirportCheckoutFormProps) {
  const router = useRouter();
  const [date, setDate] = useState(initialDate);
  const [flights, setFlights] = useState<FlightOption[]>(initialFlights);
  const [flightNumber, setFlightNumber] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [passengerCount, setPassengerCount] = useState(1);
  const [pickupName, setPickupName] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupNotes, setPickupNotes] = useState("");
  const [passenger, setPassenger] = useState<PassengerForm>(initialPassenger);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cargandoVuelos, setCargandoVuelos] = useState(false);

  const selected = useMemo(() => flights.find((f) => f.id === selectedId) ?? null, [flights, selectedId]);
  // El sentido (arribo o salida) lo define el vuelo elegido, no la página.
  const sentido = selected?.direction ?? "ARRIVAL";
  const total = route.priceCents * passengerCount;

  async function cargarVuelos(fecha: string) {
    setCargandoVuelos(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/airport/flights?slug=${encodeURIComponent(route.slug)}&date=${fecha}`);
      const data = await res.json();
      if (!res.ok) {
        setFlights([]);
        setError(data?.error?.message ?? "No pudimos traer los vuelos de ese día.");
      } else {
        setFlights(data.flights ?? []);
        setSelectedId("");
      }
    } catch {
      setFlights([]);
      setError("No pudimos traer los vuelos de ese día. Probá de nuevo.");
    }
    setCargandoVuelos(false);
  }

  /** El pasajero puede escribir el número de vuelo: lo buscamos en los del día y lo seleccionamos. */
  function buscarPorNumero(valor: string) {
    const buscado = valor.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!buscado) return;
    // Si el mismo número aparece más de una vez (p. ej. cargado a mano y traído de la API),
    // preferimos uno reservable: elegir uno que ya salió sería un callejón sin salida.
    const candidatos = flights.filter((f) => f.number.toUpperCase().replace(/[^A-Z0-9]/g, "") === buscado);
    const encontrado = candidatos.find((f) => f.bookable) ?? candidatos[0];
    if (encontrado) {
      setSelectedId(encontrado.id);
      setError(encontrado.bookable ? "" : `El vuelo ${encontrado.number} no se puede reservar: ${encontrado.reason}`);
    } else {
      setSelectedId("");
      setError(`No encontramos el vuelo ${valor.toUpperCase()} para el ${date}. Puede que no opere ese día.`);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const errors: Record<string, string> = { ...validateCheckoutPassenger(passenger) };
    if (!selected) errors.flight = "Elegí un vuelo de la lista (o escribí el número de vuelo).";
    if (selected && !selected.bookable) errors.flight = selected.reason ?? "Ese vuelo no se puede reservar.";
    if (selected && passengerCount > selected.available) errors.passengerCount = `Sólo quedan ${selected.available} lugares en ese vuelo.`;
    if (sentido === "ARRIVAL" && !pickupName.trim()) errors.pickupName = "Ingresá el hotel o lugar donde te llevamos.";
    if (sentido === "ARRIVAL" && !pickupAddress.trim()) errors.pickupAddress = "Ingresá la dirección.";
    if (sentido === "DEPARTURE" && !pickupAddress.trim()) errors.pickupAddress = "Ingresá dónde te pasamos a buscar.";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Revisá los campos marcados.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/v1/airport/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeSlug: route.slug,
          flightNumber: selected!.number,
          direction: selected!.direction,
          serviceDate: date,
          passengerCount,
          passenger: buildPassengerPayload(passenger),
          pickupName: pickupName.trim() || undefined,
          pickupAddress: pickupAddress.trim() || undefined,
          pickupNotes: pickupNotes.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "No pudimos crear la reserva.");
        setIsSubmitting(false);
        return;
      }
      router.push(`/reservas/${data.reservation.code}`);
    } catch {
      setError("No pudimos crear la reserva. Probá de nuevo.");
      setIsSubmitting(false);
    }
  }

  return (
    <form className="checkout-layout" onSubmit={handleSubmit} noValidate>
      <div className="checkout-main">
        <section className="form-panel checkout-panel">
          <div>
            <p className="eyebrow">Aeropuerto</p>
            <h2 className="route-title">Elegí tu vuelo</h2>
            <p className="muted">
              Elegí el día y tu vuelo. Se ven <strong>todos los vuelos de ese día</strong> —arribos y salidas—
              y elegís el tuyo: el horario del traslado sigue al vuelo, así que si se demora, se corre solo.
            </p>
          </div>

          {error ? <p className="error">{error}</p> : null}

          <div className="checkout-fields">
            <label>
              Día
              <input type="date" value={date} onChange={(e) => { setDate(e.target.value); void cargarVuelos(e.target.value); }} />
            </label>

            <label>
              Número de vuelo (opcional)
              <input
                value={flightNumber}
                placeholder="Ej. AR1656"
                onChange={(e) => setFlightNumber(e.target.value)}
                onBlur={(e) => buscarPorNumero(e.target.value)}
              />
            </label>
          </div>

          {cargandoVuelos ? <p className="muted">Buscando vuelos…</p> : null}

          {flights.length === 0 && !cargandoVuelos ? (
            <p className="muted">No hay vuelos cargados para ese día. Probá otra fecha o consultanos por WhatsApp.</p>
          ) : (
            <div className="summary-list">
              {flights.map((f) => (
                <label key={f.id} className="muted">
                  <input
                    type="radio"
                    name="flight"
                    value={f.id}
                    checked={selectedId === f.id}
                    disabled={!f.bookable}
                    onChange={() => { setSelectedId(f.id); setError(""); }}
                  />{" "}
                  <strong>{hhmm(f.estimatedAt ?? f.scheduledAt)}</strong> · {f.number}
                  {f.airline ? ` (${f.airline})` : ""} · <b>{sentidoTexto(f.direction)}</b> — {estadoTexto(f)}
                  {f.bookable ? ` · ${f.available} lugares` : ` · ${f.reason}`}
                </label>
              ))}
            </div>
          )}
          {fieldErrors.flight ? <p className="field-error">{fieldErrors.flight}</p> : null}
        </section>

        <section className="form-panel checkout-panel">
          <p className="eyebrow">Pasajero</p>
          <h2 className="route-title">Tus datos</h2>
          <div className="checkout-fields">
            <label>Nombre<input name="firstName" autoComplete="given-name" value={passenger.firstName} onChange={(e) => setPassenger({ ...passenger, firstName: e.target.value })} />{fieldErrors.firstName ? <span className="field-error">{fieldErrors.firstName}</span> : null}</label>
            <label>Apellido<input name="lastName" autoComplete="family-name" value={passenger.lastName} onChange={(e) => setPassenger({ ...passenger, lastName: e.target.value })} />{fieldErrors.lastName ? <span className="field-error">{fieldErrors.lastName}</span> : null}</label>
            <label>Email<input name="email" type="email" autoComplete="email" value={passenger.email} onChange={(e) => setPassenger({ ...passenger, email: e.target.value })} />{fieldErrors.email ? <span className="field-error">{fieldErrors.email}</span> : null}</label>
            <label>Teléfono (con código de país)<input name="phone" autoComplete="tel" value={passenger.phone} onChange={(e) => setPassenger({ ...passenger, phone: e.target.value })} />{fieldErrors.phone ? <span className="field-error">{fieldErrors.phone}</span> : null}</label>
            <label>Documento
              <select name="documentType" value={passenger.documentType} onChange={(e) => setPassenger({ ...passenger, documentType: e.target.value })}>
                <option value="DNI">DNI</option>
                <option value="Pasaporte">Pasaporte</option>
                <option value="CI">CI</option>
              </select>
            </label>
            <label>Número de documento<input name="documentId" value={passenger.documentId} onChange={(e) => setPassenger({ ...passenger, documentId: e.target.value })} />{fieldErrors.documentId ? <span className="field-error">{fieldErrors.documentId}</span> : null}</label>
            <label>Cantidad de pasajeros<input name="passengerCount" type="number" min={1} max={24} value={passengerCount} onChange={(e) => setPassengerCount(Number(e.target.value))} />{fieldErrors.passengerCount ? <span className="field-error">{fieldErrors.passengerCount}</span> : null}</label>
          </div>
          <div className="checkout-fields">
            <label>{sentido === "ARRIVAL" ? "Hotel o lugar (en San Martín de los Andes)" : "Dónde te buscamos"}<input name="pickupName" value={pickupName} onChange={(e) => setPickupName(e.target.value)} />{fieldErrors.pickupName ? <span className="field-error">{fieldErrors.pickupName}</span> : null}</label>
            <label>Dirección<input name="pickupAddress" autoComplete="street-address" value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} />{fieldErrors.pickupAddress ? <span className="field-error">{fieldErrors.pickupAddress}</span> : null}</label>
            <label>Notas (opcional)<input name="pickupNotes" value={pickupNotes} onChange={(e) => setPickupNotes(e.target.value)} /></label>
          </div>
        </section>
      </div>

      <aside className="checkout-summary plain-card">
        <p className="eyebrow">Resumen</p>
        <h2 className="route-title">{route.from} - {route.to}</h2>
        <div className="summary-list">
          <span>Día: <strong>{date}</strong></span>
          <span>Vuelo: <strong>{selected ? `${selected.number} (${sentidoTexto(sentido)})` : "—"}</strong></span>
          <span>Horario: <strong>{selected ? hhmm(selected.estimatedAt ?? selected.scheduledAt) : "—"}</strong></span>
          <span>Pasajeros: <strong>{passengerCount}</strong></span>
        </div>
        <strong className="price">{formatPrice(total, route.currency)}</strong>
        <button className="button checkout-submit" type="submit" disabled={isSubmitting || !selected}>
          {isSubmitting ? "Reservando…" : "Reservar"}
        </button>
      </aside>
    </form>
  );
}

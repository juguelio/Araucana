"use client";

import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import type { PublicRouteDto } from "@/lib/booking/types";
import type { ChapelcoAvailabilityDto } from "@/lib/chapelco/types";
import { chapelcoAscentSlots, type ChapelcoAscentSlot } from "@/lib/chapelco/constants";
import { buildPassengerPayload, validateCheckoutPassenger } from "./checkout-form";
import { fareCounts, reservationTotalCents } from "@/lib/booking/passenger-fares";
import { createChapelcoReservationAction } from "./chapelco-actions";

type ChapelcoCheckoutFormProps = {
  route: PublicRouteDto;
  initialAvailability: ChapelcoAvailabilityDto;
};

type PassengerForm = {
  firstName: string;
  lastName: string;
  email: string;
  phoneCountryCode: string;
  phone: string;
  documentType: string;
  documentId: string;
  nationality: string;
};

type FieldErrors = Partial<
  Record<
    keyof PassengerForm | "serviceDate" | "ascentSlot" | "passengerCount" | "pickupName" | "pickupAddress" | "pickupLatitude" | "pickupLongitude",
    string
  >
>;

const initialPassenger: PassengerForm = {
  firstName: "",
  lastName: "",
  email: "",
  phoneCountryCode: "",
  phone: "",
  documentType: "DNI",
  documentId: "",
  nationality: ""
};

const countryDialCodes = [
  { value: "+54", label: "Argentina +54" },
  { value: "+56", label: "Chile +56" },
  { value: "+55", label: "Brasil +55" },
  { value: "+598", label: "Uruguay +598" },
  { value: "+1", label: "EE.UU./Canada +1" },
  { value: "+34", label: "Espana +34" }
];

function todayInputValue() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Salta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function fieldError(errors: FieldErrors, key: keyof FieldErrors) {
  return errors[key] ? <span className="field-error">{errors[key]}</span> : null;
}

export function ChapelcoCheckoutForm({ route, initialAvailability }: ChapelcoCheckoutFormProps) {
  const router = useRouter();
  const [serviceDate, setServiceDate] = useState(initialAvailability.serviceDate || todayInputValue());
  const [availability, setAvailability] = useState(initialAvailability);
  const [ascentSlot, setAscentSlot] = useState<ChapelcoAscentSlot>("08:30");
  const [passengerCount, setPassengerCount] = useState(1);
  const [halfFareCount, setHalfFareCount] = useState(0);
  const [freeFareCount, setFreeFareCount] = useState(0);
  const [pickupName, setPickupName] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupLatitude, setPickupLatitude] = useState(-40.1576);
  const [pickupLongitude, setPickupLongitude] = useState(-71.3534);
  const [pickupNotes, setPickupNotes] = useState("");
  const [passenger, setPassenger] = useState<PassengerForm>(initialPassenger);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedAvailability = availability.slots.find((slot) => slot.slot === ascentSlot);
  const totalCents = useMemo(
    () => reservationTotalCents(route.priceCents, fareCounts(passengerCount, halfFareCount, freeFareCount)),
    [passengerCount, halfFareCount, freeFareCount, route.priceCents]
  );
  const menoresCargados = halfFareCount + freeFareCount;
  const hasCapacity = availability.isServiceActive && selectedAvailability ? selectedAvailability.availablePeople >= passengerCount : false;
  const minServiceDate = route.serviceStartDate && route.serviceStartDate > todayInputValue() ? route.serviceStartDate : todayInputValue();

  useEffect(() => {
    let cancelled = false;

    async function loadAvailability() {
      const response = await fetch(`/api/v1/chapelco/availability?routeId=${route.id}&date=${serviceDate}`);

      if (!response.ok) {
        return;
      }

      const nextAvailability = (await response.json()) as ChapelcoAvailabilityDto;

      if (!cancelled) {
        setAvailability(nextAvailability);
      }
    }

    loadAvailability();

    return () => {
      cancelled = true;
    };
  }, [route.id, serviceDate]);

  function updatePassenger(field: keyof PassengerForm, value: string) {
    setPassenger((current) => ({
      ...current,
      [field]: value
    }));
  }

  function setMapPointFromClick(event: MouseEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    setPickupLongitude(Number((-71.43 + x * 0.18).toFixed(6)));
    setPickupLatitude(Number((-40.11 - y * 0.1).toFixed(6)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const passengerErrors = validateCheckoutPassenger(passenger);
    const nextErrors: FieldErrors = { ...passengerErrors };

    if (!serviceDate) {
      nextErrors.serviceDate = "Selecciona una fecha.";
    }

    if (!availability.isServiceActive) {
      nextErrors.serviceDate = "Chapelco no esta activo para esa fecha.";
    }

    if (passengerCount < 1) {
      nextErrors.passengerCount = "Ingresa al menos una persona.";
    } else if (menoresCargados > passengerCount) {
      nextErrors.passengerCount = "Los menores no pueden ser más que la cantidad de personas.";
    }

    if (!pickupName.trim()) {
      nextErrors.pickupName = "Ingresa el hotel o lugar.";
    }

    if (!pickupAddress.trim()) {
      nextErrors.pickupAddress = "Ingresa la direccion.";
    }

    if (availability.isServiceActive && !hasCapacity) {
      nextErrors.passengerCount = "No quedan cupos suficientes para ese horario.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setError("Revisa los campos marcados.");
      return;
    }

    setIsSubmitting(true);
    const result = await createChapelcoReservationAction({
      routeId: route.id,
      serviceDate,
      ascentSlot,
      passengerCount,
      halfFareCount,
      freeFareCount,
      pickupName,
      pickupAddress,
      pickupLatitude,
      pickupLongitude,
      pickupNotes: pickupNotes.trim() || null,
      passenger: buildPassengerPayload(passenger)
    });

    if (result.ok) {
      router.push(`/reservas/${result.code}`);
      return;
    }

    setFieldErrors(result.fieldErrors ?? {});
    setError(result.message);
    setIsSubmitting(false);
  }

  return (
    <form className="checkout-layout" onSubmit={handleSubmit} noValidate>
      <div className="checkout-main">
        <section className="form-panel checkout-panel">
          <div>
            <p className="eyebrow">Chapelco</p>
            <h2 className="route-title">Dia y horario</h2>
          </div>
          <label>
            Fecha
            <input
              type="date"
              value={serviceDate}
              min={minServiceDate}
              max={route.serviceEndDate ?? undefined}
              onChange={(event) => setServiceDate(event.target.value)}
              disabled={isSubmitting}
            />
            {fieldError(fieldErrors, "serviceDate")}
          </label>
          {!availability.isServiceActive ? (
            <p className="muted">
              Servicio activo del {availability.serviceStartDate ?? "inicio no configurado"} al{" "}
              {availability.serviceEndDate ?? "fin no configurado"}.
            </p>
          ) : null}
          <div className="chapelco-slot-grid">
            {chapelcoAscentSlots.map((slot) => {
              const slotAvailability = availability.slots.find((item) => item.slot === slot);
              const available = slotAvailability?.availablePeople ?? 0;

              return (
                <button
                  className={slot === ascentSlot ? "slot-button selected" : "slot-button"}
                  type="button"
                  key={slot}
                  onClick={() => setAscentSlot(slot)}
                  disabled={isSubmitting || !availability.isServiceActive || available <= 0}
                >
                  <strong>{slot}</strong>
                  <span>{available} cupos</span>
                </button>
              );
            })}
          </div>
          {fieldError(fieldErrors, "ascentSlot")}
        </section>

        <section className="form-panel checkout-panel">
          <div>
            <p className="eyebrow">Grupo</p>
            <h2 className="route-title">Responsable y cupos</h2>
          </div>
          <label>
            Cantidad de personas
            <input
              type="number"
              min={1}
              max={60}
              value={passengerCount}
              onChange={(event) => {
                const total = Math.max(1, Math.min(60, Number(event.target.value) || 1));
                setPassengerCount(total);
                // Siempre queda un pasajero de tarifa entera: un grupo de sólo menores no es una reserva.
                setFreeFareCount((valor) => Math.min(valor, Math.max(total - halfFareCount - 1, 0)));
                setHalfFareCount((valor) => Math.min(valor, Math.max(total - freeFareCount - 1, 0)));
              }}
              disabled={isSubmitting}
            />
            {fieldError(fieldErrors, "passengerCount")}
          </label>
          <div className="checkout-fields">
            <label>
              De ellas, menores de 4 a 8 (media tarifa)
              <input
                type="number"
                min={0}
                max={passengerCount}
                value={halfFareCount}
                onChange={(event) => setHalfFareCount(Math.max(0, Math.min(passengerCount - freeFareCount - 1, Number(event.target.value) || 0)))}
                disabled={isSubmitting}
              />
            </label>
            <label>
              De ellas, menores de 4 (sin cargo)
              <input
                type="number"
                min={0}
                max={passengerCount}
                value={freeFareCount}
                onChange={(event) => setFreeFareCount(Math.max(0, Math.min(passengerCount - halfFareCount - 1, Number(event.target.value) || 0)))}
                disabled={isSubmitting}
              />
            </label>
            <p className="muted" style={{ gridColumn: "1 / -1" }}>
              De 4 a 8 años pagan media tarifa. Los menores de 4 no pagan, pero ocupan un lugar del vehículo.
            </p>
          </div>
          <div className="checkout-fields">
            <label>
              Nombre
              <input value={passenger.firstName} onChange={(event) => updatePassenger("firstName", event.target.value)} disabled={isSubmitting} />
              {fieldError(fieldErrors, "firstName")}
            </label>
            <label>
              Apellido
              <input value={passenger.lastName} onChange={(event) => updatePassenger("lastName", event.target.value)} disabled={isSubmitting} />
              {fieldError(fieldErrors, "lastName")}
            </label>
            <label>
              Email
              <input type="email" value={passenger.email} onChange={(event) => updatePassenger("email", event.target.value)} disabled={isSubmitting} />
              {fieldError(fieldErrors, "email")}
            </label>
            <div className="phone-field-row">
              <label>
                Codigo
                <select value={passenger.phoneCountryCode} onChange={(event) => updatePassenger("phoneCountryCode", event.target.value)}>
                  <option value="">Seleccionar</option>
                  {countryDialCodes.map((country) => (
                    <option value={country.value} key={country.value}>
                      {country.label}
                    </option>
                  ))}
                </select>
                {fieldError(fieldErrors, "phoneCountryCode")}
              </label>
              <label>
                Telefono
                <input type="tel" autoComplete="tel-national" value={passenger.phone} onChange={(event) => updatePassenger("phone", event.target.value)} disabled={isSubmitting} />
                {fieldError(fieldErrors, "phone")}
              </label>
            </div>
            <label>
              Tipo documento
              <select value={passenger.documentType} onChange={(event) => updatePassenger("documentType", event.target.value)}>
                <option value="DNI">DNI</option>
                <option value="Pasaporte">Pasaporte</option>
                <option value="Cedula">Cedula</option>
              </select>
              {fieldError(fieldErrors, "documentType")}
            </label>
            <label>
              Documento
              <input inputMode={passenger.documentType === "DNI" ? "numeric" : "text"} value={passenger.documentId} onChange={(event) => updatePassenger("documentId", event.target.value)} disabled={isSubmitting} />
              {fieldError(fieldErrors, "documentId")}
            </label>
          </div>
        </section>

        <section className="form-panel checkout-panel">
          <div>
            <p className="eyebrow">Busqueda</p>
            <h2 className="route-title">Hotel y mapa</h2>
          </div>
          <div className="pickup-fields">
            <label>
              Hotel o lugar
              <input value={pickupName} onChange={(event) => setPickupName(event.target.value)} disabled={isSubmitting} />
              {fieldError(fieldErrors, "pickupName")}
            </label>
            <label>
              Direccion
              <input value={pickupAddress} onChange={(event) => setPickupAddress(event.target.value)} disabled={isSubmitting} />
              {fieldError(fieldErrors, "pickupAddress")}
            </label>
            <button className="chapelco-map" type="button" onClick={setMapPointFromClick} disabled={isSubmitting}>
              <span
                className="map-marker"
                style={{
                  left: `${((pickupLongitude + 71.43) / 0.18) * 100}%`,
                  top: `${((-40.11 - pickupLatitude) / 0.1) * 100}%`
                }}
              />
            </button>
            <div className="coordinate-grid">
              <label>
                Latitud
                <input
                  type="number"
                  step="0.000001"
                  value={pickupLatitude}
                  onChange={(event) => setPickupLatitude(Number(event.target.value))}
                  disabled={isSubmitting}
                />
              </label>
              <label>
                Longitud
                <input
                  type="number"
                  step="0.000001"
                  value={pickupLongitude}
                  onChange={(event) => setPickupLongitude(Number(event.target.value))}
                  disabled={isSubmitting}
                />
              </label>
            </div>
            <label>
              Observaciones
              <textarea value={pickupNotes} onChange={(event) => setPickupNotes(event.target.value)} disabled={isSubmitting} />
            </label>
          </div>
        </section>
      </div>

      <aside className="checkout-summary plain-card">
        <p className="eyebrow">Resumen</p>
        <h2 className="route-title">Chapelco</h2>
        <div className="summary-list">
          <div>
            <span>Fecha</span>
            <strong>{serviceDate}</strong>
          </div>
          <div>
            <span>Subida</span>
            <strong>{ascentSlot}</strong>
          </div>
          <div>
            <span>Personas</span>
            <strong>
              {passengerCount}
              {menoresCargados ? ` (${halfFareCount ? `${halfFareCount} media` : ""}${halfFareCount && freeFareCount ? " · " : ""}${freeFareCount ? `${freeFareCount} sin cargo` : ""})` : ""}
            </strong>
          </div>
          <div>
            <span>Regreso</span>
            <strong>Incluido desde las 17:00</strong>
          </div>
          <div>
            <span>Total</span>
            <strong className="price">{formatPrice(totalCents, route.currency)}</strong>
          </div>
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="button checkout-submit" type="submit" disabled={isSubmitting || !hasCapacity}>
          {isSubmitting ? "Confirmando..." : "Confirmar reserva"}
        </button>
      </aside>
    </form>
  );
}

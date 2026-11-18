"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { FormErrorSummary, useFocusFirstError } from "@/components/form-errors";
import { AdminFormAlert, FieldError } from "../../form-ui";
import { initialAdminFormState, type AdminFormState } from "../../form-state";
import { SalidaPicker, type SalidaOption } from "./salida-picker";

/**
 * Alta manual de reserva (#242).
 *
 * Era un `<form action={serverAction}>` que ante cualquier error redirigía a la misma pantalla con
 * un `?notice=` arriba: el campo culpable quedaba igual que el resto, el mensaje aparecía fuera de
 * pantalla y se perdía todo lo cargado. Ahora el action devuelve el estado (useActionState): los
 * datos se conservan, cada campo lleva su mensaje al lado, el primero que falla recibe el foco y
 * con dos o más errores aparece el resumen con links.
 *
 * No cambia ninguna validación: qué es válido y qué no lo sigue decidiendo el mismo schema Zod del
 * servidor. Sólo cambia cómo se muestra.
 */

const FIELD_ORDER = [
  "scheduleId",
  "dropoffStop",
  "passengerCount",
  "firstName",
  "lastName",
  "email",
  "phone",
  "documentType",
  "documentId",
  "customPrice"
] as const;

const initialPassengerDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  documentType: "DNI",
  documentId: "",
  nationality: ""
};

type PassengerDraft = typeof initialPassengerDraft;

type NewReservationFormProps = {
  action: (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
  schedules: SalidaOption[];
};

export function NewReservationForm({ action, schedules }: NewReservationFormProps) {
  const [state, formAction, pending] = useActionState(action, initialAdminFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const [passenger, setPassenger] = useState<PassengerDraft>(initialPassengerDraft);
  const [customPrice, setCustomPrice] = useState("");
  const [referredBy, setReferredBy] = useState("");

  const errors = state.fieldErrors;
  const errorCount = Object.values(errors).filter((message) => Boolean(message)).length;

  useFocusFirstError(errors, FIELD_ORDER, formRef);

  function setField(field: keyof PassengerDraft, value: string) {
    setPassenger((current) => ({ ...current, [field]: value }));
  }

  return (
    <form className="alta-form" action={formAction} ref={formRef} noValidate>
      <SalidaPicker schedules={schedules} />
      <div className="alta-pasajero">
        <div className="alta-pasajero-head">
          <p className="eyebrow">Pasajero</p>
          <p className="muted">Contacto y documento del titular de la reserva.</p>
        </div>
        {errorCount > 1 ? (
          <FormErrorSummary fieldErrors={errors} order={FIELD_ORDER} />
        ) : errorCount === 0 ? (
          <AdminFormAlert state={state} />
        ) : null}
        <div className="admin-form-grid alta-campos">
          <label>
            Nombre
            <input
              name="firstName"
              autoComplete="given-name"
              value={passenger.firstName}
              onChange={(event) => setField("firstName", event.target.value)}
              disabled={pending}
              aria-invalid={Boolean(errors.firstName)}
              aria-describedby={errors.firstName ? "alta-firstName-error" : undefined}
              required
            />
            <FieldError id="alta-firstName-error" message={errors.firstName} />
          </label>
          <label>
            Apellido
            <input
              name="lastName"
              autoComplete="family-name"
              value={passenger.lastName}
              onChange={(event) => setField("lastName", event.target.value)}
              disabled={pending}
              aria-invalid={Boolean(errors.lastName)}
              aria-describedby={errors.lastName ? "alta-lastName-error" : undefined}
              required
            />
            <FieldError id="alta-lastName-error" message={errors.lastName} />
          </label>
          <label>
            Email (opcional)
            <input
              name="email"
              type="email"
              autoComplete="email"
              value={passenger.email}
              onChange={(event) => setField("email", event.target.value)}
              disabled={pending}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "alta-email-error" : undefined}
            />
            <FieldError id="alta-email-error" message={errors.email} />
          </label>
          <label>
            Teléfono (opcional)
            <input
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+54 9..."
              value={passenger.phone}
              onChange={(event) => setField("phone", event.target.value)}
              disabled={pending}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? "alta-phone-error" : undefined}
            />
            <FieldError id="alta-phone-error" message={errors.phone} />
          </label>
          <label>
            Tipo de documento
            <select
              name="documentType"
              value={passenger.documentType}
              onChange={(event) => setField("documentType", event.target.value)}
              disabled={pending}
              aria-invalid={Boolean(errors.documentType)}
              aria-describedby={errors.documentType ? "alta-documentType-error" : undefined}
              required
            >
              <option>DNI</option>
              <option>Pasaporte</option>
              <option>Cedula</option>
            </select>
            <FieldError id="alta-documentType-error" message={errors.documentType} />
          </label>
          <label>
            Documento
            <input
              name="documentId"
              placeholder="7 u 8 dígitos si es DNI"
              value={passenger.documentId}
              onChange={(event) => setField("documentId", event.target.value)}
              disabled={pending}
              aria-invalid={Boolean(errors.documentId)}
              aria-describedby={errors.documentId ? "alta-documentId-error" : undefined}
              required
            />
            <FieldError id="alta-documentId-error" message={errors.documentId} />
          </label>
          <label className="span-2">
            Nacionalidad
            <input
              name="nationality"
              placeholder="Opcional"
              value={passenger.nationality}
              onChange={(event) => setField("nationality", event.target.value)}
              disabled={pending}
            />
          </label>
        </div>
        <div className="admin-form-grid alta-campos">
          <label>
            Precio total de la reserva (opcional)
            <input
              name="customPrice"
              inputMode="decimal"
              placeholder="Usar tarifa automática"
              value={customPrice}
              onChange={(event) => setCustomPrice(event.target.value)}
              disabled={pending}
              aria-invalid={Boolean(errors.customPrice)}
              aria-describedby={errors.customPrice ? "alta-customPrice-error" : undefined}
            />
            <small>Ingresá el importe para todos los lugares en la moneda de la salida.</small>
            <FieldError id="alta-customPrice-error" message={errors.customPrice} />
          </label>
          <label>
            Derivado por (opcional)
            <input
              name="referredBy"
              maxLength={120}
              placeholder="Ej. una agencia de viajes"
              value={referredBy}
              onChange={(event) => setReferredBy(event.target.value)}
              disabled={pending}
            />
            <small>Quién vendió la reserva, si la venta vino de otra agencia o por un voucher.</small>
          </label>
        </div>
        <div className="form-actions">
          <button className="button" type="submit" disabled={pending}>
            {pending ? "Creando..." : "Crear reserva"}
          </button>
          <Link className="ghost-button" href="/admin/reservas">
            Cancelar
          </Link>
        </div>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useActionState, useState } from "react";
import { createAdminReservationAction } from "../actions";
import { FieldError } from "../../form-ui";
import { initialAdminFormState } from "../../form-state";
import { SalidaPicker, type SalidaOption } from "./salida-picker";

/**
 * Alta manual de reserva. Los errores vuelven del server action con el nombre del campo que falló,
 * así que cada uno se marca en su lugar (borde, `aria-invalid` y mensaje al lado) en vez de aparecer
 * como un cartel suelto arriba del formulario (#242). Al volver con errores el foco va al primero.
 *
 * Los campos son controlados a propósito: React limpia los inputs no controlados cuando termina una
 * acción de formulario, y el que carga una reserva no puede perder lo que ya escribió sólo porque un
 * campo estaba mal.
 */
const VACIOS = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  documentType: "DNI",
  documentId: "",
  nationality: "",
  customPrice: "",
  referredBy: ""
};

type Draft = typeof VACIOS;

export function NuevaReservaForm({ schedules }: { schedules: SalidaOption[] }) {
  const [state, formAction, pending] = useActionState(createAdminReservationAction, initialAdminFormState);
  const [draft, setDraft] = useState<Draft>(VACIOS);
  const formRef = useRef<HTMLFormElement>(null);
  const errores = state.status === "error" ? state.fieldErrors : {};
  const cantidadErrores = Object.keys(errores).length;

  const campo = (name: keyof Draft) => ({
    name,
    value: draft[name],
    "aria-invalid": Boolean(errores[name]),
    "aria-describedby": errores[name] ? `error-${name}` : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft((prev) => ({ ...prev, [name]: event.target.value }))
  });

  useEffect(() => {
    if (!cantidadErrores) return;
    const primero = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!primero) return;
    primero.focus();
    primero.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state, cantidadErrores]);

  return (
    <form className="alta-form" action={formAction} ref={formRef} noValidate>
      {state.message && (
        <div className="form-alert error" role="alert" id="alta-resumen">
          <p>{state.message}</p>
          {cantidadErrores > 1 && (
            <ul>
              {Object.entries(errores).map(([name, mensaje]) => (
                <li key={name}>
                  <a href={`#campo-${name}`} onClick={(event) => {
                    event.preventDefault();
                    formRef.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
                  }}>{mensaje}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <SalidaPicker schedules={schedules} />

      <div className="alta-pasajero">
        <div className="alta-pasajero-head">
          <p className="eyebrow">Pasajero</p>
          <p className="muted">Contacto y documento del titular de la reserva.</p>
        </div>
        <div className="admin-form-grid alta-campos">
          <label id="campo-firstName">
            Nombre
            <input autoComplete="given-name" required {...campo("firstName")} />
            <FieldError id="error-firstName" message={errores.firstName} />
          </label>
          <label id="campo-lastName">
            Apellido
            <input autoComplete="family-name" required {...campo("lastName")} />
            <FieldError id="error-lastName" message={errores.lastName} />
          </label>
          <label id="campo-email">
            Email (opcional)
            <input type="email" autoComplete="email" {...campo("email")} />
            <FieldError id="error-email" message={errores.email} />
          </label>
          <label id="campo-phone">
            Teléfono (opcional)
            <input type="tel" autoComplete="tel" placeholder="+54 9..." {...campo("phone")} />
            <FieldError id="error-phone" message={errores.phone} />
          </label>
          <label id="campo-documentType">
            Tipo de documento
            <select required {...campo("documentType")}><option>DNI</option><option>Pasaporte</option><option>Cedula</option></select>
          </label>
          <label id="campo-documentId">
            Documento
            <input required placeholder="7 u 8 dígitos si es DNI" {...campo("documentId")} />
            <FieldError id="error-documentId" message={errores.documentId} />
          </label>
          <label className="span-2" id="campo-nationality">
            Nacionalidad
            <input placeholder="Opcional" {...campo("nationality")} />
            <FieldError id="error-nationality" message={errores.nationality} />
          </label>
        </div>
        <div className="admin-form-grid alta-campos">
          <label id="campo-customPrice">
            Precio total de la reserva (opcional)
            <input inputMode="decimal" placeholder="Usar tarifa automática" {...campo("customPrice")} />
            <small>Ingresá el importe para todos los lugares en la moneda de la salida.</small>
            <FieldError id="error-customPrice" message={errores.customPrice} />
          </label>
          <label id="campo-referredBy">
            Derivado por (opcional)
            <input maxLength={120} placeholder="Ej. una agencia de viajes" {...campo("referredBy")} />
            <small>Quién vendió la reserva, si la venta vino de otra agencia o por un voucher.</small>
            <FieldError id="error-referredBy" message={errores.referredBy} />
          </label>
        </div>
        <div className="form-actions">
          <button className="button" type="submit" disabled={pending}>{pending ? "Guardando..." : "Crear reserva"}</button>
          <Link className="ghost-button" href="/admin/reservas">Cancelar</Link>
        </div>
      </div>
    </form>
  );
}

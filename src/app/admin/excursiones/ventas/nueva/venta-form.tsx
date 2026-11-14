"use client";

import { useActionState } from "react";
import { FieldError } from "@/app/admin/form-ui";
import { initialAdminFormState, type AdminFormState } from "@/app/admin/form-state";
import { crearVentaDeExcursionAction } from "../actions";

type ExcursionOption = { id: string; name: string; priceCents: number | null };

/**
 * Formulario de venta manual de una excursión (#110). Mismo criterio que el alta del aeropuerto: el
 * botón de «Derivado por» está al lado de los datos del pasajero, porque la derivación se carga a mano.
 */
export function VentaDeExcursionForm({ excursiones, porDefecto }: { excursiones: ExcursionOption[]; porDefecto: { excursionId?: string; date?: string } }) {
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(
    crearVentaDeExcursionAction,
    initialAdminFormState
  );

  return (
    <form action={formAction} className="plain-card admin-section">
      {state.status === "error" ? <p className="form-error">{state.message}</p> : null}

      <div className="admin-form-grid">
        <label>
          Excursión
          <select name="excursionId" defaultValue={porDefecto.excursionId ?? excursiones[0]?.id ?? ""} required>
            {excursiones.map((excursion) => (
              <option key={excursion.id} value={excursion.id}>
                {excursion.name}
                {excursion.priceCents != null ? ` · $${(excursion.priceCents / 100).toLocaleString("es-AR")}` : ""}
              </option>
            ))}
          </select>
          <FieldError id="excursionId-error" message={state.fieldErrors.excursionId} />
        </label>
        <label>
          Fecha de la salida
          <input name="date" type="date" defaultValue={porDefecto.date ?? ""} required />
          <FieldError id="date-error" message={state.fieldErrors.date} />
        </label>
        <label>
          Hora de la salida
          <input name="time" type="time" defaultValue="09:00" required />
          <FieldError id="time-error" message={state.fieldErrors.time} />
        </label>
        <label>
          Cantidad de lugares
          <input name="passengerCount" type="number" min="1" max="60" defaultValue="1" required />
          <FieldError id="passengerCount-error" message={state.fieldErrors.passengerCount} />
        </label>
      </div>

      <h3>Pasajero</h3>
      <div className="admin-form-grid">
        <label>
          Nombre
          <input name="firstName" autoComplete="given-name" required />
          <FieldError id="firstName-error" message={state.fieldErrors.firstName} />
        </label>
        <label>
          Apellido
          <input name="lastName" autoComplete="family-name" required />
          <FieldError id="lastName-error" message={state.fieldErrors.lastName} />
        </label>
        <label>
          Email (opcional)
          <input name="email" type="email" autoComplete="email" />
          <FieldError id="email-error" message={state.fieldErrors.email} />
        </label>
        <label>
          Teléfono
          <input name="phone" type="tel" autoComplete="tel" placeholder="+54 9 2944..." required />
          <FieldError id="phone-error" message={state.fieldErrors.phone} />
        </label>
        <label>
          Tipo de documento
          <select name="documentType" defaultValue="DNI" required>
            <option>DNI</option>
            <option>Pasaporte</option>
            <option>Cedula</option>
          </select>
          <FieldError id="documentType-error" message={state.fieldErrors.documentType} />
        </label>
        <label>
          Documento
          <input name="documentId" required placeholder="7 u 8 dígitos si es DNI" />
          <FieldError id="documentId-error" message={state.fieldErrors.documentId} />
        </label>
      </div>

      <h3>Cómo se vendió</h3>
      <div className="admin-form-grid">
        <label>
          Importe total
          <input name="total" inputMode="decimal" placeholder="0,00" required />
          <FieldError id="total-error" message={state.fieldErrors.total} />
        </label>
        <label>
          Derivado por (opcional)
          <input name="referredBy" maxLength={120} placeholder="Ej. una agencia de viajes" />
          <small>Si la venta la trajo una agencia, sale en la planilla. La venta directa va vacía.</small>
          <FieldError id="referredBy-error" message={state.fieldErrors.referredBy} />
        </label>
        <label className="span-2">
          Nota (opcional)
          <input name="notes" maxLength={400} />
          <FieldError id="notes-error" message={state.fieldErrors.notes} />
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" disabled={pending}>{pending ? "Guardando…" : "Registrar venta"}</button>
      </div>
    </form>
  );
}

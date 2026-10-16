"use client";

import { useActionState, useState } from "react";
import { AdminFormAlert, AdminSubmitButton, FieldError } from "../form-ui";
import { initialAdminFormState, type AdminFormState } from "../form-state";

type FlightFormAction = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

export function FlightForm({ action }: { action: FlightFormAction }) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  const [direccion, setDireccion] = useState("ARRIVAL");
  const errors = state.fieldErrors;

  return (
    <form className="admin-form-grid" action={formAction}>
      <AdminFormAlert state={state} />
      <label>
        Número de vuelo
        <input name="number" placeholder="AR 1656" required />
        <FieldError id="number" message={errors.number} />
      </label>
      <label>
        Aerolínea
        <input name="airline" placeholder="Aerolíneas Argentinas" />
      </label>
      <label>
        Dirección
        <select name="direction" value={direccion} onChange={(event) => setDireccion(event.target.value)}>
          <option value="ARRIVAL">Arribo (llega a CPC)</option>
          <option value="DEPARTURE">Partida (sale de CPC)</option>
        </select>
      </label>
      <label>
        {direccion === "ARRIVAL" ? "Origen (de dónde llega)" : "Destino (a dónde va)"}
        <input name="origin" placeholder="Aeroparque (AEP)" required />
        <FieldError id="origin" message={errors.origin} />
      </label>
      <label>
        Fecha y hora programada
        <input type="datetime-local" name="scheduledAt" required />
        <FieldError id="scheduledAt" message={errors.scheduledAt} />
      </label>
      <label>
        Pasajeros
        <input name="passengers" type="number" min="0" placeholder="Opcional" />
      </label>
      <label>
        Notas
        <input name="notes" placeholder="Opcional" />
      </label>
      <AdminSubmitButton>Agregar vuelo</AdminSubmitButton>
    </form>
  );
}

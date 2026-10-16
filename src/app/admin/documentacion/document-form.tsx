"use client";

import { useActionState, useState } from "react";
import { DOCUMENT_KINDS, type DocumentSubject } from "@/lib/compliance/catalog";
import { AdminFormAlert, AdminSubmitButton, FieldError } from "../form-ui";
import { initialAdminFormState, type AdminFormState } from "../form-state";

type DocumentFormAction = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

type DocumentFormProps = {
  action: DocumentFormAction;
  vehicles: Array<{ id: string; name: string; licensePlate?: string | null }>;
  drivers: Array<{ id: string; name?: string | null; email: string }>;
};

export function DocumentForm({ action, vehicles, drivers }: DocumentFormProps) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  const errors = state.fieldErrors;
  const [subject, setSubject] = useState<DocumentSubject>("VEHICLE");
  const kinds = DOCUMENT_KINDS[subject];

  return (
    <form className="admin-form-grid" action={formAction}>
      <AdminFormAlert state={state} />

      <label>
        ¿De quién es el documento?
        <select name="subject" value={subject} onChange={(event) => setSubject(event.target.value as DocumentSubject)}>
          <option value="VEHICLE">Nave</option>
          <option value="DRIVER">Chofer</option>
        </select>
        <FieldError id="subject" message={errors.subject} />
      </label>

      {subject === "VEHICLE" ? (
        <label>
          Nave
          <select name="vehicleId" defaultValue="">
            <option value="">Elegí una nave</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.name}
                {vehicle.licensePlate ? ` (${vehicle.licensePlate})` : ""}
              </option>
            ))}
          </select>
          <FieldError id="vehicleId" message={errors.vehicleId} />
        </label>
      ) : (
        <label>
          Chofer
          <select name="userId" defaultValue="">
            <option value="">Elegí un chofer</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.name ?? driver.email}
              </option>
            ))}
          </select>
          <FieldError id="userId" message={errors.userId} />
        </label>
      )}

      <label>
        Tipo de documento
        <select name="kind" defaultValue="">
          <option value="">Elegí el tipo</option>
          {kinds.map((kind) => (
            <option key={kind.code} value={kind.code}>
              {kind.label}
            </option>
          ))}
        </select>
        <FieldError id="kind" message={errors.kind} />
      </label>

      <label>
        Número / patente del documento
        <input name="number" placeholder="Opcional" />
      </label>

      <label>
        Emitido
        <input type="date" name="issuedAt" />
      </label>

      <label>
        Vence
        <input type="date" name="expiresAt" />
        <FieldError id="expiresAt" message={errors.expiresAt} />
      </label>

      <label>
        <input type="checkbox" name="critical" defaultChecked />
        Es crítico: si vence, la nave no sale / el chofer no maneja
      </label>

      <label>
        Notas
        <input name="notes" placeholder="Opcional" />
      </label>

      <AdminSubmitButton>Guardar documento</AdminSubmitButton>
    </form>
  );
}

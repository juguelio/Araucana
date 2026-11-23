"use client";

import { useActionState, useRef, useState } from "react";
import { DOCUMENTO_TIPOS_ACEPTADOS, type TipoDeDocumento } from "@/lib/vehicles/documents";
import { AdminFormAlert, AdminSubmitButton, FieldError } from "../../../form-ui";
import { initialAdminFormState, type AdminFormState } from "../../../form-state";

type FormAction = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

/**
 * El alta de un papel. `key` en el nombre del input de archivo lo limpia después de subir, y el
 * selector de vencimiento es opcional: hay papeles que no lo imprimen y no se inventa una fecha.
 */
export function DocumentoForm({ action, vehicleId, kind, etiqueta }: {
  action: FormAction;
  vehicleId: string;
  kind: TipoDeDocumento;
  etiqueta: string;
}) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  const [nombreDelArchivo, setNombreDelArchivo] = useState("");
  const [intento, setIntento] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) => {
        setIntento((valor) => valor + 1);
        return formAction(formData);
      }}
      className="documento-form"
    >
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="documento-form-campos">
        <label className="documento-form-archivo">
          <span>{etiqueta} (PDF o foto)</span>
          <input
            key={intento}
            type="file"
            name="file"
            required
            accept={DOCUMENTO_TIPOS_ACEPTADOS.join(",")}
            onChange={(evento) => setNombreDelArchivo(evento.target.files?.[0]?.name ?? "")}
          />
        </label>
        <label className="documento-form-fecha">
          <span>Vence (opcional)</span>
          <input type="date" name="expiresAt" />
        </label>
        <AdminSubmitButton>{state.status === "success" ? "Subir otro" : "Subir papel"}</AdminSubmitButton>
      </div>
      {nombreDelArchivo ? <p className="muted documento-form-nombre">{nombreDelArchivo}</p> : null}
      {state.fieldErrors.file ? <FieldError id={`file-${kind}`} message={state.fieldErrors.file} /> : null}
      {state.fieldErrors.expiresAt ? <FieldError id={`expiresAt-${kind}`} message={state.fieldErrors.expiresAt} /> : null}
      {state.message ? <AdminFormAlert state={state} /> : null}
    </form>
  );
}

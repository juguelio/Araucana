"use client";

import { useActionState } from "react";
import { documentTypeLabels, documentTypes, sexLabels, sexOptions } from "@/lib/departure-sheets/types";
import { submitDeparturePassengerAction } from "./actions";
import { initialSubmitState } from "./state";
import "./planilla.css";

export type PlanillaPrefill = {
  firstName: string;
  lastName: string;
  documentType: string;
  documentNumber: string;
  nationality: string;
};

type PlanillaFormProps = {
  token: string;
  kind: string;
  countries: string[];
  /** Datos que ya tiene la reserva: el pasajero sólo confirma y completa lo que falta. */
  prefill?: PlanillaPrefill;
};

export function PlanillaForm({ token, kind, countries, prefill }: PlanillaFormProps) {
  const [state, formAction, pending] = useActionState(submitDeparturePassengerAction, initialSubmitState);
  const asksResidence = kind === "PROVINCIA";
  const knownDocumentType = documentTypes.includes(prefill?.documentType as (typeof documentTypes)[number])
    ? prefill?.documentType
    : "DNI";

  if (state.status === "ok") {
    return (
      <section className="form-panel planilla-panel" aria-live="polite">
        <p className="eyebrow">Datos cargados</p>
        <h2>{state.passengerName}</h2>
        <p>{state.message}</p>
        <p className="muted">
          Si falta cargar otra persona del grupo, pasale este mismo link. Cada pasajero completa sus
          datos una vez.
        </p>
        <a className="button" href={`#formulario`} onClick={() => window.location.reload()}>
          Cargar otro pasajero
        </a>
      </section>
    );
  }

  return (
    <form className="form-panel planilla-panel" action={formAction} id="formulario">
      <input type="hidden" name="token" value={token} />

      <div className="planilla-grid">
        <label>
          Apellido
          <input name="lastName" required minLength={2} maxLength={60} autoComplete="family-name" defaultValue={prefill?.lastName ?? ""} />
        </label>
        <label>
          Nombre
          <input name="firstName" required minLength={2} maxLength={60} autoComplete="given-name" defaultValue={prefill?.firstName ?? ""} />
        </label>
        <label>
          Tipo de documento
          <select name="documentType" defaultValue={knownDocumentType} required>
            {documentTypes.map((type) => (
              <option value={type} key={type}>
                {documentTypeLabels[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Número de documento
          <input
            name="documentNumber"
            required
            maxLength={30}
            inputMode="text"
            autoComplete="off"
            defaultValue={prefill?.documentNumber ?? ""}
          />
        </label>
        <label>
          Sexo
          <select name="sex" defaultValue="" required>
            <option value="" disabled>
              Elegí una opción
            </option>
            {sexOptions.map((sex) => (
              <option value={sex} key={sex}>
                {sexLabels[sex]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fecha de nacimiento
          <input type="date" name="birthDate" required min="1900-01-01" />
        </label>
        <label>
          Nacionalidad
          <input
            name="nationality"
            required
            minLength={2}
            maxLength={60}
            list="planilla-paises"
            placeholder="Argentina"
            defaultValue={prefill?.nationality ?? ""}
          />
        </label>
        {asksResidence ? (
          <label>
            Ocupación
            <input name="occupation" required minLength={2} maxLength={80} placeholder="Ej. Docente" />
          </label>
        ) : null}
        {asksResidence ? (
          <label>
            País de residencia
            <input
              name="residenceCountry"
              required
              minLength={2}
              maxLength={60}
              list="planilla-paises"
              placeholder="Argentina"
            />
          </label>
        ) : null}
      </div>

      <datalist id="planilla-paises">
        {countries.map((country) => (
          <option value={country} key={country} />
        ))}
      </datalist>

      {state.status === "error" ? (
        <p className="form-alert" role="alert">
          {state.message}
        </p>
      ) : null}

      <button className="button" type="submit" disabled={pending}>
        {pending ? "Guardando..." : "Guardar mis datos"}
      </button>
    </form>
  );
}

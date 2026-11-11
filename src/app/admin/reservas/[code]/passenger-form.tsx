import { FieldError } from "../../form-ui";
import type { AdminFieldErrors } from "../../form-state";
import type { PassengerDto } from "@/lib/booking/types";

export type PassengerDraft = Record<keyof PassengerDto, string>;

const fields = [
  { name: "firstName", label: "Nombre", type: "text", required: true },
  { name: "lastName", label: "Apellido", type: "text", required: true },
  { name: "email", label: "Email (opcional)", type: "email", autoComplete: "email" },
  { name: "phone", label: "Teléfono", type: "tel", autoComplete: "tel", required: true },
  { name: "documentType", label: "Tipo de documento", type: "text", required: true },
  { name: "documentId", label: "Número de documento", type: "text" },
  { name: "nationality", label: "Nacionalidad", type: "text" }
] as const;

type PassengerFieldsProps = {
  passenger: PassengerDraft;
  errors: AdminFieldErrors;
  disabled: boolean;
  onChange: (name: keyof PassengerDraft, value: string) => void;
};

export function PassengerFields({ passenger, errors, disabled, onChange }: PassengerFieldsProps) {
  return fields.map(({ name, label, type, ...attributes }) => (
    <label key={name}>
      {label}
      <input name={name} type={type} {...attributes} value={passenger[name]} disabled={disabled}
        aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `${name}-error` : undefined}
        onChange={(event) => onChange(name, event.target.value)} />
      <FieldError id={`${name}-error`} message={errors[name]} />
    </label>
  ));
}

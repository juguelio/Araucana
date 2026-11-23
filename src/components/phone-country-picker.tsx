"use client";

import { useId } from "react";
import { phoneCountries, phoneCountryLabel } from "@/lib/booking/phone-countries";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
};

export function PhoneCountryPicker({ value, onChange, disabled, required, error }: Props) {
  const id = useId();

  return (
    <label htmlFor={id}>
      Codigo de pais
      <select id={id} name="phoneCountryCode" aria-label="Codigo de pais" value={value} onChange={(event) => onChange(event.target.value)}
        disabled={disabled} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}>
        <option value="">Seleccionar</option>
        {phoneCountries.map((country) => <option value={country.value} key={country.value}>{phoneCountryLabel(country)}</option>)}
      </select>
      {error ? <span className="field-error" id={`${id}-error`}>{error}</span> : null}
    </label>
  );
}

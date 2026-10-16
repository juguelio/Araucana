"use client";

import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { phoneCountries, phoneCountryLabel } from "@/lib/booking/phone-countries";
import type { CreateReservationInput } from "@/lib/booking/validation";

/**
 * Datos del pasajero, compartidos por los dos checkouts (reservas comunes y aeropuerto).
 *
 * Vive acá y no en cada formulario para que sean el **mismo** formulario: mismos campos, mismo
 * orden, mismos textos y mismas validaciones. Si un módulo cambia algo, cambia en los dos.
 */

export type PassengerForm = {
  firstName: string;
  lastName: string;
  email: string;
  phoneCountryCode: string;
  phone: string;
  documentType: string;
  documentId: string;
  nationality: string;
};

export type PassengerFieldErrors = Partial<Record<keyof PassengerForm, string>>;

export const initialPassenger: PassengerForm = {
  firstName: "",
  lastName: "",
  email: "",
  phoneCountryCode: "",
  phone: "",
  documentType: "DNI",
  documentId: "",
  nationality: ""
};

// La lista vive en un módulo compartido y ahora muestra la bandera del país.
export const countryDialCodes = phoneCountries.map((c) => ({ value: c.value, label: phoneCountryLabel(c) }));

const nationalityCountryCodes = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW"
];

let nationalityOptionsCache: string[] | null = null;

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function normalizeSearchValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function getNationalityOptions() {
  if (nationalityOptionsCache) {
    return nationalityOptionsCache;
  }

  const regionNames = new Intl.DisplayNames(["es-AR"], { type: "region" });
  nationalityOptionsCache = nationalityCountryCodes
    .map((code) => regionNames.of(code))
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, "es-AR"));

  return nationalityOptionsCache;
}

export function filterNationalityOptions(query: string) {
  const normalizedQuery = normalizeSearchValue(query);

  if (!normalizedQuery) {
    return getNationalityOptions();
  }

  return getNationalityOptions().filter((option) => normalizeSearchValue(option).includes(normalizedQuery));
}

export function validateCheckoutPassenger(passenger: PassengerForm): PassengerFieldErrors {
  const errors: PassengerFieldErrors = {};
  const phoneDigits = onlyDigits(passenger.phone);

  if (passenger.firstName.trim().length < 2) {
    errors.firstName = "Ingresa el nombre del pasajero.";
  }

  if (passenger.lastName.trim().length < 2) {
    errors.lastName = "Ingresa el apellido del pasajero.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(passenger.email.trim())) {
    errors.email = "Ingresa un email valido.";
  }

  if (!passenger.phoneCountryCode) {
    errors.phoneCountryCode = "Selecciona el codigo de pais.";
  }

  if (phoneDigits.length < 6) {
    errors.phone = "Ingresa un telefono valido sin el codigo de pais.";
  }

  if (!passenger.documentType) {
    errors.documentType = "Selecciona el tipo de documento.";
  }

  if (passenger.documentId.trim().length < 4) {
    errors.documentId = "Ingresa un documento valido.";
  }

  return errors;
}

export function buildPassengerPayload(passenger: PassengerForm): CreateReservationInput["passenger"] {
  return {
    firstName: passenger.firstName.trim(),
    lastName: passenger.lastName.trim(),
    email: passenger.email.trim(),
    phone: `${passenger.phoneCountryCode}${onlyDigits(passenger.phone)}`,
    documentType: passenger.documentType,
    documentId: passenger.documentId.trim(),
    nationality: passenger.nationality.trim() || undefined
  };
}

type PassengerFieldsProps = {
  passenger: PassengerForm;
  fieldErrors: PassengerFieldErrors;
  disabled?: boolean;
  onChange: (field: keyof PassengerForm, value: string) => void;
};

/** Los campos del pasajero. El combobox de nacionalidad maneja su propia búsqueda. */
export function PassengerFields({ passenger, fieldErrors, disabled = false, onChange }: PassengerFieldsProps) {
  const [nationalitySearch, setNationalitySearch] = useState("");
  const [isNationalityListOpen, setIsNationalityListOpen] = useState(false);
  const nationalityOptions = useMemo(() => getNationalityOptions(), []);
  const filteredNationalityOptions = useMemo(
    () => filterNationalityOptions(nationalitySearch).slice(0, 12),
    [nationalitySearch]
  );

  function selectNationality(value: string) {
    onChange("nationality", value);
    setNationalitySearch(value);
    setIsNationalityListOpen(false);
  }

  function handleNationalityChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    const exactMatch = nationalityOptions.find(
      (option) => normalizeSearchValue(option) === normalizeSearchValue(nextValue)
    );

    setNationalitySearch(nextValue);
    onChange("nationality", exactMatch ?? "");
    setIsNationalityListOpen(true);
  }

  function handleNationalityKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setIsNationalityListOpen(false);
      return;
    }

    if (event.key === "Enter" && isNationalityListOpen && filteredNationalityOptions[0]) {
      event.preventDefault();
      selectNationality(filteredNationalityOptions[0]);
    }
  }

  return (
    <div className="checkout-fields">
      <label>
        Nombre
        <input
          name="firstName"
          autoComplete="given-name"
          value={passenger.firstName}
          onChange={(event) => onChange("firstName", event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(fieldErrors.firstName)}
          aria-describedby={fieldErrors.firstName ? "firstName-error" : undefined}
          required
        />
        {fieldErrors.firstName ? (
          <span className="field-error" id="firstName-error">
            {fieldErrors.firstName}
          </span>
        ) : null}
      </label>
      <label>
        Apellido
        <input
          name="lastName"
          autoComplete="family-name"
          value={passenger.lastName}
          onChange={(event) => onChange("lastName", event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(fieldErrors.lastName)}
          aria-describedby={fieldErrors.lastName ? "lastName-error" : undefined}
          required
        />
        {fieldErrors.lastName ? (
          <span className="field-error" id="lastName-error">
            {fieldErrors.lastName}
          </span>
        ) : null}
      </label>
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          value={passenger.email}
          onChange={(event) => onChange("email", event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
          required
        />
        {fieldErrors.email ? (
          <span className="field-error" id="email-error">
            {fieldErrors.email}
          </span>
        ) : null}
      </label>
      <div className="phone-field-row">
        <label>
          Codigo de pais
          <select
            name="phoneCountryCode"
            value={passenger.phoneCountryCode}
            onChange={(event) => onChange("phoneCountryCode", event.target.value)}
            disabled={disabled}
            aria-invalid={Boolean(fieldErrors.phoneCountryCode)}
            aria-describedby={fieldErrors.phoneCountryCode ? "phoneCountryCode-error" : undefined}
            required
          >
            <option value="">Seleccionar</option>
            {countryDialCodes.map((country) => (
              <option value={country.value} key={country.value}>
                {country.label}
              </option>
            ))}
          </select>
          {fieldErrors.phoneCountryCode ? (
            <span className="field-error" id="phoneCountryCode-error">
              {fieldErrors.phoneCountryCode}
            </span>
          ) : null}
        </label>
        <label>
          Telefono
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={passenger.phone}
            onChange={(event) => onChange("phone", event.target.value)}
            disabled={disabled}
            aria-invalid={Boolean(fieldErrors.phone)}
            aria-describedby={fieldErrors.phone ? "phone-error" : undefined}
            required
          />
          {fieldErrors.phone ? (
            <span className="field-error" id="phone-error">
              {fieldErrors.phone}
            </span>
          ) : null}
        </label>
      </div>
      <label>
        Tipo de documento
        <select
          name="documentType"
          value={passenger.documentType}
          onChange={(event) => onChange("documentType", event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(fieldErrors.documentType)}
          aria-describedby={fieldErrors.documentType ? "documentType-error" : undefined}
          required
        >
          <option value="DNI">DNI</option>
          <option value="Pasaporte">Pasaporte</option>
          <option value="Cedula">Cedula</option>
        </select>
        {fieldErrors.documentType ? (
          <span className="field-error" id="documentType-error">
            {fieldErrors.documentType}
          </span>
        ) : null}
      </label>
      <label>
        Documento
        <input
          name="documentId"
          autoComplete="off"
          value={passenger.documentId}
          onChange={(event) => onChange("documentId", event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(fieldErrors.documentId)}
          aria-describedby={fieldErrors.documentId ? "documentId-error" : undefined}
          required
        />
        {fieldErrors.documentId ? (
          <span className="field-error" id="documentId-error">
            {fieldErrors.documentId}
          </span>
        ) : null}
      </label>
      <label>
        Nacionalidad
        <div className="nationality-combobox">
          <input
            name="nationality"
            autoComplete="off"
            value={isNationalityListOpen ? nationalitySearch : passenger.nationality}
            onChange={handleNationalityChange}
            onFocus={() => {
              setNationalitySearch(passenger.nationality);
              setIsNationalityListOpen(true);
            }}
            onKeyDown={handleNationalityKeyDown}
            onBlur={() => {
              window.setTimeout(() => {
                setNationalitySearch(passenger.nationality);
                setIsNationalityListOpen(false);
              }, 120);
            }}
            disabled={disabled}
            placeholder="Buscar nacionalidad"
            role="combobox"
            aria-expanded={isNationalityListOpen}
            aria-controls="nationality-options"
          />
          {isNationalityListOpen ? (
            <div className="nationality-options" id="nationality-options" role="listbox">
              {filteredNationalityOptions.length > 0 ? (
                filteredNationalityOptions.map((option) => (
                  <button
                    className="nationality-option"
                    type="button"
                    role="option"
                    aria-selected={option === passenger.nationality}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectNationality(option)}
                    key={option}
                  >
                    {option}
                  </button>
                ))
              ) : (
                <span className="nationality-empty">Sin resultados</span>
              )}
            </div>
          ) : null}
        </div>
      </label>
    </div>
  );
}

type QuantityPickerProps = {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  help?: string;
  onChange: (value: number) => void;
};

/** Selector − n + de cantidad, el mismo en los dos checkouts. */
export function QuantityPicker({ label, value, min = 1, max, disabled = false, help, onChange }: QuantityPickerProps) {
  return (
    <label className="quantity-field">
      {label}
      <span className="quantity-picker" role="group" aria-label={label}>
        <button
          className="quantity-button"
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={disabled || value <= min}
          aria-label="Restar uno"
        >
          −
        </button>
        <strong aria-live="polite">{value}</strong>
        <button
          className="quantity-button"
          type="button"
          onClick={() => onChange(max === undefined ? value + 1 : Math.min(max, value + 1))}
          disabled={disabled || (max !== undefined && value >= max)}
          aria-label="Sumar uno"
        >
          +
        </button>
      </span>
      {help ? <small className="quantity-help">{help}</small> : null}
    </label>
  );
}

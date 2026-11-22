"use client";

import { useEffect, useId, useRef, useState } from "react";
import { filterPhoneCountries, phoneCountries, phoneCountryLabel } from "@/lib/booking/phone-countries";
import "./phone-country-picker.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
};

export function PhoneCountryPicker({ value, onChange, disabled, required, error }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const results = open ? filterPhoneCountries(query) : [];
  const visible = open && !disabled;

  useEffect(() => {
    if (!visible) return;
    search.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [visible]);

  function select(code: string) {
    onChange(code);
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="phone-country-picker" ref={root} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={(event) => {
      if (visible && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    }}>
      <label htmlFor={id}>Codigo de pais</label>
      <div className="phone-country-controls">
        <select id={id} name="phoneCountryCode" value={value} onChange={(event) => {
          onChange(event.target.value);
          setOpen(false);
        }} disabled={disabled} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}>
          <option value="">Seleccionar</option>
          {phoneCountries.map((country) => <option value={country.value} key={country.value}>{phoneCountryLabel(country)}</option>)}
        </select>
        <button className="phone-country-search-button" type="button" ref={trigger} disabled={disabled}
          aria-label="Buscar país o prefijo" aria-expanded={visible} aria-controls={visible ? `${id}-search` : undefined}
          onClick={() => { setQuery(""); setOpen(!open); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" />
          </svg>
        </button>
      </div>
      {error ? <span className="field-error" id={`${id}-error`}>{error}</span> : null}
      {visible ? <div className="phone-country-search" id={`${id}-search`}>
        <label>
          Buscar por país o prefijo
          <input ref={search} type="search" value={query} placeholder="Ej. Estados Unidos o +1" autoComplete="off"
            onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (results[0]) select(results[0].value);
              }
            }} />
        </label>
        <div className="phone-country-results">
          {results.length ? results.map((country) => (
            <button key={country.value} type="button" onClick={() => select(country.value)}>{phoneCountryLabel(country)}</button>
          )) : <p className="muted" role="status">No hay coincidencias.</p>}
        </div>
      </div> : null}
    </div>
  );
}

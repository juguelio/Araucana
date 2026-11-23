"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { filterPhoneCountries } from "@/lib/booking/phone-countries";
import "./searchable-selects.css";

const COPY = {
  es: { search: "Buscar…", phone: "Buscar país o prefijo", empty: "No hay coincidencias", label: "Seleccionar opción" },
  en: { search: "Search…", phone: "Search country or dialing code", empty: "No matches found", label: "Choose an option" },
  pt: { search: "Buscar…", phone: "Buscar país ou código", empty: "Nenhum resultado", label: "Selecionar opção" }
};

type OpenSelect = {
  select: HTMLSelectElement;
  host: HTMLDivElement;
  query: string;
  version: number;
  ariaHidden: string | null;
  tabIndex: string | null;
};

function restoreNativeSelect({ select, ariaHidden, tabIndex }: OpenSelect) {
  if (ariaHidden === null) select.removeAttribute("aria-hidden");
  else select.setAttribute("aria-hidden", ariaHidden);
  if (tabIndex === null) select.removeAttribute("tabindex");
  else select.setAttribute("tabindex", tabIndex);
}

function selectAt(target: EventTarget | null) {
  const select = target instanceof Element ? target.closest("select") : null;
  return select && !select.matches(":disabled") && !select.multiple && select.size <= 1 ? select : null;
}

function plainText(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();
}

function labelFor(select: HTMLSelectElement) {
  const explicit = select.getAttribute("aria-label");
  if (explicit) return explicit;
  const label = select.labels?.[0]?.cloneNode(true);
  if (label instanceof HTMLElement) {
    label.querySelectorAll("select, input, button, .field-error, .searchable-select-popover").forEach((node) => node.remove());
  }
  return label?.textContent?.trim();
}

/** A single searchable UI for native selects. The original control owns form data and validation. */
export function SearchableSelects() {
  const [active, setActive] = useState<OpenSelect | null>(null);
  const current = useRef<OpenSelect | null>(null);
  const version = useRef(0);

  const close = useCallback((restoreFocus = false) => {
    const previous = current.current;
    if (!previous) return;
    current.current = null;
    restoreNativeSelect(previous);
    setActive(null);
    if (restoreFocus && previous.select.isConnected) previous.select.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function open(select: HTMLSelectElement, query = "") {
      if (current.current?.select === select) return;
      const host = document.createElement("div");
      host.className = "searchable-select-popover";
      host.setAttribute("popover", "manual");
      const next = { select, host, query, version: ++version.current,
        ariaHidden: select.getAttribute("aria-hidden"), tabIndex: select.getAttribute("tabindex") };
      current.current = next;
      setActive(next);
    }

    function clickSelect(event: MouseEvent) {
      const select = selectAt(event.target);
      if (!select || event.button !== 0) return;
      event.preventDefault();
      open(select);
    }

    function keyboardSelect(event: KeyboardEvent) {
      const select = selectAt(event.target);
      if (!select || event.ctrlKey || event.metaKey || event.isComposing) return;
      const openKeys = ["Enter", " ", "ArrowDown", "ArrowUp", "F4"];
      const printable = event.key.length === 1 && !event.altKey;
      if (!openKeys.includes(event.key) && !printable) return;
      event.preventDefault();
      open(select, printable && event.key !== " " ? event.key : "");
    }

    document.addEventListener("mousedown", clickSelect, true);
    document.addEventListener("click", clickSelect, true);
    document.addEventListener("keydown", keyboardSelect, true);
    return () => {
      document.removeEventListener("mousedown", clickSelect, true);
      document.removeEventListener("click", clickSelect, true);
      document.removeEventListener("keydown", keyboardSelect, true);
    };
  }, []);

  return active ? <SelectMenu key={active.version} active={active} close={close} /> : null;
}

function SelectMenu({ active, close }: {
  active: OpenSelect;
  close: (restoreFocus?: boolean) => void;
}) {
  const { select, host, query: initialQuery } = active;
  const [query, setQuery] = useState(initialQuery);
  const [index, setIndex] = useState(-1);
  const [options, setOptions] = useState(() => Array.from(select.options));
  const input = useRef<HTMLInputElement>(null);
  const listID = useId();
  const lang = document.documentElement.lang.split("-")[0];
  const copy = COPY[lang as keyof typeof COPY] ?? COPY.es;
  const label = labelFor(select) || copy.label;
  const isPhone = select.name === "phoneCountryCode";
  const phoneMatches = isPhone && query.trim() ? new Set(filterPhoneCountries(query).map((country) => country.value)) : null;
  const matches = plainText(query);
  const results = options.filter((option) => {
    const group = option.closest("optgroup");
    return !option.hidden && !group?.hidden &&
      (!matches || phoneMatches?.has(option.value) || plainText(`${option.label} ${group?.label ?? ""}`).includes(matches));
  });
  const allowed = (option: HTMLOptionElement) => !option.disabled && !option.closest("optgroup")?.disabled;
  const highlighted = index >= 0 ? results[index] : undefined;

  useLayoutEffect(() => {
    (select.closest("label") ?? select).after(host);

    function position() {
      const rect = select.getBoundingClientRect();
      const availableBelow = window.innerHeight - rect.bottom - 10;
      const availableAbove = rect.top - 10;
      const above = availableBelow < 220 && availableAbove > availableBelow;
      const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);
      host.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      host.style.top = `${rect.top}px`;
      host.style.width = `${width}px`;
      host.style.setProperty("--select-height", `${Math.max(rect.height, 38)}px`);
      host.style.setProperty("--select-list-height", `${Math.max(72, Math.min(260, above ? availableAbove : availableBelow))}px`);
      host.dataset.above = String(above);
    }

    position();
    if (typeof host.showPopover === "function") host.showPopover();
    else host.removeAttribute("popover");
    input.current?.focus({ preventScroll: true });
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;

    function dismiss(event: Event) {
      if (event.target instanceof Node && !host.contains(event.target) && (event.type === "focusin" || event.target !== select)) close();
    }
    const lifecycle = new MutationObserver(() => {
      if (!select.isConnected || !host.isConnected || select.matches(":disabled")) close();
    });
    const optionChanges = new MutationObserver(() => setOptions(Array.from(select.options)));
    lifecycle.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    optionChanges.observe(select, { childList: true, subtree: true, attributes: true, characterData: true });
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("focusin", dismiss);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      lifecycle.disconnect();
      optionChanges.disconnect();
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("focusin", dismiss);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      restoreNativeSelect(active);
      host.remove();
    };
  }, [active, select, host, close]);

  function choose(option: HTMLOptionElement) {
    if (!allowed(option) || select.matches(":disabled")) return;
    close(true);
    if (select.selectedIndex === option.index) return;
    select.selectedIndex = option.index;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  return createPortal(
    <>
      <input ref={input} type="text" role="combobox" className="searchable-select-input"
        aria-label={label}
        aria-labelledby={select.getAttribute("aria-labelledby") ?? undefined}
        aria-describedby={select.getAttribute("aria-describedby") ?? undefined}
        aria-expanded="true" aria-autocomplete="list" aria-controls={listID}
        aria-activedescendant={highlighted ? `${listID}-${index}` : undefined}
        placeholder={isPhone ? copy.phone : copy.search} autoComplete="off" value={query}
        onChange={(event) => { setQuery(event.target.value); setIndex(-1); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          } else if (event.key === "Enter") {
            event.preventDefault();
            const selected = !matches && results.find((option) => option.selected && allowed(option));
            const option = highlighted ?? (selected || results.find(allowed));
            if (option) choose(option);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            for (let i = index < 0 && step < 0 ? results.length - 1 : index + step; i >= 0 && i < results.length; i += step) {
              if (!allowed(results[i])) continue;
              setIndex(i);
              document.getElementById(`${listID}-${i}`)?.scrollIntoView({ block: "nearest" });
              break;
            }
          }
        }}
      />
      <div className="searchable-select-list" id={listID} role="listbox" aria-label={label}>
        {results.map((option, i) => (
          <div role="option" id={`${listID}-${i}`} key={option.index}
            aria-selected={option.index === select.selectedIndex} aria-disabled={!allowed(option) || undefined}
            data-highlighted={i === index || undefined} onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}>
            {option.label}
            {option.closest("optgroup")?.label ? <small>{option.closest("optgroup")?.label}</small> : null}
          </div>
        ))}
        {!results.length ? <p role="status">{copy.empty}</p> : null}
      </div>
    </>,
    host
  );
}

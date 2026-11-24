"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ImprimirTodas } from "@/components/imprimir-todas";
import { prepareServicePrint } from "./service-print-fit";
import "./service-print-selection.css";

export type ServicePrintDocument = {
  id: string;
  title: string;
  detail: string;
  content: ReactNode;
};

type Choice = { included: boolean; sheet: number };

export function ServicePrintSelection({ documents, children, defaultGrouped = false }: {
  documents: ServicePrintDocument[];
  children?: ReactNode;
  defaultGrouped?: boolean;
}) {
  const hasOriginal = children != null;
  const [printConfigured, setPrintConfigured] = useState(false);
  const printRoot = useRef<HTMLDivElement>(null);
  const [fitSingles, setFitSingles] = useState(false);
  useEffect(() => {
    let reset: (() => void) | undefined;
    const beforePrint = () => {
      reset?.();
      if (document.documentElement.hasAttribute("data-imprimir-una")) return;
      if (hasOriginal) flushSync(() => setPrintConfigured(true));
      if (printRoot.current) reset = prepareServicePrint(printRoot.current);
    };
    const afterPrint = () => {
      reset?.();
      reset = undefined;
      if (hasOriginal) setPrintConfigured(false);
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      reset?.();
    };
  }, [hasOriginal]);
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(documents.map(({ id }, index) => [id, { included: true, sheet: defaultGrouped ? 1 : index + 1 }]))
  );

  const selected = documents.filter(({ id }) => choices[id].included);
  const groups = new Map<number, ServicePrintDocument[]>();
  for (const document of selected) {
    const { sheet } = choices[document.id];
    const group = groups.get(sheet) ?? [];
    group.push(document);
    groups.set(sheet, group);
  }

  function change(id: string, update: Partial<Choice>) {
    setChoices((previous) => ({ ...previous, [id]: { ...previous[id], ...update } }));
  }

  function markAll(included: boolean) {
    setChoices((previous) => Object.fromEntries(
      Object.entries(previous).map(([id, choice]) => [id, { ...choice, included }])
    ));
  }

  function groupSelected() {
    setChoices((previous) => {
      const sheets = Object.values(previous).filter((choice) => choice.included).map((choice) => choice.sheet);
      if (sheets.length < 2) return previous;
      const sheet = Math.min(...sheets);
      return Object.fromEntries(
        Object.entries(previous).map(([id, choice]) => [id, choice.included ? { ...choice, sheet } : choice])
      );
    });
  }

  if (!documents.length) return children ?? null;

  return (
    <>
      <fieldset className="driver-print-options plain-card no-print">
        <legend>Qué órdenes imprimir</legend>
        {documents.length > 1 && (
          <p className="muted">Elegí el mismo número de hoja para las órdenes que querés imprimir juntas.</p>
        )}
        <ul className="driver-print-choices">
          {documents.map(({ id, title, detail }) => (
            <li key={id}>
              <label className="driver-print-choice">
                <input type="checkbox" checked={choices[id].included}
                  onChange={(event) => change(id, { included: event.target.checked })} />
                <span><strong>{title}</strong><small>{detail}</small></span>
              </label>
              {documents.length > 1 && (
                <label className="driver-print-sheet-choice">
                  <span>Hoja</span>
                  <select aria-label={`Hoja de ${title} · ${detail}`} value={choices[id].sheet} disabled={!choices[id].included}
                    onChange={(event) => change(id, { sheet: Number(event.target.value) })}>
                    {documents.map(({ id: optionId }, index) => <option key={optionId} value={index + 1}>{index + 1}</option>)}
                  </select>
                </label>
              )}
            </li>
          ))}
        </ul>
        <div className="inline-actions driver-print-actions">
          <label className="driver-print-choice">
            <input type="checkbox" checked={fitSingles} onChange={(event) => setFitSingles(event.target.checked)} />
            {documents.length > 1 ? "Ajustar también las órdenes individuales a una hoja" : "Ajustar a una hoja"}
          </label>
          {documents.length > 1 && (
            <>
              <button className="ghost-button" type="button" disabled={selected.length === documents.length} onClick={() => markAll(true)}>Marcar todas</button>
              <button className="ghost-button" type="button" disabled={!selected.length} onClick={() => markAll(false)}>Desmarcar todas</button>
              <button className="ghost-button" type="button" disabled={groups.size < 2} onClick={groupSelected}>Juntar seleccionadas</button>
            </>
          )}
          {selected.length
            ? <ImprimirTodas cantidad={selected.length} />
            : <button className="button" type="button" disabled>Imprimir</button>}
        </div>
      </fieldset>
      {hasOriginal && <div className={printConfigured ? "service-print-original no-print" : "service-print-original"}>{children}</div>}
      {groups.size > 0 && (!hasOriginal || printConfigured) ? (
        <div ref={printRoot} className={hasOriginal ? "service-print-output service-print-only" : "service-print-output"}>
          {[...groups.entries()].sort(([left], [right]) => left - right).map(([sheet, group]) => (
            <section className="driver-print-sheet" data-fit-page={group.length > 1 || fitSingles}
              data-compact={group.length > 1} key={sheet}>
              {documents.length > 1 && <h2 className="driver-print-sheet-title no-print">Hoja {sheet}</h2>}
              <div className="service-print-content">
                {group.map(({ id, content }) => <div className="driver-orders-document" key={id}>{content}</div>)}
              </div>
            </section>
          ))}
        </div>
      ) : groups.size === 0 && <p className="plain-card admin-section no-print">Marcá al menos una orden para imprimir.</p>}
    </>
  );
}

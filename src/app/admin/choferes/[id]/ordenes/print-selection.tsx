"use client";

import { useState, type ReactNode } from "react";
import { ImprimirTodas } from "@/components/imprimir-todas";

type PrintDocument = {
  id: string;
  title: string;
  detail: string;
  content: ReactNode;
};

type Choice = { included: boolean; sheet: number };

export function DriverPrintSelection({ documents }: { documents: PrintDocument[] }) {
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(documents.map(({ id }, index) => [id, { included: true, sheet: index + 1 }]))
  );

  const selected = documents.filter(({ id }) => choices[id].included);
  const groups = new Map<number, PrintDocument[]>();
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
      {groups.size > 0 ? (
        <div className="driver-orders-documents">
          {[...groups.entries()].sort(([left], [right]) => left - right).map(([sheet, group]) => (
            <section className="driver-print-sheet" data-compact={group.length > 1} key={sheet}>
              {documents.length > 1 && <h2 className="driver-print-sheet-title no-print">Hoja {sheet}</h2>}
              {group.map(({ id, content }) => <div className="driver-orders-document" key={id}>{content}</div>)}
            </section>
          ))}
        </div>
      ) : <p className="plain-card admin-section no-print">Marcá al menos una orden para imprimir.</p>}
    </>
  );
}

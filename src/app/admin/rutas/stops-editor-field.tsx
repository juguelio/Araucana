"use client";

import { useId, useMemo, useState } from "react";
import { emptyStopRow, normalizeStopRows, serializeStopRows, type StopRow } from "./stops-editor";

type StopsEditorFieldProps = {
  stops?: unknown;
};

function initialRows(stops: unknown): StopRow[] {
  const rows = normalizeStopRows(stops);
  return rows.length ? rows : [{ ...emptyStopRow }];
}

export function StopsEditorField({ stops }: StopsEditorFieldProps) {
  const id = useId();
  const [rows, setRows] = useState<StopRow[]>(() => initialRows(stops));
  const serializedStops = useMemo(() => serializeStopRows(rows), [rows]);

  function updateRow(index: number, field: keyof StopRow, value: string) {
    setRows((currentRows) =>
      currentRows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))
    );
  }

  function addRow() {
    setRows((currentRows) => [...currentRows, { ...emptyStopRow }]);
  }

  function removeRow(index: number) {
    setRows((currentRows) => {
      const nextRows = currentRows.filter((_, rowIndex) => rowIndex !== index);
      return nextRows.length ? nextRows : [{ ...emptyStopRow }];
    });
  }

  return (
    <div className="stops-editor span-2">
      <input type="hidden" name="stops" value={serializedStops} />
      <div className="stops-editor-head">
        <span>Paradas</span>
        <button className="ghost-button" type="button" onClick={addRow}>
          Agregar parada
        </button>
      </div>
      <p className="muted">Ingresá la tarifa desde el origen en la moneda de la ruta. Dejá el campo vacío si la parada no se vende por separado.</p>
      <div className="stops-editor-list">
        {rows.map((row, index) => {
          const rowId = `${id}-${index}`;

          return (
            <div className="stops-editor-row" key={rowId}>
              <label>
                Nombre
                <input
                  value={row.name}
                  onChange={(event) => updateRow(index, "name", event.target.value)}
                  placeholder="SMA"
                />
              </label>
              <label>
                Km
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={row.km}
                  onChange={(event) => updateRow(index, "km", event.target.value)}
                  placeholder="0"
                />
              </label>
              <label>
                Minutos
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={row.minutes}
                  onChange={(event) => updateRow(index, "minutes", event.target.value)}
                  placeholder="0"
                />
              </label>
              <label>
                Nota
                <input
                  value={row.note}
                  onChange={(event) => updateRow(index, "note", event.target.value)}
                  placeholder="Salida"
                />
              </label>
              <label>
                Tarifa por pasajero
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={row.price ?? ""}
                  onChange={(event) => updateRow(index, "price", event.target.value)}
                  placeholder="Sin tarifa"
                />
              </label>
              <button className="danger-button" type="button" onClick={() => removeRow(index)}>
                Quitar
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

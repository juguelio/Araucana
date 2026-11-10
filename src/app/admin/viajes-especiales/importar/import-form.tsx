"use client";

import { startTransition, useActionState } from "react";
import { importHistory, type ImportState } from "./actions";

function formatAmount(cents: number, currency: string) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(cents / 100);
}

export function ImportForm() {
  const [state, dispatch, pending] = useActionState(importHistory, {} as ImportState);
  const preview = state.preview;
  return <form onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget, event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : undefined);
    startTransition(() => dispatch(form));
  }}>
    <fieldset disabled={pending} className="plain-card admin-section">
      <legend>Archivo de origen</legend>
      <p>Descargá el libro completo de Google Sheets como Microsoft Excel (.xlsx). Revisá la vista previa antes de importar.</p>
      <label>Libro de Viajes especiales <input type="file" name="file" required accept=".xlsx" /></label>
      <button type="submit" className="ghost-button">{pending ? "Procesando…" : "Ver vista previa"}</button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
      {preview && <>
        <h2>Cotejo hasta el 23/08/2026</h2>
        <table className="data-table">
          <thead><tr><th>Concepto</th><th>Resumen</th><th>Detectado</th><th>Diferencia</th></tr></thead>
          <tbody>
            <tr><th>Tramos</th><td>{preview.expected.count}</td><td>{preview.actual.count}</td><td>{preview.actual.count - preview.expected.count}</td></tr>
            {(["ars", "usd"] as const).map((key) => {
              const currency = key.toUpperCase();
              const expected = preview.expected[key] ?? 0;
              return <tr key={key}><th>{currency}</th><td>{formatAmount(expected, currency)}</td>
                <td>{formatAmount(preview.actual[key], currency)}</td><td>{formatAmount(preview.actual[key] - expected, currency)}</td></tr>;
            })}
          </tbody>
        </table>
        {(preview.actual.count !== preview.expected.count || preview.actual.ars !== preview.expected.ars || preview.actual.usd !== preview.expected.usd) &&
          <p role="status">Hay diferencias con el resumen de agosto. Revisá las filas y los importes antes de confirmar.</p>}
        <h2>Vista previa de {preview.trips} viajes</h2>
        <p>Los tramos con el mismo número se agrupan. Las filas sin número quedan archivadas para revisión. Las filas ya procesadas se conservan.</p>
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Origen</th><th>Viaje</th><th>Fecha</th><th>Cliente</th><th>Servicio</th><th>Cobro en origen</th><th>Revisión</th></tr></thead>
          <tbody>{preview.rows.map((row) => <tr key={row.key}>
            <td>{row.sheet} · {row.row}</td><td>{row.trip ?? "—"}</td><td>{row.date}</td><td>{row.client}</td>
            <td>{row.description}</td><td>{row.billing || "—"}</td><td>{row.issues.join(" ") || "Sin observaciones"}</td>
          </tr>)}</tbody>
        </table></div>
        <button className="button" name="confirm" value={preview.token}>Confirmar importación después del cotejo</button>
      </>}
    </fieldset>
  </form>;
}

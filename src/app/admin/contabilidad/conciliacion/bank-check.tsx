"use client";
import { useState, useRef, useMemo } from "react";
import {
  compareStatement,
  currencySummary,
  readStatement,
  statementHeader,
  type LedgerPayment,
  type BankRow,
} from "@/lib/accounting/reconciliation";

type Cells = (string | number | null)[][];

async function download(name: string, sheet: string, rows: Cells, summary?: Cells) {
  const { Workbook } = await import("exceljs");
  const book = new Workbook();
  const page = book.addWorksheet(sheet);
  page.addRows(rows);
  page.views = [{ state: "frozen", ySplit: 1 }];
  page.columns.forEach((col) => {
    col.width = 25;
  });
  page.getRow(1).font = { bold: true };
  if (sheet === "Extracto") page.getColumn(2).numFmt = "@";
  if (summary) {
    const totals = book.addWorksheet("Resumen");
    totals.addRows(summary);
    totals.columns.forEach((col) => {
      col.width = 26;
    });
  }
  const url = URL.createObjectURL(
    new Blob([(await book.xlsx.writeBuffer()) as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".xlsx";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const display = (cents: number) =>
  (cents / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function BankCheck({
  month,
  payments,
}: {
  month: string;
  payments: (LedgerPayment & { provider: string; method: string | null })[];
}) {
  const [statement, setStatement] = useState<BankRow[] | null>(null);
  const [channel, setChannel] = useState("");
  const [source, setSource] = useState("");
  const channelKey = (payment: (typeof payments)[number]) =>
    JSON.stringify([payment.provider, payment.method]);
  const channels = new Map(
    payments.map((p) => [channelKey(p), [p.provider, p.method].filter(Boolean).join(" · ")]),
  );
  const result = useMemo(
    () =>
      statement &&
      compareStatement(
        statement,
        payments.filter((p) => !channel || channelKey(p) === channel),
      ),
    [statement, payments, channel],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const [limit, setLimit] = useState(25);
  const version = useRef(0);
  async function load(file?: File) {
    const current = ++version.current;
    setStatement(null);
    setSource("");
    setError("");
    setAll(false);
    setLimit(25);
    setBusy(Boolean(file));
    if (!file) return;
    try {
      const { Workbook } = await import("exceljs");
      const book = new Workbook();
      await book.xlsx.load(await file.arrayBuffer());
      const sheet = book.getWorksheet("Extracto") ?? book.worksheets[0];
      const rows: unknown[][] = [];
      sheet?.eachRow({ includeEmpty: true }, (row) =>
        rows.push([1, 2, 3, 4].map((i) => row.getCell(i).value)),
      );
      const checked = readStatement(rows, month);
      if (current === version.current) {
        setStatement(checked);
        setSource(file.name);
      }
    } catch (e) {
      if (current === version.current) setError(e instanceof Error ? e.message : "Revisá el archivo Excel.");
    } finally {
      if (current === version.current) setBusy(false);
    }
  }
  const totals = result ? currencySummary(result) : [];
  const exact = result?.filter((r) => r.status === "Coincidencia exacta").length ?? 0;
  const visible = (result ?? []).filter((r) => all || r.status !== "Coincidencia exacta");
  return (
    <>
      <p>
        Usá la hoja «Extracto» con fecha, referencia del pago o código de reserva, importe con signo y moneda.
        La lectura se hace en este navegador. Podés guardar el resultado en Excel antes de salir.
      </p>
      <label>
        Pagos a comparar{" "}
        <select
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value);
            setLimit(25);
          }}
        >
          <option value="">Todos los medios</option>
          {[...channels].map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="inline-actions">
        <button
          className="ghost-button"
          onClick={() =>
            download("plantilla-extracto", "Extracto", [statementHeader]).catch(() =>
              setError("No se pudo descargar la plantilla."),
            )
          }
        >
          Descargar plantilla
        </button>
        <label>
          Comparar extracto (.xlsx){" "}
          <input type="file" accept=".xlsx" onChange={(e) => load(e.target.files?.[0])} />
        </label>
      </div>
      {busy && <p role="status">Leyendo extracto…</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <section>
          <h3>Resultado del cotejo</h3>
          <p>
            {exact} {exact === 1 ? "coincidencia exacta" : "coincidencias exactas"} · {result.length - exact} {result.length - exact === 1 ? "fila" : "filas"} para revisar
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table embedded-table" aria-label="Totales por moneda">
              <thead>
                <tr>
                  <th>Moneda</th>
                  <th>Créditos del banco</th>
                  <th>Pagos aprobados</th>
                  <th>Créditos menos pagos</th>
                  <th>Débitos del banco</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((t) => (
                  <tr key={t.currency}>
                    <th>{t.currency}</th>
                    <td>{display(t.credits)}</td>
                    <td>{display(t.approved)}</td>
                    <td>{display(t.credits - t.approved)}</td>
                    <td>{display(t.debits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="inline-actions">
            <label>
              <input
                type="checkbox"
                checked={all}
                onChange={(e) => {
                  setAll(e.target.checked);
                  setLimit(25);
                }}
              />{" "}
              Incluir coincidencias exactas
            </label>
            <button
              className="ghost-button"
              onClick={() =>
                download(
                  "cotejo-" + month,
                  "Cotejo",
                  [
                    [
                      "Control",
                      "Fecha banco",
                      "Referencia banco",
                      "Importe banco",
                      "Moneda banco",
                      "Reserva",
                      "Referencia pago",
                      "Actualización pago",
                      "Importe pago",
                      "Moneda pago",
                    ],
                    ...result.map(({ status, bank: b, payment: p }) => [
                      status,
                      b?.date ?? null,
                      b?.reference ?? null,
                      b ? b.cents / 100 : null,
                      b?.currency ?? null,
                      p?.code ?? null,
                      p?.reference ?? null,
                      p?.date ?? null,
                      p ? p.cents / 100 : null,
                      p?.currency ?? null,
                    ]),
                  ],
                  [
                    ["Mes", month],
                    ["Extracto", source],
                    ["Medio de pago", channels.get(channel) ?? "Todos los medios"],
                    ["Coincidencias exactas", exact],
                    ["Filas para revisar", result.length - exact],
                    [],
                    [
                      "Moneda",
                      "Créditos del banco",
                      "Pagos aprobados",
                      "Créditos menos pagos",
                      "Débitos del banco",
                    ],
                    ...totals.map((t) => [
                      t.currency,
                      t.credits / 100,
                      t.approved / 100,
                      (t.credits - t.approved) / 100,
                      t.debits / 100,
                    ]),
                  ],
                ).catch(() => setError("No se pudo descargar el resultado."))
              }
            >
              Descargar cotejo completo
            </button>
          </div>
          {visible.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table embedded-table">
                <thead>
                  <tr>
                    <th>Control</th>
                    <th>Fecha banco</th>
                    <th>Referencia banco</th>
                    <th>Extracto</th>
                    <th>Reserva</th>
                    <th>Pago aprobado</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, limit).map(({ status, bank: b, payment: p }, i) => (
                    <tr key={i}>
                      <td>{status}</td>
                      <td>{b?.date ?? "—"}</td>
                      <td>{b?.reference || "—"}</td>
                      <td>{b ? display(b.cents) + " " + b.currency : "—"}</td>
                      <td>{p?.code ?? "—"}</td>
                      <td>{p ? display(p.cents) + " " + p.currency : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Todos los créditos y pagos comparados coinciden.</p>
          )}
          {limit < visible.length && (
            <button className="ghost-button" onClick={() => setLimit(limit + 25)}>
              Ver más filas
            </button>
          )}
        </section>
      )}
    </>
  );
}

import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { listDepartureSheets } from "@/lib/departure-sheets/repository";
import { departureSheetKinds, departureSheetCopy } from "@/lib/departure-sheets/types";
import { createDepartureSheetAction } from "./actions";
import "./planillas.css";

const base = "/admin/planillas";

function formatDay(value: Date | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "America/Argentina/Salta" }).format(value);
}

export const dynamic = "force-dynamic";

export default async function DepartureSheetsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const sheets = await listDepartureSheets();

  return (
    <AdminShell
      title="Planillas de salida"
      eyebrow="Documentación"
      role={user.role}
    >
      {error ? <p className="form-alert" role="alert">{error}</p> : null}
      <section className="plain-card admin-section">
        <h2>Nueva planilla</h2>
        <p className="muted">
          Elegí el tipo de planilla, ponele un nombre para reconocerla y compartí el link con los pasajeros.
          Cada uno carga sus datos una vez y quedan en la planilla de abajo.
        </p>
        <form action={createDepartureSheetAction} className="admin-form-grid">
          <label>
            Tipo de planilla
            <select name="kind" defaultValue="DUT" required>
              {departureSheetKinds.map((kind) => (
                <option value={kind} key={kind}>
                  {departureSheetCopy[kind].label}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            Nombre de la planilla
            <input name="title" required maxLength={120} placeholder="Ej. Viaje a Bariloche · noviembre" />
          </label>
          <label>
            Fecha de salida
            <input type="date" name="departureAt" />
          </label>
          <label>
            Destino
            <input name="destination" maxLength={120} placeholder="Ej. Bariloche (Río Negro) / Chile" />
          </label>
          <label>
            Paso fronterizo <span className="planilla-hint">(sólo DUT)</span>
            <input name="borderCrossing" maxLength={120} placeholder="Ej. Cardenal Samoré" />
          </label>
          <label className="span-2">
            Nota interna <span className="planilla-hint">(no la ve el pasajero)</span>
            <textarea name="notes" maxLength={600} rows={2} placeholder="Ej. viaje de egresados, coordinador a cargo…" />
          </label>
          <div className="span-2 inline-actions">
            <button className="button" type="submit">Crear planilla y generar link</button>
          </div>
        </form>
      </section>

      <section className="plain-card admin-section">
        <h2>Planillas</h2>
        {sheets.length === 0 ? (
          <p> Todavía no hay planillas. Creá la primera arriba.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table planilla-tabla">
              <thead>
                <tr>
                  <th>Planilla</th>
                  <th>Tipo</th>
                  <th>Salida</th>
                  <th>Pasajeros</th>
                  <th>Link</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((sheet) => {
                  const day = formatDay(sheet.departureAt);
                  return (
                    <tr key={sheet.id}>
                      <td>
                        <Link href={`${base}/${sheet.id}`}>{sheet.title}</Link>
                        {sheet.destination ? <small>{sheet.destination}</small> : null}
                      </td>
                      <td>{departureSheetCopy[sheet.kind as keyof typeof departureSheetCopy]?.shortLabel ?? sheet.kind}</td>
                      <td>{day ?? "—"}</td>
                      <td className="planilla-num">{sheet.passengerCount}</td>
                      <td>
                        <Link href={`/planilla/${sheet.token}`} target="_blank">Abrir link</Link>
                      </td>
                      <td>
                        <span className="pill pill-estado" data-tono={sheet.isOpen ? "ok" : "normal"}>
                          {sheet.isOpen ? "Recibiendo datos" : "Cerrada"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}

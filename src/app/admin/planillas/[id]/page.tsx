import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { getDepartureSheetById } from "@/lib/departure-sheets/repository";
import {
  departureSheetCopy,
  formatBirthDate,
  isDepartureSheetKind,
  passengerFullName,
  sexLabels,
  type DepartureSheetKind,
  type SexValue
} from "@/lib/departure-sheets/types";
import { removeDepartureSheetPassengerAction, setDepartureSheetOpenAction } from "../actions";
import { PlanillaLinkBox } from "./link-box";
import "../planillas.css";

function formatDay(value: Date | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "America/Argentina/Salta" }).format(value);
}

export const dynamic = "force-dynamic";

export default async function DepartureSheetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const { id } = await params;
  const sheet = await getDepartureSheetById(id);

  if (!sheet) {
    notFound();
  }

  const kind: DepartureSheetKind = isDepartureSheetKind(sheet.kind) ? sheet.kind : "DUT";
  const copy = departureSheetCopy[kind];
  const reservation = sheet.reservation;
  const departureAt =
    reservation.schedule?.departureAt ?? reservation.chapelcoDetails?.serviceDate ?? reservation.airportDetails?.serviceDate ?? null;
  const day = formatDay(departureAt);
  const routeLabel = reservation.route
    ? `${reservation.route.from} - ${reservation.dropoffStop ?? reservation.route.to}`
    : "Traslado";

  return (
    <AdminShell
      title={`Planilla ${copy.shortLabel} · ${reservation.code}`}
      eyebrow="Planilla de salida"
      role={user.role}
      action={
        <div className="inline-actions">
          <Link className="ghost-button" href={`/admin/reservas/${reservation.code}`}>Volver a la reserva</Link>
          <a className="button" href={`/admin/planillas/${sheet.id}/export`}>Descargar planilla (.xlsx)</a>
        </div>
      }
    >
      <section className="plain-card admin-section planilla-detalle">
        <h2>{copy.label}</h2>
        <div className="planilla-meta">
          <div>
            <span>Reserva</span>
            <strong>{reservation.code}</strong>
          </div>
          <div>
            <span>Ruta</span>
            <strong>{routeLabel}</strong>
          </div>
          <div>
            <span>Salida</span>
            <strong>{day ?? "—"}</strong>
          </div>
          <div>
            <span>Pasajeros cargados</span>
            <strong>{sheet.passengers.length}</strong>
          </div>
          <div>
            <span>Estado</span>
            <strong>{sheet.isOpen ? "Recibiendo datos" : "Cerrada"}</strong>
          </div>
        </div>

        <PlanillaLinkBox token={sheet.token} title={`Reserva ${reservation.code} · ${copy.shortLabel}`} />

        <form action={setDepartureSheetOpenAction} className="inline-actions">
          <input type="hidden" name="id" value={sheet.id} />
          <input type="hidden" name="code" value={reservation.code} />
          <input type="hidden" name="isOpen" value={sheet.isOpen ? "0" : "1"} />
          <button className="ghost-button" type="submit">
            {sheet.isOpen ? "Cerrar el link (no recibe más datos)" : "Reabrir el link"}
          </button>
          <p className="muted">
            {sheet.isOpen
              ? "Cerrado, el link sigue mostrando la planilla pero nadie puede cargar datos."
              : "Abierto de nuevo: los pasajeros pueden volver a cargar sus datos."}
          </p>
        </form>
      </section>

      <section className="plain-card admin-section">
        <h2>Pasajeros</h2>
        {sheet.passengers.length === 0 ? (
          <p className="planilla-vacio">
            Todavía no cargó nadie. Mandale el link de arriba al pasajero de la reserva: completa sus
            datos una vez y aparece en esta lista.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="data-table planilla-tabla">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Apellido y nombre</th>
                  <th>Documento</th>
                  <th>Sexo</th>
                  <th>Nacimiento</th>
                  <th>Nacionalidad</th>
                  {kind === "PROVINCIA" ? <th>Ocupación</th> : null}
                  {kind === "PROVINCIA" ? <th>País de residencia</th> : null}
                  <th />
                </tr>
              </thead>
              <tbody>
                {sheet.passengers.map((passenger) => (
                  <tr key={passenger.id}>
                    <td className="planilla-num">{passenger.position}</td>
                    <td>
                      {passengerFullName(passenger)}
                      <small>cargado {new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Salta" }).format(passenger.createdAt)}</small>
                    </td>
                    <td>{passenger.documentType} {passenger.documentNumber}</td>
                    <td>{sexLabels[passenger.sex as SexValue] ?? passenger.sex}</td>
                    <td>{formatBirthDate(passenger.birthDate)}</td>
                    <td>{passenger.nationality}</td>
                    {kind === "PROVINCIA" ? <td>{passenger.occupation ?? "—"}</td> : null}
                    {kind === "PROVINCIA" ? <td>{passenger.residenceCountry ?? "—"}</td> : null}
                    <td>
                      <form action={removeDepartureSheetPassengerAction}>
                        <input type="hidden" name="passengerId" value={passenger.id} />
                        <input type="hidden" name="sheetId" value={sheet.id} />
                        <button className="ghost-button" type="submit">Quitar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}

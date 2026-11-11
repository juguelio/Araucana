import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { FLIGHT_STATUSES, statusLabel } from "@/lib/airport/flights";
import { fechaLocal } from "@/lib/airport/projection";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { localInput } from "@/lib/special-trips/data";
import { updateFlightAction } from "../../actions";

export default async function EditAirportFlightPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const flight = await prisma.flight.findUnique({ where: { id } });
  if (!flight) notFound();

  const back = `/admin/aeropuerto?date=${fechaLocal(flight.scheduledAt)}#vuelo-${id}`;
  return (
    <AdminShell title="Editar vuelo" eyebrow={flight.number} role={user.role} notice={notice}
      action={<Link className="ghost-button" href={back}>Volver a vuelos</Link>}>
      <section className="plain-card admin-section">
        <h2>{flight.number}</h2>
        <p>Programado para {localInput(flight.scheduledAt).replace("T", " ")}.</p>
        {flight.estimatedAt ? <p>Horario estimado actual {localInput(flight.estimatedAt).replace("T", " ")}.</p> : null}
        <form className="admin-form-grid" action={updateFlightAction}>
          <input type="hidden" name="id" value={id} />
          <label>Estado
            <select name="status" defaultValue={flight.status}>
              {!FLIGHT_STATUSES.some((status) => status.code === flight.status)
                ? <option value={flight.status}>{statusLabel(flight.status)}</option> : null}
              {FLIGHT_STATUSES.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
          <label>Nueva fecha y hora estimada (opcional)<input type="datetime-local" name="estimatedAt" /></label>
          <div className="form-actions"><button className="button" type="submit">Guardar cambios</button></div>
        </form>
      </section>
    </AdminShell>
  );
}

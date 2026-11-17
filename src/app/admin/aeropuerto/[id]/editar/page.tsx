import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { FLIGHT_STATUSES, statusLabel } from "@/lib/airport/flights";
import { fechaLocal } from "@/lib/airport/projection";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { localInput } from "@/lib/special-trips/data";
import { deleteFlightAction, updateFlightAction } from "../../actions";
import { ConfirmVehicleButton } from "../../../naves/[id]/confirm-vehicle-button";

export default async function EditAirportFlightPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const flight = await prisma.flight.findUnique({ where: { id }, include: { _count: { select: { reservations: true } } } });
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

      {/* «Borrar vuelo» vivía en el menú «Gestionar vuelo» del tablero; ahora está acá, como en las naves. */}
      <section className="plain-card admin-section" aria-labelledby="borrar-vuelo">
        <h2 id="borrar-vuelo">Borrar vuelo</h2>
        {flight._count.reservations > 0 ? (
          <p className="muted">
            Tiene {flight._count.reservations} {flight._count.reservations === 1 ? "reserva" : "reservas"}: pasalas a otro vuelo antes de
            borrarlo, para que nadie quede sin traslado.
          </p>
        ) : (
          <form action={deleteFlightAction}>
            <input type="hidden" name="id" value={id} />
            <ConfirmVehicleButton className="ghost-button" label="Borrar vuelo" pregunta={`¿Borrar el vuelo ${flight.number}? No se puede deshacer.`} />
          </form>
        )}
      </section>
    </AdminShell>
  );
}

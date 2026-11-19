import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { listAdminSchedules } from "@/lib/booking/repository";
import { NuevaReservaForm } from "./nueva-reserva-form";

type NewReservationPageProps = {
  searchParams?: Promise<{ notice?: string }>;
};

const dayFormatter = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "2-digit", month: "short", timeZone: "America/Argentina/Salta" });
const timeFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Salta" });

export default async function NewReservationPage({ searchParams }: NewReservationPageProps) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  // El filtro grueso va en la base (abiertas/documentación, desde hoy): la pantalla no trae meses
  // de historial con todas sus reservas. El cupo se calcula sobre las reservas, así que va acá.
  // `excludeAirport`: el aeropuerto se carga desde «Crear reserva de aeropuerto», eligiendo el
  // vuelo. Ofrecerlo por salida horaria creaba reservas sin número de vuelo (issue #79).
  const schedules = (await listAdminSchedules({ bookableOnly: true, excludeAirport: true }))
    .filter((schedule) => schedule.availableSeats > 0)
    .map((schedule) => ({
      id: schedule.id,
      from: schedule.from,
      to: schedule.to,
      dayKey: argentinaDateKey(schedule.departureAt),
      dayLabel: dayFormatter.format(schedule.departureAt),
      timeLabel: timeFormatter.format(schedule.departureAt),
      availableSeats: schedule.availableSeats,
      status: schedule.status,
      stopFares: schedule.stopFares,
      bookingMode: schedule.bookingMode,
      priceCents: schedule.priceCents,
      currency: schedule.currency
    }));

  return (
    <AdminShell title="Crear reserva" eyebrow="Nueva reserva" notice={params?.notice} role={user.role}>
      {/* Con el template del aeropuerto (18-nov): el recuadro del viaje manda; el aeropuerto sigue
          teniendo su propia pantalla porque se reserva por vuelo. */}
      <section className="admin-section alta-pagina">
        <p className="alta-aeropuerto muted">
          ¿Es un traslado al aeropuerto? <Link className="table-link" href="/admin/aeropuerto/reservar">Crear reserva de aeropuerto ›</Link>
        </p>
        {schedules.length ? (
          <NuevaReservaForm schedules={schedules} />
        ) : <p className="muted">No hay salidas futuras con lugares disponibles.</p>}
      </section>
    </AdminShell>
  );
}

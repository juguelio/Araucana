import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { listAdminSchedules } from "@/lib/booking/repository";
import { createAdminReservationAction } from "../actions";
import { NewReservationForm } from "./new-reservation-form";

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
      <section className="plain-card admin-section create-reservation-card">
        <div>
          <p className="eyebrow">Carga manual</p>
          <h2>Reservá lugares para un pasajero</h2>
          <p className="muted">Elegí la salida y la cantidad de asientos. No se asignan números de asiento.</p>
          <Link className="ghost-button" href="/admin/aeropuerto/reservar">Crear reserva de aeropuerto</Link>
        </div>
        {schedules.length ? (
          <NewReservationForm action={createAdminReservationAction} schedules={schedules} />
        ) : <p className="muted">No hay salidas futuras con lugares disponibles.</p>}
      </section>
    </AdminShell>
  );
}
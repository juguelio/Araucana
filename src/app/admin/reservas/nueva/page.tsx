import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { listAdminSchedules } from "@/lib/booking/repository";
import { createAdminReservationAction } from "../actions";
import { SalidaPicker } from "./salida-picker";

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
  const schedules = (await listAdminSchedules({ bookableOnly: true }))
    .filter((schedule) => schedule.availableSeats > 0)
    .map((schedule) => ({
      id: schedule.id,
      from: schedule.from,
      to: schedule.to,
      dayKey: argentinaDateKey(schedule.departureAt),
      dayLabel: dayFormatter.format(schedule.departureAt),
      timeLabel: timeFormatter.format(schedule.departureAt),
      availableSeats: schedule.availableSeats,
      status: schedule.status
    }));

  return (
    <AdminShell title="Crear reserva" eyebrow="Nueva reserva" notice={params?.notice} role={user.role}>
      <section className="plain-card admin-section create-reservation-card">
        <div>
          <p className="eyebrow">Carga manual</p>
          <h2>Reservá lugares para un pasajero</h2>
          <p className="muted">Elegí la salida y la cantidad de asientos. No se asignan números de asiento.</p>
        </div>
        {schedules.length ? (
          <form className="admin-form-grid" action={createAdminReservationAction}>
            <SalidaPicker schedules={schedules} />
            <label>
              Cantidad de asientos
              <input name="passengerCount" type="number" min="1" max="24" defaultValue="1" required />
            </label>
            <label>
              Nombre
              <input name="firstName" autoComplete="given-name" required />
            </label>
            <label>
              Apellido
              <input name="lastName" autoComplete="family-name" required />
            </label>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Teléfono
              <input name="phone" type="tel" autoComplete="tel" placeholder="+54 9..." required />
            </label>
            <label>
              Tipo de documento
              <select name="documentType" defaultValue="DNI" required><option>DNI</option><option>Pasaporte</option><option>Cedula</option></select>
            </label>
            <label>
              Documento
              <input name="documentId" required />
            </label>
            <label>
              Nacionalidad
              <input name="nationality" placeholder="Opcional" />
            </label>
            <div className="form-actions span-2"><button className="button" type="submit">Crear reserva</button><Link className="ghost-button" href="/admin/reservas">Cancelar</Link></div>
          </form>
        ) : <p className="muted">No hay salidas futuras con lugares disponibles.</p>}
      </section>
    </AdminShell>
  );
}

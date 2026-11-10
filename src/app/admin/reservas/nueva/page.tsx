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
          <form className="alta-form" action={createAdminReservationAction}>
            <SalidaPicker schedules={schedules} />
            <div className="alta-pasajero">
              <div className="alta-pasajero-head">
                <p className="eyebrow">Pasajero</p>
                <p className="muted">Contacto y documento del titular de la reserva.</p>
              </div>
              <div className="admin-form-grid alta-campos">
                <label>
                  Nombre
                  <input name="firstName" autoComplete="given-name" required />
                </label>
                <label>
                  Apellido
                  <input name="lastName" autoComplete="family-name" required />
                </label>
                <label>
                  Email (opcional)
                  <input name="email" type="email" autoComplete="email" />
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
                  Documento (opcional)
                  <input name="documentId" />
                </label>
                <label className="span-2">
                  Nacionalidad
                  <input name="nationality" placeholder="Opcional" />
                </label>
              </div>
              <div className="form-actions">
                <button className="button" type="submit">Crear reserva</button>
                <Link className="ghost-button" href="/admin/reservas">Cancelar</Link>
              </div>
            </div>
          </form>
        ) : <p className="muted">No hay salidas futuras con lugares disponibles.</p>}
      </section>
    </AdminShell>
  );
}

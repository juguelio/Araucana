import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { listAdminRoutes, listAdminSchedules } from "@/lib/booking/repository";
import { AeropuertoAlta } from "../../aeropuerto/reservar/aeropuerto-alta";
import { NuevaReservaForm } from "./nueva-reserva-form";
import { ServicioSelector } from "./servicio-selector";
import { serviciosDeRutas, unificarLugares } from "./viaje-utils";
import "./servicio-selector.css";

type NewReservationPageProps = {
  searchParams?: Promise<{ notice?: string; servicio?: string; date?: string; tramos?: string; sentido?: string; vuelo?: string }>;
};

const dayFormatter = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "2-digit", month: "short", timeZone: "America/Argentina/Salta" });
const timeFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Salta" });

/**
 * «Reservar»: la pantalla única de reservas del panel (pedido de Jugue, 19-nov: «que todo se pueda
 * hacer desde la misma pantalla… la primera opción aeropuerto, luego Traful»).
 * - Arriba, «¿Qué reservás?»: Aeropuerto Chapelco primero, y después un servicio por cada recorrido
 *   con salidas (Villa Traful, Villa La Angostura, Hua Hum…), los de más salidas primero.
 * - Abajo, el alta de ese servicio con el mismo template: el aeropuerto por vuelo (lo que antes era
 *   `/admin/aeropuerto/reservar`, que ahora redirige acá) y las rutas por salida.
 * Sin servicio elegido, abre en el aeropuerto.
 */
export default async function NewReservationPage({ searchParams }: NewReservationPageProps) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = (await searchParams) ?? {};
  // Todas las rutas activas que se reservan por salida, tengan o no salidas cargadas: las que no
  // tienen aparecen igual, con el link para cargarlas. Aeropuerto y Chapelco van por su cuenta.
  const rutasCrudas = (await listAdminRoutes())
    .filter((ruta) => ruta.isActive && ruta.bookingMode !== "AIRPORT" && ruta.bookingMode !== "CHAPELCO")
    .map((ruta) => ({ id: ruta.id, from: ruta.from, to: ruta.to }));
  // El filtro grueso va en la base (abiertas/documentación, desde hoy). `excludeAirport`: el
  // aeropuerto se reserva por vuelo, no por salida horaria (issue #79).
  const salidasCrudas = (await listAdminSchedules({ bookableOnly: true, excludeAirport: true }))
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
  // Un nombre por lugar (con o sin tilde) antes de armar los servicios, así el recorrido elegido arriba
  // coincide con los lugares del formulario.
  const { salidas, rutas } = unificarLugares(salidasCrudas, rutasCrudas);
  const servicios = serviciosDeRutas(salidas, rutas);
  const pedido = typeof params.servicio === "string" ? params.servicio : "aeropuerto";
  const servicio = servicios.find((item) => item.clave === pedido) ?? null;
  const actual = servicio ? servicio.clave : "aeropuerto";

  return (
    <AdminShell title="Reservar" eyebrow="Nueva reserva" notice={params.notice} role={user.role}>
      <section className="admin-section alta-pagina">
        <ServicioSelector actual={actual} servicios={servicios} />
        {servicio ? (
          salidas.length || rutas.length ? (
            // La clave remonta el formulario al cambiar de servicio: arranca limpio en ese recorrido.
            <NuevaReservaForm key={servicio.clave} schedules={salidas} rutas={rutas} inicio={{ origen: servicio.origen, destino: servicio.destino }} />
          ) : <p className="muted">No hay salidas futuras con lugares disponibles.</p>
        ) : (
          <AeropuertoAlta date={params.date} tramos={params.tramos} sentido={params.sentido} vuelo={params.vuelo} />
        )}
      </section>
    </AdminShell>
  );
}

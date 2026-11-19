import { AdminShell } from "@/components/admin-shell";
import { AirportCheckoutForm } from "@/app/reservar/[slug]/airport-checkout-form";
import { loadAirportCheckoutFlights } from "@/lib/airport/checkout-flights";
import { getAirportFares } from "@/lib/airport/fares";
import { getAirportExtras } from "@/lib/airport/extras-settings";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { getAirportOfficePickup, officePickupReady } from "@/lib/airport/office-pickup";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { listAdminRoutes, listAdminSchedules } from "@/lib/booking/repository";
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
  // Todas las rutas activas que se reservan por salida, tengan o no salidas cargadas (19-nov: «te
  // están faltando rutas»): las que no tienen aparecen igual en Desde/Hacia, con el link para cargarlas.
  // El aeropuerto y Chapelco tienen su propia pantalla.
  const rutas = (await listAdminRoutes())
    .filter((ruta) => ruta.isActive && ruta.bookingMode !== "AIRPORT" && ruta.bookingMode !== "CHAPELCO")
    .map((ruta) => ({ id: ruta.id, from: ruta.from, to: ruta.to }));
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

  // El traslado al aeropuerto se carga en esta misma pantalla (19-nov: «exactamente igual a la
  // experiencia de la página de aeropuerto»), así que se traen los mismos datos que esa página.
  const hoy = argentinaDateKey(new Date());
  const fares = await getAirportFares();
  const rutaAeropuerto = fares.ARRIVAL ?? fares.DEPARTURE;
  const checkoutAeropuerto = rutaAeropuerto
    ? await Promise.all([loadAirportCheckoutFlights(hoy), getAirportCoverage(), getAirportExtras(), getAirportOfficePickup()])
        .then(([flights, coverage, extras, officePickup]) => ({ flights, coverage, extras, officePickup }))
    : null;

  return (
    <AdminShell title="Crear reserva" eyebrow="Nueva reserva" notice={params?.notice} role={user.role}>
      {/* Con el template del aeropuerto (18-nov): el recuadro del viaje manda; el aeropuerto sigue
          teniendo su propia pantalla porque se reserva por vuelo. */}
      <section className="admin-section alta-pagina">
        {/* Las instrucciones del aeropuerto ya no van arriba: es una opción más en «Hacia», la primera. */}
        {schedules.length || rutaAeropuerto ? (
          <NuevaReservaForm
            schedules={schedules}
            rutas={rutas}
            aeropuertoCheckout={
              rutaAeropuerto && checkoutAeropuerto ? (
                <AirportCheckoutForm
                  fromAdmin
                  route={rutaAeropuerto}
                  fares={fares}
                  initialDirection={fares.ARRIVAL ? "ARRIVAL" : "DEPARTURE"}
                  startAtFlights={false}
                  initialDate={hoy}
                  initialFlights={checkoutAeropuerto.flights}
                  coverage={checkoutAeropuerto.coverage}
                  extras={checkoutAeropuerto.extras}
                  officePickup={officePickupReady(checkoutAeropuerto.officePickup) ? checkoutAeropuerto.officePickup : null}
                />
              ) : null
            }
          />
        ) : <p className="muted">No hay salidas futuras con lugares disponibles.</p>}
      </section>
    </AdminShell>
  );
}

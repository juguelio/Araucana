import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { claveDeLugar } from "@/lib/booking/place-names";
import { listAdminRoutes, listAdminSchedules } from "@/lib/booking/repository";
import { AeropuertoAlta, ALTA_AEROPUERTO } from "../../aeropuerto/reservar/aeropuerto-alta";
import { NuevaReservaForm } from "./nueva-reserva-form";
import { destinosDesde, origenes, serviciosDeRutas, unificarLugares } from "./viaje-utils";

type NewReservationPageProps = {
  searchParams?: Promise<{
    notice?: string; servicio?: string; desde?: string; hacia?: string; date?: string; tramos?: string; sentido?: string; vuelo?: string;
    /** `abrir=vuelta`: al pasar a ida y vuelta, la vuelta abre sus días sin un segundo toque. */
    abrir?: string;
  }>;
};

const dayFormatter = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "2-digit", month: "short", timeZone: "America/Argentina/Salta" });
const timeFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Salta" });
const SAN_MARTIN = "san martin de los andes";
const NUEVA = "/admin/reservas/nueva";

function salidasDe(cantidad: number) {
  return cantidad ? `${cantidad} ${cantidad === 1 ? "salida" : "salidas"} con lugar` : "Sin salidas cargadas";
}

/**
 * «Reservar»: la pantalla única de reservas del panel. Pedido de Jugue (19-nov): «ese panel tiene que
 * desaparecer y que eso esté ya en el nombre de los lugares, empezando por SMA → Aeropuerto Chapelco
 * por default… cuando haya más rutas va a estar muy cluttered».
 * - No hay selector de servicio: el servicio sale de los lugares. «Desde»/«Hacia» listan el aeropuerto y
 *   los lugares de todas las rutas; elegir uno del otro servicio cambia el alta, en esta misma pantalla.
 * - Por defecto: San Martín de los Andes → Aeropuerto Chapelco (salida al aeropuerto).
 * - Aeropuerto: `?servicio=aeropuerto&sentido=…` (lo que era `/admin/aeropuerto/reservar`, que redirige
 *   acá). Rutas por salida: `?desde=…&hacia=…`. `?servicio=<recorrido>` (del 19-nov) sigue andando.
 */
export default async function NewReservationPage({ searchParams }: NewReservationPageProps) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = (await searchParams) ?? {};
  // Todas las rutas activas que se reservan por salida, tengan o no salidas cargadas. Aeropuerto y
  // Chapelco van por su cuenta.
  const rutasCrudas = (await listAdminRoutes())
    .filter((ruta) => ruta.isActive && ruta.bookingMode !== "AIRPORT" && ruta.bookingMode !== "CHAPELCO")
    .map((ruta) => ({ id: ruta.id, from: ruta.from, to: ruta.to, bookingMode: ruta.bookingMode, currency: ruta.currency }));
  // `excludeAirport`: el aeropuerto se reserva por vuelo, no por salida horaria (issue #79).
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
  const { salidas, rutas } = unificarLugares(salidasCrudas, rutasCrudas);
  const lugar = (pedido?: string) => {
    if (!pedido) return null;
    const clave = claveDeLugar(pedido);
    return [...origenes(salidas, rutas).map((item) => item.nombre), ...rutas.map((r) => r.to), ...salidas.map((s) => s.to)]
      .find((nombre) => claveDeLugar(nombre) === clave) ?? null;
  };
  const sanMartin = lugar(SAN_MARTIN) ?? "San Martín de los Andes";

  // ¿Qué alta va? Una ruta por salida si lo piden los lugares (o un recorrido del 19-nov); si no, aeropuerto.
  let recorrido: { origen: string; destino: string } | null = null;
  const desde = lugar(params.desde);
  if (desde) {
    const hacia = lugar(params.hacia);
    const posibles = destinosDesde(salidas, desde, rutas).map((item) => item.nombre);
    recorrido = { origen: desde, destino: hacia && posibles.includes(hacia) ? hacia : posibles[0] ?? "" };
  } else if (params.servicio && params.servicio !== "aeropuerto") {
    const servicio = serviciosDeRutas(salidas, rutas).find((item) => item.clave === params.servicio);
    if (servicio) recorrido = { origen: servicio.origen, destino: servicio.destino };
  }

  // Los lugares de las rutas para la barra del aeropuerto: «Desde» todos los orígenes menos San Martín
  // (que ya está), y «Hacia» —saliendo de San Martín— los destinos de sus rutas.
  const lugaresExtra = {
    desde: origenes(salidas, rutas)
      .filter((item) => claveDeLugar(item.nombre) !== SAN_MARTIN)
      .map((item) => ({ nombre: item.nombre, detalle: salidasDe(item.salidas), href: `${NUEVA}?desde=${encodeURIComponent(item.nombre)}` })),
    hacia: destinosDesde(salidas, sanMartin, rutas)
      .map((item) => ({
        nombre: item.nombre,
        detalle: salidasDe(item.salidas),
        href: `${NUEVA}?desde=${encodeURIComponent(sanMartin)}&hacia=${encodeURIComponent(item.nombre)}`
      }))
  };
  // Y el aeropuerto para la barra de rutas.
  const aeropuerto = {
    saleDe: sanMartin,
    desde: { href: `${ALTA_AEROPUERTO}&sentido=ARRIVAL`, detalle: "Llegadas: lo buscamos en el aeropuerto" },
    hacia: { href: `${ALTA_AEROPUERTO}&sentido=DEPARTURE`, detalle: "Salidas: lo llevamos al aeropuerto" }
  };

  return (
    <AdminShell title="Reservar" eyebrow="Nueva reserva" notice={params.notice} role={user.role}>
      <section className="admin-section alta-pagina">
        {recorrido ? (
          salidas.length || rutas.length ? (
            // La clave remonta el formulario al cambiar de recorrido: arranca limpio en ese viaje.
            <NuevaReservaForm
              key={`${recorrido.origen}→${recorrido.destino}`}
              schedules={salidas}
              rutas={rutas}
              inicio={recorrido}
              aeropuerto={aeropuerto}
            />
          ) : <p className="muted">No hay salidas futuras con lugares disponibles.</p>
        ) : (
          <AeropuertoAlta
            date={params.date}
            tramos={params.tramos}
            sentido={params.sentido}
            abrir={params.abrir}
            // Por defecto, San Martín → Aeropuerto Chapelco (19-nov).
            sentidoPorDefecto="DEPARTURE"
            vuelo={params.vuelo}
            lugaresExtra={lugaresExtra}
          />
        )}
      </section>
    </AdminShell>
  );
}

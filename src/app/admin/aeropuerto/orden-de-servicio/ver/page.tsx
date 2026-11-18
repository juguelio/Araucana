import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { idDeLaOrden, ServiceOrderSheet } from "@/components/service-order-sheet";
import { OrdenAcciones } from "@/components/orden-acciones";
import { RecorridoEditable } from "@/components/recorrido-editable";
import { getAirportServiceOrderReservations } from "@/lib/airport/service-order-repository";
import {
  buildServiceOrderBlocks,
  filtrarPorNave,
  referenciaDeLaOrden,
  SERVICE_ORDER_COLUMNS,
  serviceOrderRow,
  type ServiceOrderBlock
} from "@/lib/airport/service-order";
import { linkDeLaOrden, rutaDeAsignacion } from "@/lib/airport/service-order-link";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Orden de servicio · La Araucana Viajes",
  robots: { index: false, follow: false }
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type VerOrdenPageProps = {
  searchParams?: Promise<{ date?: string; flight?: string; vehicle?: string }>;
};

/** Hoy en San Martín de los Andes, como `YYYY-MM-DD` (mismo criterio que la descarga del .xlsx). */
function diaDeHoy() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta" }).format(new Date());
}

/**
 * Las órdenes de servicio del día en pantalla: la misma hoja que se baja en .xlsx, con las mismas
 * columnas (issue #118). Hay una orden por vuelo, y una por nave cuando el vuelo sale con más de una.
 *
 * Cada orden se imprime, se descarga y se comparte con el chofer por separado, y su recorrida se
 * ordena arrastrando las filas: lo que queda acá es lo que recibe el chofer.
 */
export default async function VerOrdenDeServicioPage({ searchParams }: VerOrdenPageProps) {
  const usuario = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const date = params?.date ?? diaDeHoy();
  const flightId = params?.flight || null;
  const vehicle = (flightId && params?.vehicle) || null;

  if (!DATE_PATTERN.test(date)) {
    notFound();
  }

  const blocks = filtrarPorNave(
    buildServiceOrderBlocks(await getAirportServiceOrderReservations(date, flightId), { incluirVacias: true }),
    vehicle
  );
  const cabeceras = await headers();
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "localhost:3000";
  const protocolo =
    cabeceras.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const origen = `${protocolo}://${host}`;

  // Las naves de cada vuelo, para pasar un pasajero de una a otra desde cualquier orden del vuelo.
  const navesPorVuelo = new Map<string, Array<{ assignmentId: string; name: string }>>();
  for (const block of blocks) {
    if (!block.flightId || !block.vehicle || block.vehicleCount < 2) continue;
    const naves = navesPorVuelo.get(block.flightId) ?? [];
    naves.push({ assignmentId: block.vehicle.assignmentId, name: block.vehicle.name });
    navesPorVuelo.set(block.flightId, naves);
  }

  function acciones(block: ServiceOrderBlock) {
    const ref = referenciaDeLaOrden(block);
    const query = ref.flight
      ? new URLSearchParams({ date, flight: ref.flight, ...(ref.vehicle ? { vehicle: ref.vehicle } : {}) })
      : null;
    const codes = block.passengers.map((pasajero) => pasajero.code);
    return (
      <OrdenAcciones
        ordenId={idDeLaOrden(block)}
        excelHref={query && codes.length ? `/admin/aeropuerto/orden-de-servicio?${query}` : null}
        link={ref.flight && codes.length ? linkDeLaOrden(origen, date, ref.flight, ref.vehicle) : null}
        restablecer={block.manualOrder && block.flightId ? { date, flightId: block.flightId, codes } : null}
      />
    );
  }

  function filas(block: ServiceOrderBlock) {
    if (!block.flightId) return undefined;
    return (
      <RecorridoEditable
        key={block.key}
        date={date}
        flightId={block.flightId}
        assignmentId={block.vehicle?.assignmentId ?? null}
        editable={!(block.vehicleCount > 1 && !block.vehicle)}
        naves={navesPorVuelo.get(block.flightId) ?? []}
        columnas={SERVICE_ORDER_COLUMNS}
        filas={block.passengers.map((pasajero) => ({ code: pasajero.code, celdas: serviceOrderRow(pasajero) }))}
      />
    );
  }

  return (
    <AdminShell
      title="Orden de servicio"
      eyebrow="Operación"
      role={usuario.role}
      action={
        <div className="form-actions no-print">
          {/* Nave y chofer se asignan en un solo lugar, para todas las áreas: la orden lleva ahí con
              su fecha ya puesta, en vez de obligar a buscarla de nuevo en el panel (#248). */}
          <Link className="ghost-button" href={rutaDeAsignacion(date)}>Asignar naves y choferes</Link>
          <Link className="ghost-button" href={`/admin/aeropuerto?date=${encodeURIComponent(date)}`}>Volver a aeropuerto</Link>
        </div>
      }
    >
      <p className="orden-ayuda no-print">
        Cada orden se imprime, se descarga y se manda al chofer por separado. Arrastrá las filas (o usá las flechas)
        para ordenar la recorrida; si el vuelo sale con más de una nave, pasá pasajeros de una a otra arrastrándolos o
        con «Nave». Los cambios se guardan solos.
      </p>
      <ServiceOrderSheet
        date={date}
        blocks={blocks}
        variante="panel"
        accionesDeOrden={acciones}
        filasDeOrden={filas}
      />
    </AdminShell>
  );
}

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
  ordenesDelVuelo,
  referenciaDeLaOrden,
  SERVICE_ORDER_COLUMNS,
  serviceOrderRow,
  type ServiceOrderBlock
} from "@/lib/airport/service-order";
import { linkDeLaOrden } from "@/lib/airport/service-order-link";
import { vuelosDeLaHoja } from "@/lib/airport/flight-selection";
import { ImprimirTodas } from "@/components/imprimir-todas";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { CombiDelVueloModal, INCLUDE_COMBIS_DEL_VUELO, nombreDeChofer, opcionesDeCombi } from "../../combi-modal";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Orden de servicio · La Araucana Viajes",
  robots: { index: false, follow: false }
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type VerOrdenPageProps = {
  searchParams?: Promise<{ date?: string; flight?: string; flights?: string; vehicle?: string; notice?: string; imprimir?: string }>;
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

  // Varios vuelos marcados en Aeropuerto: sus órdenes juntas, para imprimirlas de una vez.
  const flightIdsPedidos = flightId ? [] : vuelosDeLaHoja(params?.flights);
  const todas = filtrarPorNave(
    ordenesDelVuelo(buildServiceOrderBlocks(await getAirportServiceOrderReservations(date, flightId), { incluirVacias: true }), flightId),
    vehicle
  );
  const blocks = flightIdsPedidos.length
    ? todas.filter((block) => block.flightIds.some((id) => flightIdsPedidos.includes(id)))
    : todas;
  const cabeceras = await headers();
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "localhost:3000";
  const protocolo =
    cabeceras.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const origen = `${protocolo}://${host}`;

  // Cada orden tiene su botón «Asignar nave y chofer», que abre el mismo modal que la tarjeta del
  // vuelo en Aeropuerto y, al guardar, vuelve a esta misma orden.
  const flightIds = [...new Set(blocks.flatMap((block) => block.flightIds))];
  const [vuelos, { naves, choferes }] = await Promise.all([
    prisma.flight.findMany({ where: { id: { in: flightIds } }, include: INCLUDE_COMBIS_DEL_VUELO }),
    opcionesDeCombi()
  ]);
  const vueloPorId = new Map(vuelos.map((vuelo) => [vuelo.id, vuelo]));
  const volverAOrden = new URLSearchParams({
    date,
    ...(flightId ? { flight: flightId } : {}),
    ...(vehicle ? { vehicle } : {}),
    ...(flightIdsPedidos.length ? { flights: flightIdsPedidos.join(",") } : {})
  }).toString();

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
    // Una orden puede unir varios vuelos (misma camioneta, misma vuelta): cada uno tiene su botón.
    const vuelosDeLaOrden = block.flightIds.flatMap((id) => vueloPorId.get(id) ?? []);
    const unida = vuelosDeLaOrden.length > 1;
    return (
      <>
      {vuelosDeLaOrden.map((vuelo) => {
        // La nave de esta orden (si el vuelo sale con varias) o todas las del vuelo.
        const propias = vuelo.assignments.filter((a) => !block.vehicle || unida || a.id === block.vehicle.assignmentId);
        const prefijo = unida ? `${vuelo.number} · ` : "";
        return (
          <div className="no-print orden-asignar" key={vuelo.id}>
            <CombiDelVueloModal
              vuelo={vuelo}
              naves={naves}
              choferes={choferes}
              resetKey={params?.notice ?? ""}
              volverAOrden={volverAOrden}
              trigger={propias.length
                ? `${prefijo}Nave y chofer: ${propias.map((a) => `${a.vehicle.name} · ${a.driver ? nombreDeChofer(a.driver) : "sin chofer"}`).join(" · ")}`
                : `${prefijo}Asignar nave y chofer`}
              triggerLabel={`${vuelo.assignments.length ? "Cambiar" : "Asignar"} nave y chofer del ${vuelo.number}`}
              triggerClassName="ghost-button"
            />
          </div>
        );
      })}
      <OrdenAcciones
        ordenId={idDeLaOrden(block)}
        excelHref={query && codes.length ? `/admin/aeropuerto/orden-de-servicio?${query}` : null}
        link={ref.flight && codes.length ? linkDeLaOrden(origen, date, ref.flight, ref.vehicle) : null}
        restablecer={block.manualOrder && block.flightId ? { date, flightId: block.flightId, codes } : null}
      />
      </>
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
      notice={params?.notice}
      action={
        <div className="form-actions no-print">
          {/* Con varios vuelos marcados puede salir una sola orden (si la misma camioneta los hace juntos). */}
          {blocks.length > 1 || flightIdsPedidos.length > 1 ? (
            <ImprimirTodas cantidad={blocks.length} alAbrir={flightIdsPedidos.length > 1 && params?.imprimir === "1" && !params?.notice} />
          ) : null}
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

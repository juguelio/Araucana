import { pasajerosDeOrden } from "@/lib/driver/jornada-aeropuerto";
import { MarcasDelServicio } from "@/components/marcas-del-servicio";
import { cargarOcupacionDelDia } from "@/lib/fleet/cargar-ocupacion";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { groupAirportPair, idDeLaOrden, ServiceOrderSheet } from "@/components/service-order-sheet";
import { OrdenAcciones } from "@/components/orden-acciones";
import { RecorridoEditable } from "@/components/recorrido-editable";
import { ServiceOrderMap } from "@/components/service-order-map";
import { getAirportServiceOrder } from "@/lib/airport/service-order-data";
import {
  bloqueSinNaveAsignada,
  esOrdenElegida,
  filtrarPorNave,
  ordenesDelVuelo,
  referenciaDeLaOrden,
  SERVICE_ORDER_COLUMNS,
  serviceOrderRow,
  type ServiceOrderBlock
} from "@/lib/airport/service-order";
import { linkDeLaOrden } from "@/lib/airport/service-order-link";
import { claveDeOrden, ordenesDeLaHoja, vuelosDeLaHoja } from "@/lib/airport/flight-selection";
import { airportPrintDocuments } from "@/components/service-print-documents";
import { ServicePrintSelection } from "@/components/service-print-selection";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { CombiDelVueloModal, INCLUDE_COMBIS_DEL_VUELO, nombreDeChofer, opcionesDeCombi, vueloDeLaRecorrida } from "../../combi-modal";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Orden de servicio · La Araucana Viajes",
  robots: { index: false, follow: false }
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type VerOrdenPageProps = {
  searchParams?: Promise<{ date?: string; flight?: string; flights?: string; ordenes?: string; vehicle?: string; notice?: string }>;
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
  // Órdenes puntuales elegidas en «Hoja del chofer»: en una recorrida con varias combis, la de cada combi.
  const ordenesPedidas = flightId ? [] : ordenesDeLaHoja(params?.ordenes);
  const { blocks: ordenesDelDia, oficina } = await getAirportServiceOrder(date, flightId, { incluirVacias: true });
  const todas = filtrarPorNave(
    ordenesDelVuelo(ordenesDelDia, flightId),
    vehicle
  );
  const blocks = ordenesPedidas.length
    ? todas.filter((block) => esOrdenElegida(block, ordenesPedidas))
    : flightIdsPedidos.length
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
  const [vuelos, { naves, choferes }, ocupacion, marcas] = await Promise.all([
    prisma.flight.findMany({ where: { id: { in: flightIds } }, include: INCLUDE_COMBIS_DEL_VUELO }),
    opcionesDeCombi(),
    // Qué naves y choferes están en otro servicio ese día, para marcarlos en el modal.
    cargarOcupacionDelDia(date),
    prisma.driverServiceMark.findMany({ where: { servicioId: { in: blocks.map(b => "orden-" + b.key) } } })
  ]);
  const vueloPorId = new Map(vuelos.map((vuelo) => [vuelo.id, vuelo]));
  const volverAOrden = new URLSearchParams({
    date,
    ...(flightId ? { flight: flightId } : {}),
    ...(vehicle ? { vehicle } : {}),
    ...(flightIdsPedidos.length ? { flights: flightIdsPedidos.join(",") } : {}),
    ...(ordenesPedidas.length ? { ordenes: ordenesPedidas.map(claveDeOrden).join(",") } : {})
  }).toString();

  // Las naves de cada vuelo, para pasar un pasajero de una a otra desde cualquier orden del vuelo.
  const navesPorVuelo = new Map<string, Array<{ assignmentId: string; name: string }>>();
  for (const block of blocks) {
    if (block.privateOrderId || !block.flightId || !block.vehicle || block.vehicleCount < 2) continue;
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
    // Una orden puede unir varios vuelos (una recorrida): un solo botón con la nave y el chofer de ESTA
    // orden, que abre las combis de toda la recorrida. Cada orden es una camioneta, no un vuelo.
    const vuelosDeLaOrden = block.flightIds.flatMap((id) => vueloPorId.get(id) ?? []);
    const [principal, ...otros] = vuelosDeLaOrden;
    const recorrida = principal ? vueloDeLaRecorrida(principal, otros) : null;
    const vuelo = recorrida && {
      ...recorrida,
      assignments: recorrida.assignments.filter(a => !a.privateReservationId),
      reservations: recorrida.reservations.filter(r => !r.isPrivate)
    };
    // La nave de esta orden; si el vuelo sale con una sola (o con ninguna), la que tenga.
    const propias = vuelo
      ? block.vehicle
        ? vuelo.assignments.filter((a) => a.vehicleId === block.vehicle!.vehicleId)
        : bloqueSinNaveAsignada(block) ? [] : vuelo.assignments
      : [];
    return (
      <>
      {block.privateOrderId ? (
        <Link className="ghost-button no-print" href={`/admin/aeropuerto?date=${date}#vuelo-${block.flightId}`}>Administrar naves y choferes</Link>
      ) : vuelo ? (
        <div className="no-print orden-asignar">
          <CombiDelVueloModal
            vuelo={vuelo}
            naves={naves.filter(n => !recorrida?.assignments.some(a => a.privateReservationId && a.vehicleId === n.id))}
            choferes={choferes}
            resetKey={params?.notice ?? ""}
            volverAOrden={volverAOrden}
            ocupacion={ocupacion}
            recorrida={otros.map((otro) => otro.number)}
            trigger={propias.length
              ? `Nave y chofer: ${propias.map((a) => `${a.vehicle.name} · ${a.driver ? nombreDeChofer(a.driver) : "sin chofer"}`).join(" · ")}`
              : bloqueSinNaveAsignada(block) ? "Pasajeros sin nave: asignar otra nave" : "Asignar nave y chofer"}
            triggerLabel={`${vuelo.assignments.length ? "Cambiar" : "Asignar"} nave y chofer del ${vuelosDeLaOrden.map((item) => item.number).join(" + ")}`}
            triggerClassName="ghost-button"
          />
        </div>
      ) : null}
      <OrdenAcciones
        ordenId={idDeLaOrden(block)}
        excelHref={query && codes.length ? `/admin/aeropuerto/orden-de-servicio?${query}` : null}
        link={ref.flight && codes.length ? linkDeLaOrden(origen, date, ref.flight, ref.vehicle) : null}
        restablecer={block.manualOrder && block.flightId ? { date, flightId: block.flightId, codes } : null}
      />
      </>
    );
  }

  // «Visualizar recorrido»: el mapa de las paradas de la orden, en el orden de la hoja.
  function mapa(block: ServiceOrderBlock) {
    return <><ServiceOrderMap block={block} oficina={oficina} />
      <MarcasDelServicio filas={pasajerosDeOrden(block).filas} marcas={marcas.filter(m => m.servicioId === "orden-" + block.key)} /></>;
  }

  function filas(block: ServiceOrderBlock) {
    if (!block.flightId || block.privateOrderId) return undefined;
    return (
      <RecorridoEditable
        key={block.key}
        date={date}
        flightId={block.flightId}
        assignmentId={block.vehicle?.assignmentId ?? null}
        editable={!bloqueSinNaveAsignada(block)}
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
          <Link className="ghost-button" href={`/admin/aeropuerto?date=${encodeURIComponent(date)}`}>Volver a aeropuerto</Link>
        </div>
      }
    >
      <p className="orden-ayuda no-print">
        Seleccioná las órdenes para imprimir. Arrastrá las filas (o usá las flechas)
        para ordenar la recorrida; si el vuelo sale con más de una nave, pasá pasajeros de una a otra arrastrándolos o
        con «Nave». Los cambios se guardan solos.
      </p>
      <ServicePrintSelection key={JSON.stringify([date, blocks.map(({ key }) => key)])}
        documents={airportPrintDocuments(date, blocks)} defaultGrouped={groupAirportPair(blocks)}>
        <ServiceOrderSheet
          date={date}
          blocks={blocks}
          variante="panel"
          accionesDeOrden={acciones}
          filasDeOrden={filas}
          pieDeOrden={mapa}
        />
      </ServicePrintSelection>
    </AdminShell>
  );
}

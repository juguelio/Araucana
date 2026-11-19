import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { idDeLaOrden, ServiceOrderSheet } from "@/components/service-order-sheet";
import { OrdenAcciones } from "@/components/orden-acciones";
import { RecorridoEditable } from "@/components/recorrido-editable";
import { VerRecorrido } from "@/components/recorrido-mapa";
import { getAirportServiceOrderReservations } from "@/lib/airport/service-order-repository";
import {
  buildServiceOrderBlocks,
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
import { ImprimirTodas } from "@/components/imprimir-todas";
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
  searchParams?: Promise<{ date?: string; flight?: string; flights?: string; ordenes?: string; vehicle?: string; vehicleId?: string; driverId?: string; notice?: string; imprimir?: string }>;
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
  const { vehicleId, driverId } = params ?? {};
  const porEquipo = vehicleId !== undefined || driverId !== undefined;

  if (!DATE_PATTERN.test(date)) {
    notFound();
  }

  // Varios vuelos marcados en Aeropuerto: sus órdenes juntas, para imprimirlas de una vez.
  const flightIdsPedidos = flightId ? [] : vuelosDeLaHoja(params?.flights);
  // Órdenes puntuales elegidas en «Hoja del chofer»: en una recorrida con varias combis, la de cada combi.
  const ordenesPedidas = flightId ? [] : ordenesDeLaHoja(params?.ordenes);
  const todas = filtrarPorNave(
    ordenesDelVuelo(buildServiceOrderBlocks(await getAirportServiceOrderReservations(date, flightId), { incluirVacias: true }), flightId),
    vehicle
  );
  const seleccion = ordenesPedidas.length
    ? todas.filter((block) => esOrdenElegida(block, ordenesPedidas))
    : flightIdsPedidos.length
      ? todas.filter((block) => block.flightIds.some((id) => flightIdsPedidos.includes(id)))
      : todas;
  // Una recorrida puede repartir gente de varios vuelos. El filtro se aplica a las órdenes ya repartidas.
  const blocks = porEquipo ? seleccion.filter(({ vehicle: nave, passengers }) =>
    passengers.length > 0 && nave && (vehicleId === undefined || nave.vehicleId === vehicleId) &&
    (driverId === undefined || nave.driverId === driverId)
  ) : seleccion;
  const variasPedidas = flightIdsPedidos.length > 1 || ordenesPedidas.length > 1;
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
  const nombreEquipo = vehicleId !== undefined
    ? naves.find(nave => nave.id === vehicleId)?.name ?? blocks[0]?.vehicle?.name ?? "Nave seleccionada"
    : choferes.find(chofer => chofer.id === driverId)?.label ?? blocks[0]?.vehicle?.driver ?? "Chofer seleccionado";
  const volverAOrden = new URLSearchParams({
    date,
    ...(flightId ? { flight: flightId } : {}),
    ...(vehicle ? { vehicle } : {}),
    ...(vehicleId !== undefined ? { vehicleId } : {}),
    ...(driverId !== undefined ? { driverId } : {}),
    ...(flightIdsPedidos.length ? { flights: flightIdsPedidos.join(",") } : {}),
    ...(ordenesPedidas.length ? { ordenes: ordenesPedidas.map(claveDeOrden).join(",") } : {})
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
    // Una orden puede unir varios vuelos (una recorrida): un solo botón con la nave y el chofer de ESTA
    // orden, que abre las combis de toda la recorrida. Cada orden es una camioneta, no un vuelo.
    const vuelosDeLaOrden = block.flightIds.flatMap((id) => vueloPorId.get(id) ?? []);
    const [principal, ...otros] = vuelosDeLaOrden;
    const vuelo = principal ? vueloDeLaRecorrida(principal, otros) : null;
    // La nave de esta orden; si el vuelo sale con una sola (o con ninguna), la que tenga.
    const propias = vuelo
      ? block.vehicle
        ? vuelo.assignments.filter((a) => a.vehicleId === block.vehicle!.vehicleId)
        : block.vehicleCount > 1 ? [] : vuelo.assignments
      : [];
    return (
      <>
      {vuelo ? (
        <div className="no-print orden-asignar">
          <CombiDelVueloModal
            vuelo={vuelo}
            naves={naves}
            choferes={choferes}
            resetKey={params?.notice ?? ""}
            volverAOrden={volverAOrden}
            recorrida={otros.map((otro) => otro.number)}
            trigger={propias.length
              ? `Nave y chofer: ${propias.map((a) => `${a.vehicle.name} · ${a.driver ? nombreDeChofer(a.driver) : "sin chofer"}`).join(" · ")}`
              : block.vehicleCount > 1 ? "Pasajeros sin nave: asignar otra nave" : "Asignar nave y chofer"}
            triggerLabel={`${vuelo.assignments.length ? "Cambiar" : "Asignar"} nave y chofer del ${vuelosDeLaOrden.map((item) => item.number).join(" + ")}`}
            triggerClassName="ghost-button"
          />
          {porEquipo && block.vehicleCount > 1 && block.flightId && (
            <Link className="ghost-button" href={{ pathname: "/admin/aeropuerto/orden-de-servicio/ver", query: { date, flight: block.flightId } }}>
              Ver todas las naves de la recorrida
            </Link>
          )}
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
    if (!block.passengers.length) return null;
    return (
      <VerRecorrido
        key={`mapa-${block.key}`}
        sentido={block.direction}
        titulo={[block.flightNumber, block.vehicle?.name].filter(Boolean).join(" · ")}
        paradas={block.passengers.map((pasajero, indice) => ({
          code: pasajero.code,
          numero: indice + 1,
          nombre: pasajero.name,
          lugar: pasajero.lodging,
          pasajeros: pasajero.seats,
          punto: pasajero.pickup
        }))}
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
      title={porEquipo ? `Órdenes de aeropuerto · ${nombreEquipo}` : "Orden de servicio"}
      eyebrow="Operación"
      role={usuario.role}
      notice={params?.notice}
      action={
        <div className="form-actions no-print">
          {/* Con varios vuelos marcados puede salir una sola orden (si la misma camioneta los hace juntos). */}
          {blocks.length > 1 || variasPedidas ? (
            <ImprimirTodas cantidad={blocks.length} alAbrir={variasPedidas && params?.imprimir === "1" && !params?.notice} />
          ) : null}
          {porEquipo
            ? <Link className="ghost-button" href={`/admin?date=${encodeURIComponent(date)}`}>Volver al panel</Link>
            : <Link className="ghost-button" href={`/admin/aeropuerto?date=${encodeURIComponent(date)}`}>Volver a aeropuerto</Link>}
        </div>
      }
    >
      {porEquipo && !blocks.length ? (
        <p className="plain-card">Sin órdenes de aeropuerto con pasajeros para {nombreEquipo} en esta fecha.</p>
      ) : (
        <>
          <p className="orden-ayuda no-print">
            {porEquipo
              ? "Cada orden incluye los pasajeros y el mapa de su recorrida. Si necesitás pasar pasajeros entre naves, abrí todas las naves de esa recorrida."
              : "Cada orden se imprime, se descarga y se manda al chofer por separado. Arrastrá las filas (o usá las flechas) para ordenar la recorrida. Si el vuelo sale con más de una nave, pasá pasajeros de una a otra arrastrándolos o con «Nave». Los cambios se guardan solos."}
          </p>
          <ServiceOrderSheet
            date={date}
            blocks={blocks}
            variante="panel"
            accionesDeOrden={acciones}
            filasDeOrden={filas}
            pieDeOrden={mapa}
          />
        </>
      )}
    </AdminShell>
  );
}

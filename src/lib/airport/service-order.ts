import { isPaihuen, paihuenPickupTime, PAIHUEN_POINT } from "./paihuen";
/**
 * Orden de servicio del aeropuerto: la hoja que se le entrega al chofer.
 *
 * El cliente la usa hoy en papel y pidió que el sistema devuelva lo mismo (foto del 2026-11-12,
 * issue #74): encabezado con la fecha, un bloque por vuelo —`OUT 1671` para las partidas y
 * `Llega 1670` para los arribos— y una fila por reserva con
 * `Pasajero · Cant · DNI · Alojamiento · Derivado por · Pago · Contacto · Forma de pago`, con el total al pie de
 * cada bloque y el total del día al final.
 *
 * Reglas que importan más acá que el formato:
 *
 * - **El dato del chofer es la dirección, no el nombre del hotel.** Se usa `pickupName` (el lugar
 *   que eligió el pasajero) y `pickupAddress` (la referencia que escribió para el chofer): en las
 *   partidas es de dónde se lo busca, en los arribos es a dónde se lo lleva.
 * - **«Derivado por» sale del dato que carga el panel** (`Reservation.referredBy`, issue #109). Si
 *   la reserva se vendió directo la celda va vacía: no se deduce del pago ni se inventa.
 * - **Pago** se arma con el importe y el estado del pago de la reserva (`Cobrar` / `Pagado`), no
 *   con una etiqueta suelta: el chofer cobra contra ese monto.
 */
import ExcelJS from "exceljs";
import type { PrivateStop } from "./private-transfer";
import { airportPickupStart } from "./pickup-start";
import { horaEfectivaDelVuelo } from "./effective-time";
import { repartirPorZonas } from "./fleet-split";
import { AEROPUERTO_CHAPELCO, optimizarEntreExtremos, ordenarPorRecorrido, whatsappLink, type PickupCoords } from "./route-order";
import { ORDER_LOGO_PNG_BASE64 } from "./service-order-logo";

export type ServiceOrderDirection = "ARRIVAL" | "DEPARTURE";

/** Lo mínimo que necesita la hoja; no depende de Prisma para poder testearse sin base. */
export type ServiceOrderReservationInput = {
  privateOrderId?: string | null;
  privateStops?: PrivateStop[];
  code: string;
  /** Quién derivó la venta (agencia, voucher). `null` cuando se vendió directo. */
  referredBy?: string | null;
  totalCents: number;
  currency: string;
  passengerCount: number;
  paymentStatus: string | null;
  paymentMethod?: string | null;
  direction: string;
  flightNumber: string;
  pickupName: string | null;
  pickupAddress: string | null;
  pickupNotes: string | null;
  /** Coordenadas del retiro; sin ellas el pasajero va al final del recorrido. */
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  /** Nave elegida a mano (id de la asignación del vuelo). `null` = la reparte la orden. */
  assignmentId?: string | null;
  /** Lugar en la recorrida ordenado a mano. `null` = orden sugerido. */
  routePosition?: number | null;
  passenger: {
    firstName: string;
    lastName: string;
    phone: string;
    documentType: string;
    documentId: string;
  };
  flight: {
    id: string;
    number: string;
    airline: string | null;
    direction: string;
    scheduledAt: Date;
    estimatedAt: Date | null;
    pickupStartInitialAt?: Date | null;
    pickupStartOverrideAt: Date | null;
    /** Vuelos que hace la misma camioneta en la misma vuelta: la hoja los une en una orden. */
    pickupGroupId?: string | null;
    /** Naves asignadas al vuelo, en el orden en que se asignaron. */
    vehicles?: ServiceOrderVehicle[];
  } | null;
};

/** Una nave asignada a un vuelo: lo que la orden necesita para repartir y rotular. */
export type ServiceOrderVehicle = {
  /** Id de la asignación nave↔vuelo: identifica la orden de esa nave. */
  assignmentId: string;
  vehicleId: string;
  name: string;
  /** Asientos de la nave. 0 = sin plano cargado: no se sabe la capacidad. */
  seats: number;
  driver: string | null;
  /** Id del chofer, para asignarle el mismo a otro tramo (hoja IN/OUT). */
  driverId?: string | null;
};

/** Rótulo de la orden de los pasajeros que no entraron en ninguna nave del vuelo. */
export const SIN_NAVE = "sin-nave";

export type ServiceOrderPassenger = {
  code: string;
  name: string;
  seats: number;
  document: string;
  lodging: string;
  lodgingDetail: string | null;
  pickupNotes?: string | null;
  /** Quién derivó la venta; `null` cuando la reserva se vendió directo. */
  referredBy: string | null;
  payment: string;
  paymentMethod: string | null;
  amountCents: number;
  currency: string;
  contact: string;
  /** Punto de retiro, para ordenar la recorrida del día. */
  pickup: { latitude: number; longitude: number } | null;
  /** Lugar ordenado a mano en la recorrida; `null` si sigue el orden sugerido. */
  routePosition: number | null;
  /** Nave elegida a mano; `null` si la repartió la orden. */
  assignmentId: string | null;
};

export type ServiceOrderBlock = {
  privateOrderId?: string | null;
  scopedVehicle?: boolean;
  /** Vuelo + nave: una orden por nave cuando el vuelo sale con más de una. */
  key: string;
  /** Id del vuelo cargado; `null` cuando la reserva no está atada a un vuelo del sistema. En una orden
   *  que une varios vuelos (misma camioneta, misma vuelta) es el primero, y la URL de cualquiera de
   *  ellos trae la orden unida. */
  flightId: string | null;
  /** Todos los vuelos de la orden: uno, o varios si la camioneta los hace en la misma vuelta. */
  flightIds: string[];
  /** Número y hora de cada vuelo de la orden, para el rótulo. */
  flights: Array<{ id: string; number: string; flightAt: Date; scheduledAt: Date }>;
  /** La nave de esta orden. `null` = el vuelo no tiene nave, o es el sobrante que no entró en ninguna. */
  vehicle: ServiceOrderVehicle | null;
  /** Cuántas naves tiene el vuelo: con dos o más, la orden se parte por nave. */
  vehicleCount: number;
  /** Algún pasajero de la orden tiene el lugar fijado a mano. */
  manualOrder: boolean;
  direction: ServiceOrderDirection;
  flightNumber: string;
  airline: string | null;
  /** `OUT` en las partidas, `Llega` en los arribos: el rótulo de la hoja en papel. */
  heading: string;
  /** Cuándo arranca la recorrida (partidas) o cuándo llega el vuelo (arribos). */
  operationAt: Date;
  /** Hora programada del vuelo. */
  scheduledAt: Date;
  /** Hora que manda para el chofer: el despegue programado o la llegada estimada si la hay. */
  flightAt: Date;
  estimatedAt: Date | null;
  passengers: ServiceOrderPassenger[];
  totalCents: number;
};

const SALTA_TIME = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Salta"
});

export const horaEnSalta = (value: Date) => SALTA_TIME.format(value);

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * «Jueves 10-feb»: la fecha tal como la escribe el cliente en la planilla.
 * La fecha del servicio es un día de calendario, así que se lee en UTC: pasarla por la zona
 * argentina (UTC−3) la corre al día anterior.
 */
export function fechaDeLaOrden(date: string) {
  const valor = new Date(`${date}T12:00:00.000Z`);
  return `${DIAS[valor.getUTCDay()]} ${String(valor.getUTCDate()).padStart(2, "0")}-${MESES[valor.getUTCMonth()]}`;
}

export function plata(cents: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(cents / 100);
}

/** Lo que el chofer lee en la columna Pago: el monto y si falta cobrarlo. */
export function paymentLabel(status: string | null, cents: number, currency = "ARS") {
  const monto = plata(cents, currency);

  if (status === "APPROVED") return `Pagado ${monto}`;
  if (status === "REJECTED") return `Rechazado ${monto}`;
  return `Cobrar ${monto}`;
}

/** El DNI se imprime solo; pasaporte o cédula se aclaran para que no se confundan con un DNI. */
export function documentoDelPasajero(documentType: string, documentId: string) {
  const tipo = documentType.trim().toUpperCase();
  const numero = documentId.trim();
  return tipo === "DNI" || !tipo ? numero : `${tipo} ${numero}`;
}

/**
 * El buscador devuelve la dirección con toda la cola administrativa
 * («…, Municipio de San Martín de los Andes, Departamento Lácar, Neuquén, 8370, Argentina»).
 * En la hoja del chofer eso es ruido: se corta en el municipio o el departamento, y si no hay,
 * se saca el país y el código postal que lo precede. El número de la altura no se toca: «1242»
 * parece un código postal y es la altura de la calle.
 */
const PROVINCIAS = new Set([
  "neuquén",
  "neuquen",
  "río negro",
  "rio negro",
  "chubut",
  "argentina",
  "lácar",
  "lacar"
]);

export function recortarDireccion(valor: string) {
  const partes = valor
    .split(",")
    .map((parte) => parte.trim())
    .filter(Boolean);

  let corte = partes.findIndex((parte) =>
    /^(municipio|departamento|provincia|comuna)\b/i.test(parte) || PROVINCIAS.has(parte.toLowerCase())
  );

  if (corte === -1) {
    const argentina = partes.findIndex((parte) => /^argentina$/i.test(parte));
    if (argentina !== -1) {
      corte = argentina;
      if (corte > 0 && /^\d{4}$/.test(partes[corte - 1])) corte -= 1;
    }
  }

  const utiles = corte === -1 ? partes : partes.slice(0, corte);

  return (utiles.length ? utiles.join(", ") : valor).trim();
}

/**
 * Alojamiento: el lugar («Patagonia Plaza») y abajo la dirección o el detalle que sirve para
 * llegar. Si sólo hay uno de los dos, ese.
 */
export function alojamientoDelPasajero(pickupName: string | null, pickupAddress: string | null) {
  const lugar = pickupName?.trim() ? recortarDireccion(pickupName.trim()) : null;
  const direccion = pickupAddress?.trim() ? recortarDireccion(pickupAddress.trim()) : null;

  if (lugar && direccion && lugar !== direccion) {
    return { lodging: lugar, lodgingDetail: direccion };
  }

  return { lodging: lugar ?? direccion ?? "—", lodgingDetail: null };
}

const direccionDelVuelo = (value: string): ServiceOrderDirection =>
  value === "ARRIVAL" ? "ARRIVAL" : "DEPARTURE";

type GrupoDeVuelo = Omit<ServiceOrderBlock, "key" | "vehicle" | "manualOrder"> & {
  flightKey: string;
  vehicles: ServiceOrderVehicle[];
  pickupGroupId: string | null;
};

/**
 * Une en una sola orden los vuelos que se hacen en la misma vuelta (`pickupGroupId`), del mismo sentido.
 * Si la vuelta sale con más de una nave (dos vuelos llenos, dos trafics) los pasajeros de todos los vuelos
 * se juntan y después se reparten por zona entre las naves (`repartirEnNaves`): cada nave sale con su
 * orden, con gente de cualquiera de los vuelos. Cada pasajero lleva el número de su vuelo junto al nombre,
 * así el chofer sabe a qué vuelo va (o de cuál baja).
 *
 * Una nave se identifica por `vehicleId`: la asignación nave↔vuelo es una por vuelo, así que la misma
 * trafic tiene un id de asignación en cada vuelo del grupo. La orden usa el del primer vuelo que la tiene
 * y la nave elegida a mano para cada pasajero (el id de su propio vuelo) se traduce a ese.
 */
function unirVuelosCoordinados(grupos: Map<string, GrupoDeVuelo>) {
  const porGrupo = new Map<string, GrupoDeVuelo[]>();
  for (const grupo of grupos.values()) {
    if (!grupo.pickupGroupId || !grupo.flightId) continue;
    porGrupo.set(grupo.pickupGroupId, [...(porGrupo.get(grupo.pickupGroupId) ?? []), grupo]);
  }

  for (const [pickupGroupId, miembros] of porGrupo) {
    if (miembros.length < 2) continue;
    if (new Set(miembros.map((miembro) => miembro.direction)).size > 1) continue;

    const ordenados = [...miembros].sort((a, b) => a.flightAt.getTime() - b.flightAt.getTime());
    const primero = ordenados[0];
    // Las naves y su id salen del horario programado, no del estimado: una demora que da vuelta el orden de
    // los vuelos no puede cambiarle la zona ni el link a ningún chofer.
    const porProgramado = [...miembros].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || (a.flightId ?? "").localeCompare(b.flightId ?? ""));
    const vehicles: ServiceOrderVehicle[] = [];
    for (const nave of porProgramado.flatMap((miembro) => miembro.vehicles)) {
      if (!vehicles.some((unida) => unida.vehicleId === nave.vehicleId)) vehicles.push(nave);
    }
    const asignacionUnida = new Map(
      porProgramado.flatMap((miembro) => miembro.vehicles).map((nave) => [
        nave.assignmentId,
        vehicles.find((unida) => unida.vehicleId === nave.vehicleId)?.assignmentId ?? null
      ])
    );
    const unido: GrupoDeVuelo = {
      ...primero,
      flightKey: `grupo:${pickupGroupId}`,
      flightIds: ordenados.flatMap((miembro) => miembro.flightIds),
      flights: ordenados.flatMap((miembro) => miembro.flights),
      vehicles,
      vehicleCount: vehicles.length,
      flightNumber: ordenados.map((miembro) => miembro.flightNumber).join(" + "),
      operationAt: new Date(Math.min(...ordenados.map((miembro) => miembro.operationAt.getTime()))),
      passengers: ordenados.flatMap((miembro) =>
        miembro.passengers.map((pasajero) => ({
          ...pasajero,
          name: `${pasajero.name} · ${miembro.flightNumber}`,
          assignmentId: pasajero.assignmentId ? asignacionUnida.get(pasajero.assignmentId) ?? null : null
        }))
      )
    };
    for (const miembro of miembros) grupos.delete(miembro.flightKey);
    grupos.set(unido.flightKey, unido);
  }
}

const lugaresDe = (pasajeros: ServiceOrderPassenger[]) => pasajeros.reduce((total, p) => total + p.seats, 0);
export function retiroPaihuen(p: ServiceOrderPassenger) {
  return isPaihuen(p.lodging, p.lodgingDetail, p.pickup ? [p.pickup.latitude, p.pickup.longitude] : null);
}

const totalDe = (pasajeros: ServiceOrderPassenger[]) => pasajeros.reduce((total, p) => total + p.amountCents, 0);

/**
 * El orden de la recorrida de un vuelo: primero los que el operador ordenó a mano, en ese orden; después
 * el resto en el orden sugerido (`ordenarPorRecorrido`). Así una reserva nueva cae al final de lo que ya
 * se acomodó, en vez de desarmarlo.
 *
 * En las partidas se minimiza el camino oficina → retiros → aeropuerto. Si ya hay un orden manual,
 * se conserva y se optimiza sólo lo nuevo desde el último punto fijado. Sin oficina configurada se
 * mantiene el sugerido anterior (cercanía desde el aeropuerto, invertido). Los no ubicados van al final.
 */
export function ordenDeLaRecorrida(
  pasajeros: ServiceOrderPassenger[],
  direction: ServiceOrderDirection = "ARRIVAL",
  oficina: PickupCoords | null = null
): ServiceOrderPassenger[] {
  const paihuen = pasajeros.filter(retiroPaihuen);
  const resto = paihuen.length ? pasajeros.filter(p => !retiroPaihuen(p)) : pasajeros;
  if (direction === "DEPARTURE" && paihuen.length) {
    const origen = paihuen[0].pickup ?? { latitude: PAIHUEN_POINT[0], longitude: PAIHUEN_POINT[1] };
    return [...paihuen, ...ordenarResto(resto, direction, origen)];
  }
  return [...ordenarResto(resto, direction, oficina), ...paihuen];
}

function ordenarResto(pasajeros: ServiceOrderPassenger[], direction: ServiceOrderDirection, oficina: PickupCoords | null) {
  const fijados = pasajeros
    .map((pasajero, indice) => ({ pasajero, indice }))
    .filter(({ pasajero }) => pasajero.routePosition !== null)
    .sort((a, b) => (a.pasajero.routePosition as number) - (b.pasajero.routePosition as number) || a.indice - b.indice)
    .map(({ pasajero }) => pasajero);
  const pendientes = pasajeros.filter((pasajero) => pasajero.routePosition === null);
  if (direction === "DEPARTURE" && oficina) {
    const origen = [...fijados].reverse().find((pasajero) => pasajero.pickup)?.pickup ?? oficina;
    return [...fijados, ...optimizarEntreExtremos(pendientes, (pasajero) => pasajero.pickup, origen, AEROPUERTO_CHAPELCO)];
  }
  const sugeridos = ordenarPorRecorrido(
    pendientes,
    (pasajero) => pasajero.pickup
  );
  if (direction !== "DEPARTURE") return [...fijados, ...sugeridos];
  const ubicados = sugeridos.filter((pasajero) => pasajero.pickup);
  const sinUbicacion = sugeridos.filter((pasajero) => !pasajero.pickup);
  return [...fijados, ...ubicados.reverse(), ...sinUbicacion];
}

/**
 * Reparte los pasajeros de un vuelo (o de una vuelta unida) entre sus naves. Los que tienen nave elegida a
 * mano van ahí. El resto, si está ubicado en el mapa, se reparte por zona para que cada nave haga el
 * recorrido más corto posible (`repartirPorZonas`), sin pasarse de su capacidad ni partir una reserva. Los
 * que no están ubicados llenan el lugar que sobre. Lo que no entra en ninguna queda en la orden «sin nave»:
 * nunca se cae un pasajero de la hoja.
 */
export function repartirEnNaves(pasajeros: ServiceOrderPassenger[], naves: ServiceOrderVehicle[], respetarCupoFijo = false) {
  const porNave = new Map<string, ServiceOrderPassenger[]>(naves.map((nave) => [nave.assignmentId, []]));
  const sinNave: ServiceOrderPassenger[] = [];
  const libres = new Map(naves.map((nave) => [nave.assignmentId, nave.seats > 0 ? nave.seats : Number.POSITIVE_INFINITY]));
  const fijas = new Map<string, Array<{ latitude: number; longitude: number }>>(naves.map((nave) => [nave.assignmentId, []]));
  const ubicados: ServiceOrderPassenger[] = [];
  const sinUbicar: ServiceOrderPassenger[] = [];

  for (const pasajero of pasajeros) {
    const lugares = pasajero.assignmentId ? libres.get(pasajero.assignmentId) : undefined;
    if (pasajero.assignmentId && lugares !== undefined && (!respetarCupoFijo || lugares >= pasajero.seats)) {
      porNave.get(pasajero.assignmentId)?.push(pasajero);
      libres.set(pasajero.assignmentId, lugares - pasajero.seats);
      if (pasajero.pickup) fijas.get(pasajero.assignmentId)?.push(pasajero.pickup);
    } else if (pasajero.pickup) {
      ubicados.push(pasajero);
    } else {
      sinUbicar.push(pasajero);
    }
  }

  const porCodigo = new Map(ubicados.map((pasajero) => [pasajero.code, pasajero]));
  const reparto = repartirPorZonas(
    ubicados.map((pasajero) => ({ code: pasajero.code, seats: pasajero.seats, pickup: pasajero.pickup! })),
    naves.map((nave) => ({ id: nave.assignmentId, libres: Math.max(libres.get(nave.assignmentId) ?? 0, 0), fijas: fijas.get(nave.assignmentId) ?? [] }))
  );
  reparto.porNave.forEach((codigos, indice) => {
    const nave = naves[indice];
    for (const code of codigos) {
      const pasajero = porCodigo.get(code)!;
      porNave.get(nave.assignmentId)?.push(pasajero);
      libres.set(nave.assignmentId, (libres.get(nave.assignmentId) ?? 0) - pasajero.seats);
    }
  });
  const sobrantes = new Set(reparto.sobrantes);

  for (const pasajero of [...sinUbicar, ...ubicados.filter((item) => sobrantes.has(item.code))]) {
    const nave = naves.find((candidata) => (libres.get(candidata.assignmentId) ?? 0) >= pasajero.seats);
    if (!nave) {
      sinNave.push(pasajero);
      continue;
    }
    libres.set(nave.assignmentId, (libres.get(nave.assignmentId) ?? 0) - pasajero.seats);
    porNave.get(nave.assignmentId)?.push(pasajero);
  }

  return { porNave, sinNave };
}

/** Respeta las paradas privadas y sólo divide una parada si no entra entera en una nave. */
function repartirParadasPrivadas(paradas: ServiceOrderPassenger[], naves: ServiceOrderVehicle[]) {
  const porNave = new Map<string, ServiceOrderPassenger[]>();
  const sinNave: ServiceOrderPassenger[] = [];
  const unidades = naves.map(nave => {
    const pasajeros: ServiceOrderPassenger[] = [];
    porNave.set(nave.assignmentId, pasajeros);
    return { disponibles: nave.seats, pasajeros };
  });
  for (const parada of paradas) {
    let restantes = parada.seats;
    while (restantes > 0) {
      const unidad = unidades.find(u => u.disponibles >= restantes) ?? unidades.find(u => u.disponibles > 0);
      const seats = unidad ? Math.min(restantes, unidad.disponibles) : restantes;
      const fila = restantes === parada.seats ? { ...parada, seats }
        : { ...parada, seats, amountCents: 0, payment: "Incluido", paymentMethod: null };
      if (unidad) {
        unidad.pasajeros.push(fila);
        unidad.disponibles -= seats;
      } else {
        sinNave.push(fila);
      }
      restantes -= seats;
    }
  }
  return { porNave, sinNave };
}

/**
 * Agrupa las reservas del día en una orden por vuelo —o por nave, si el vuelo sale con más de una—, en
 * el orden en que los atiende la camioneta: primero la recorrida de las partidas y después los arribos.
 *
 * `incluirVacias` deja las naves que quedaron sin pasajeros: el panel las muestra para poder arrastrar
 * gente hacia ellas; el Excel y el link del chofer no.
 */
export function buildServiceOrderBlocks(
  reservations: ServiceOrderReservationInput[],
  { incluirVacias = false, oficina = null }: { incluirVacias?: boolean; oficina?: PickupCoords | null } = {}
): ServiceOrderBlock[] {
  const grupos = new Map<string, GrupoDeVuelo>();

  for (const reserva of reservations) {
    const direction = direccionDelVuelo(reserva.flight?.direction ?? reserva.direction);
    const flightKey = reserva.privateOrderId ? `privada:${reserva.privateOrderId}` : reserva.flight?.id ?? `sin-vuelo:${direction}:${reserva.flightNumber}`;
    const scheduledAt = reserva.flight?.scheduledAt ?? null;
    const estimatedAt = reserva.flight?.estimatedAt ?? null;
    // La hora del vuelo sale de la misma función que el corte de venta (issue #140).
    const vueloAt = scheduledAt ? horaEfectivaDelVuelo({ scheduledAt, estimatedAt }) : null;
    const operationAt =
      direction === "DEPARTURE"
        ? (airportPickupStart({
            direction,
            scheduledAt: scheduledAt ?? new Date(0),
            pickupStartInitialAt: reserva.flight?.pickupStartInitialAt,
            pickupStartOverrideAt: reserva.flight?.pickupStartOverrideAt ?? null
          }) ?? vueloAt ?? new Date(0))
        : (vueloAt ?? new Date(0));

    const { lodging, lodgingDetail } = alojamientoDelPasajero(reserva.pickupName, reserva.pickupAddress);

    const pasajero: ServiceOrderPassenger = {
      code: reserva.code,
      name: `${reserva.passenger.firstName} ${reserva.passenger.lastName}`.trim(),
      seats: reserva.passengerCount,
      document: documentoDelPasajero(reserva.passenger.documentType, reserva.passenger.documentId),
      lodging,
      lodgingDetail,
      ...(reserva.pickupNotes?.trim() ? { pickupNotes: reserva.pickupNotes.trim() } : {}),
      referredBy: reserva.referredBy?.trim() || null,
      payment: paymentLabel(reserva.paymentStatus, reserva.totalCents, reserva.currency),
      paymentMethod: reserva.paymentMethod?.trim() || null,
      amountCents: reserva.totalCents,
      currency: reserva.currency,
      contact: reserva.passenger.phone,
      pickup:
        typeof reserva.pickupLatitude === "number" && typeof reserva.pickupLongitude === "number"
          ? { latitude: reserva.pickupLatitude, longitude: reserva.pickupLongitude }
          : null,
      routePosition: typeof reserva.routePosition === "number" ? reserva.routePosition : null,
      assignmentId: reserva.assignmentId ?? null
    };

    const existente = grupos.get(flightKey);
    if (existente) {
      existente.passengers.push(pasajero);
      continue;
    }

    const vehicles = reserva.flight?.vehicles ?? [];
    grupos.set(flightKey, {
      flightKey,
      flightId: reserva.flight?.id ?? null,
      flightIds: reserva.flight ? [reserva.flight.id] : [],
      flights: reserva.flight
        ? [{ id: reserva.flight.id, number: reserva.flight.number, flightAt: vueloAt ?? operationAt, scheduledAt: scheduledAt ?? operationAt }]
        : [],
      privateOrderId: reserva.privateOrderId,
      pickupGroupId: reserva.privateOrderId ? null : reserva.flight?.pickupGroupId ?? null,
      vehicles,
      vehicleCount: vehicles.length,
      direction,
      flightNumber: reserva.flight?.number ?? reserva.flightNumber,
      airline: reserva.flight?.airline ?? null,
      heading: direction === "DEPARTURE" ? "OUT" : "Llega",
      operationAt,
      scheduledAt: scheduledAt ?? operationAt,
      flightAt: vueloAt ?? operationAt,
      estimatedAt,
      passengers: reserva.privateStops?.length ? reserva.privateStops.map((stop, index) => ({
        ...pasajero, seats: stop.passengers, lodging: stop.destination, lodgingDetail: null, pickup: null,
        amountCents: index === 0 ? pasajero.amountCents : 0,
        payment: index === 0 ? pasajero.payment : "Incluido",
        paymentMethod: index === 0 ? pasajero.paymentMethod : null
      })) : [pasajero],
      totalCents: 0
    });
  }

  unirVuelosCoordinados(grupos);

  const ordenes: ServiceOrderBlock[] = [];
  for (const { flightKey, vehicles, pickupGroupId: _grupo, ...grupo } of grupos.values()) {
    // La recorrida usa los extremos del traslado y respeta el orden manual. Los que no tienen
    // ubicación en el mapa van al final, sin inventar un punto para ellos.
    const recorrida = ordenDeLaRecorrida(grupo.passengers, grupo.direction, oficina);
    const naveUnica = vehicles.length === 1 ? vehicles[0] : null;
    const separaFaltantes = grupo.flightIds.length > 1 && naveUnica !== null &&
      naveUnica.seats > 0 && lugaresDe(recorrida) > naveUnica.seats;
    const orden = (vehicle: ServiceOrderVehicle | null, passengers: ServiceOrderPassenger[]): ServiceOrderBlock => ({
      ...grupo,
      key: `${flightKey}:${vehicle?.assignmentId ?? SIN_NAVE}`,
      vehicle,
      scopedVehicle: separaFaltantes,
      operationAt: paihuenPickupTime(grupo.operationAt, grupo.direction === "DEPARTURE" && passengers.some(retiroPaihuen)),
      passengers,
      totalCents: totalDe(passengers),
      manualOrder: passengers.some((pasajero) => pasajero.routePosition !== null)
    });

    if (!vehicles.length || (naveUnica && !grupo.privateOrderId && !separaFaltantes)) {
      ordenes.push(orden(vehicles[0] ?? null, recorrida));
      continue;
    }

    // Cada nave hace su propia recorrida: el reparto es por zona y después se ordena la de cada una.
    const { porNave, sinNave } = grupo.privateOrderId
      ? repartirParadasPrivadas(recorrida, vehicles) : repartirEnNaves(recorrida, vehicles, grupo.flightIds.length > 1);
    for (const nave of vehicles) {
      const pasajeros = ordenDeLaRecorrida(porNave.get(nave.assignmentId) ?? [], grupo.direction, oficina);
      if (pasajeros.length || incluirVacias) ordenes.push(orden(nave, pasajeros));
    }
    if (sinNave.length) ordenes.push(orden(null, ordenDeLaRecorrida(sinNave, grupo.direction, oficina)));
  }

  // `sort` es estable: las naves de un mismo vuelo quedan en el orden en que se asignaron.
  const vuelosConPrivada = new Set(ordenes.filter(order => order.privateOrderId).flatMap(order => order.flightIds));
  for (const order of ordenes) {
    order.scopedVehicle = order.scopedVehicle || order.flightIds.some(id => vuelosConPrivada.has(id));
  }
  return ordenes.sort((a, b) => a.operationAt.getTime() - b.operationAt.getTime());
}

/** Lugares ocupados en una orden. */
export const lugaresDeLaOrden = (block: ServiceOrderBlock) => lugaresDe(block.passengers);

/**
 * Cómo se pide una orden puntual por URL (descarga, link del chofer): el vuelo y, si el vuelo se parte
 * por nave, la asignación de esa nave o `sin-nave`. `null` en `vehicle` = el vuelo entero.
 */
export function referenciaDeLaOrden(block: ServiceOrderBlock) {
  if (block.privateOrderId) {
    const pendiente = block.vehicleCount ? `pendiente-${block.privateOrderId}` : `privada-${block.privateOrderId}`;
    return { flight: block.flightId, vehicle: block.vehicle?.assignmentId ?? pendiente };
  }
  return { flight: block.flightId, vehicle: block.vehicleCount > 1 || block.scopedVehicle ? (block.vehicle?.assignmentId ?? SIN_NAVE) : null };
}

/**
 * Las órdenes de la hoja de un vuelo: las suyas y, si va en una vuelta unida, las de la vuelta (con una o
 * varias naves, cada una con gente de todos los vuelos). Si no se unieron, cada vuelo se queda sólo con
 * sus órdenes: el chofer de uno no puede recibir los pasajeros del otro. Sin vuelo pedido devuelve todas.
 */
export function ordenesDelVuelo(blocks: ServiceOrderBlock[], flightId: string | null) {
  if (!flightId) return blocks;
  return blocks.filter((block) => block.flightIds.includes(flightId));
}

/** Deja sólo la orden de esa nave; sin nave pedida devuelve todas. */
export function filtrarPorNave(blocks: ServiceOrderBlock[], vehicle: string | null) {
  if (!vehicle) return blocks;
  return blocks.filter(block => (block.privateOrderId && vehicle === `privada-${block.privateOrderId}`) || referenciaDeLaOrden(block).vehicle === vehicle || block.vehicle?.vehicleId === vehicle || block.vehicle?.assignmentId === vehicle);
}

/** Orden con pasajeros pendientes de ubicar en un servicio que ya tiene alguna nave. */
export function bloqueSinNaveAsignada(block: ServiceOrderBlock) {
  return !block.privateOrderId && !block.vehicle &&
    (block.vehicleCount > 1 || (block.vehicleCount === 1 && Boolean(block.scopedVehicle)));
}

/** «Sprinter 1910 · Juan»: la nave y el chofer, para el rótulo y el nombre del archivo. */
export function naveDeLaOrden(block: ServiceOrderBlock) {
  if (block.privateOrderId) return ["Privada", block.vehicle?.name ?? "nave pendiente", block.vehicle?.driver].filter(Boolean).join(" · ");
  if (block.vehicle) return [block.vehicle.name, block.vehicle.driver].filter(Boolean).join(" · ");
  return bloqueSinNaveAsignada(block) ? "sin nave asignada" : null;
}

function conNave(block: ServiceOrderBlock) {
  const nave = naveDeLaOrden(block);
  return nave ? ` · ${nave}` : "";
}

/**
 * Hora de inicio de la recorrida de una partida («12:45»): el dato que el chofer no puede perder, así
 * que la hoja lo remarca aparte. Los arribos no tienen recorrida: el chofer espera el vuelo.
 */
export function inicioDeRecorrida(block: ServiceOrderBlock) {
  return block.direction === "DEPARTURE" ? horaEnSalta(block.operationAt) : null;
}

/**
 * Renglón de horario del bloque: lo que va en la banda sobre los pasajeros. Con `sinRecorrida` deja
 * afuera la hora de inicio de la recorrida, para cuando la hoja la muestra remarcada aparte.
 */
export function blockTimeLabel(block: ServiceOrderBlock, { sinRecorrida = false }: { sinRecorrida?: boolean } = {}) {
  if (block.flights.length > 1) {
    // Varios vuelos en la misma vuelta: cada uno con su hora, en el orden en que salen o llegan.
    const vuelos = block.flights
      .map((vuelo) => {
        const hora = horaEnSalta(vuelo.flightAt);
        const programado = horaEnSalta(vuelo.scheduledAt);
        return `${vuelo.number} ${block.direction === "DEPARTURE" ? "despegue" : "llega"} ${hora}${hora !== programado ? ` (programado ${programado})` : ""}`;
      })
      .join(" + ");
    const recorrida = block.direction === "DEPARTURE" && !sinRecorrida ? ` · recorrida ${horaEnSalta(block.operationAt)}` : "";
    return `${block.heading} ${vuelos}${recorrida}${conNave(block)}`;
  }
  if (block.direction === "DEPARTURE") {
    const despegue = horaEnSalta(block.flightAt);
    const programado = horaEnSalta(block.scheduledAt);
    // Si la aerolínea movió el vuelo, el chofer ve la hora vigente y la programada entre paréntesis:
    // el papel no puede esconder la hora a la que estaba citado (issue #140).
    const corrido = despegue !== programado ? ` (programado ${programado})` : "";
    const recorrida = sinRecorrida ? "" : ` · recorrida ${horaEnSalta(block.operationAt)}`;
    return `${block.heading} ${block.flightNumber}${recorrida} · despegue ${despegue}${corrido}${conNave(block)}`;
  }

  const llega = horaEnSalta(block.flightAt);
  const programado = horaEnSalta(block.scheduledAt);
  const demorado = llega !== programado ? ` (programado ${programado})` : "";

  return `${block.heading} ${block.flightNumber} · llega ${llega}${demorado}${conNave(block)}`;
}

export const SERVICE_ORDER_COLUMNS = [
  "Pasajero",
  "Cant",
  "DNI",
  "Alojamiento",
  "Derivado por",
  "Pago",
  "Contacto",
  "Forma de pago"
] as const;

/**
 * Las celdas de un pasajero, en el mismo orden que `SERVICE_ORDER_COLUMNS`.
 *
 * La usan la vista en pantalla y cualquier consumidor de texto; el .xlsx arma sus celdas con estilos
 * pero con este mismo contenido. Si alguien agrega o mueve una columna, el test de contrato obliga a
 * tocar esta función: la pantalla y el papel no pueden desincronizarse.
 */
export function serviceOrderRow(pasajero: ServiceOrderPassenger): string[] {
  const alojamiento = pasajero.lodgingDetail ? `${pasajero.lodging} · ${pasajero.lodgingDetail}` : pasajero.lodging;

  return [
    pasajero.name,
    String(pasajero.seats),
    pasajero.document,
    alojamiento,
    pasajero.referredBy ?? "",
    pasajero.payment,
    pasajero.contact,
    pasajero.paymentMethod ?? ""
  ];
}

/** «Total OUT 1671 · Sprinter 1910»: el pie de cada orden. */
export function tituloDelTotal(block: ServiceOrderBlock) {
  const nave = block.vehicle?.name ?? (bloqueSinNaveAsignada(block) ? "sin nave" : null);
  return `Total ${block.heading} ${block.flightNumber}${nave ? ` · ${nave}` : ""}`;
}

export function serviceOrderFileName(date: string, flightReference?: string | null) {
  const sufijo = flightReference
    ? `-${flightReference
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()}`
    : "";

  return `orden-de-servicio-${date}${sufijo}.xlsx`;
}

export type ServiceOrderMeta = {
  date: string;
  generatedAt: Date;
};

/**
 * Paleta del sitio (`globals.css`): el encabezado de la hoja usa el verde profundo de la marca, con
 * el logo blanco arriba (el logo es blanco con fondo transparente, así que sobre papel blanco sería
 * invisible: siempre va sobre la banda oscura).
 */
const VERDE = "FF1F5B4F";
const VERDE_HONDO = "FF0E3D34";
const VERDE_SUAVE = "FFD5E1DC";
const ZEBRA = "FFF7F4EC";
const BORDE = "FFC9C3B2";
const TINTA = "FF233024";
const GRIS = "FF6B6455";
const COBRAR = "FFA32A1F";
/** Amarillo resaltador para la hora de inicio de la recorrida. */
const REMARCADO = "FFFFE58A";
const PAGADO = "FF1F5B4F";

const FILA_ENCABEZADO = 5;

/**
 * Anchos de columna en «caracteres» de Excel, en A4 horizontal: la hoja se imprime sin escalar.
 * Ojo: el alto de cada renglón se calcula contra estos anchos (`lineasDeTexto`), así que si cambia
 * uno hay que cambiar el otro — si no, el texto se corta.
 */
const ANCHOS = [26, 5, 14, 30, 13, 15, 15, 20] as const;

/**
 * Cuántos renglones ocupa un texto en una columna de `ancho` caracteres, con fuente de `pt`.
 * Sirve para fijar el alto de la fila: con un alto fijo, una dirección larga se corta y el chofer
 * termina leyendo media dirección (pasó con las direcciones de Google, que traen 70 caracteres).
 */
export function lineasDeTexto(texto: string, ancho: number, pt = 10) {
  // El ancho de columna de Excel está en «caracteres» del font por defecto (11 pt). Bajar el cuerpo
  // no aumenta los caracteres de forma lineal: se compensa con la raíz. Y se deja aire (0.95)
  // porque una dirección se corta antes de lo que dice la cuenta teórica.
  const capacidad = Math.max(4, Math.floor(ancho * 0.95 * Math.sqrt(11 / pt)));
  let lineas = 1;
  let usado = 0;

  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const suma = usado === 0 ? palabra.length : usado + 1 + palabra.length;
    if (suma > capacidad && usado > 0) {
      lineas += 1;
      usado = palabra.length;
    } else {
      usado = suma;
    }
  }

  return lineas;
}

const BORDE_FINO: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BORDE } },
  left: { style: "thin", color: { argb: BORDE } },
  bottom: { style: "thin", color: { argb: BORDE } },
  right: { style: "thin", color: { argb: BORDE } }
};

const emitidaEl = (value: Date) =>
  new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Argentina/Salta"
  }).format(value);

type Rango = { fila: number; desde: number; hasta: number };

/** Pinta un tramo de la fila: en Excel el relleno de una celda combinada no se propaga al resto. */
function pintarFila(sheet: ExcelJS.Worksheet, rango: Rango, color: string) {
  const fila = sheet.getRow(rango.fila);
  for (let columna = rango.desde; columna <= rango.hasta; columna += 1) {
    fila.getCell(columna).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  }
}

/**
 * Genera el .xlsx de la orden de servicio: encabezado con el logo y la fecha, una banda por vuelo,
 * una fila por reserva y los totales. Un día sin pasajeros se avisa en la hoja en vez de devolver
 * un archivo vacío o un error.
 */
export async function buildServiceOrderWorkbook(
  meta: ServiceOrderMeta,
  blocks: ServiceOrderBlock[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "La Araucana Viajes";
  workbook.created = meta.generatedAt;
  workbook.modified = meta.generatedAt;

  const sheet = workbook.addWorksheet("Orden de servicio", {
    views: [{ state: "frozen", ySplit: FILA_ENCABEZADO }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: `${FILA_ENCABEZADO}:${FILA_ENCABEZADO}`,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.55, header: 0.25, footer: 0.25 }
    }
  });

  sheet.columns = ANCHOS.map((width) => ({ width }));

  // --- Encabezado: banda verde con logo, título y fecha -------------------------------------
  for (let fila = 1; fila <= 3; fila += 1) {
    pintarFila(sheet, { fila, desde: 1, hasta: SERVICE_ORDER_COLUMNS.length }, VERDE_HONDO);
  }
  sheet.getRow(1).height = 26;
  sheet.getRow(2).height = 20;
  sheet.getRow(3).height = 15;

  // El cast es sólo de tipos: con @types/node nuevo, `Buffer.from` y el `buffer` que declara
  // ExcelJS son dos genéricos de Buffer distintos. En runtime es el mismo Buffer.
  const logoPng = Buffer.from(ORDER_LOGO_PNG_BASE64, "base64");
  const logoId = workbook.addImage({
    buffer: logoPng as unknown as NonNullable<Parameters<ExcelJS.Workbook["addImage"]>[0]["buffer"]>,
    extension: "png"
  });
  sheet.addImage(logoId, {
    tl: { col: 0.12, row: 0.1 },
    ext: { width: 122, height: 62 }
  });

  sheet.mergeCells("C1:E1");
  const titulo = sheet.getCell("C1");
  titulo.value = "ORDEN DE SERVICIO";
  titulo.font = { bold: true, size: 17, color: { argb: "FFFFFFFF" } };
  titulo.alignment = { horizontal: "center", vertical: "middle" };

  sheet.mergeCells("C2:E2");
  const subtitulo = sheet.getCell("C2");
  subtitulo.value = "Traslados AEROPUERTO CHAPELCO";
  subtitulo.font = { size: 10.5, color: { argb: "FFD5E1DC" } };
  subtitulo.alignment = { horizontal: "center", vertical: "middle" };

  sheet.mergeCells("C3:E3");
  const emitida = sheet.getCell("C3");
  emitida.value = `Emitida el ${emitidaEl(meta.generatedAt)}`;
  emitida.font = { size: 8, color: { argb: "FF9BB8AF" } };
  emitida.alignment = { horizontal: "center", vertical: "middle" };

  const etiquetaFecha = sheet.getCell("F1");
  etiquetaFecha.value = "FECHA";
  etiquetaFecha.font = { bold: true, size: 8, color: { argb: "FF9BB8AF" } };
  etiquetaFecha.alignment = { horizontal: "right", vertical: "bottom" };

  sheet.mergeCells("F2:H2");
  const fecha = sheet.getCell("F2");
  fecha.value = fechaDeLaOrden(meta.date);
  fecha.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  fecha.alignment = { horizontal: "right", vertical: "middle" };

  const pasajerosDelDia = blocks.reduce(
    (total, block) => total + block.passengers.reduce((suma, pasajero) => suma + pasajero.seats, 0),
    0
  );
  sheet.mergeCells("F3:H3");
  const resumen = sheet.getCell("F3");
  const ordenesDelDia = blocks.length;
  resumen.value = `${ordenesDelDia} ${ordenesDelDia === 1 ? "orden" : "órdenes"} · ${pasajerosDelDia} pasajeros`;
  resumen.font = { size: 8, color: { argb: "FF9BB8AF" } };
  resumen.alignment = { horizontal: "right", vertical: "top" };

  sheet.getRow(4).height = 7;

  // --- Encabezado de la tabla ----------------------------------------------------------------
  const encabezado = sheet.getRow(FILA_ENCABEZADO);
  SERVICE_ORDER_COLUMNS.forEach((columna, indice) => {
    const celda = encabezado.getCell(indice + 1);
    celda.value = columna;
    celda.font = { bold: true, size: 10, color: { argb: TINTA } };
    celda.alignment = { vertical: "middle", horizontal: indice === 1 ? "center" : "left" };
    celda.border = BORDE_FINO;
  });
  pintarFila(sheet, { fila: FILA_ENCABEZADO, desde: 1, hasta: SERVICE_ORDER_COLUMNS.length }, VERDE_SUAVE);
  encabezado.height = 22;

  let fila = FILA_ENCABEZADO + 1;

  if (blocks.length === 0) {
    const vacio = sheet.getRow(fila++);
    sheet.mergeCells(`A${fila - 1}:H${fila - 1}`);
    vacio.getCell(1).value = `Sin pasajeros cargados para ${fechaDeLaOrden(meta.date)}.`;
    vacio.getCell(1).font = { italic: true, size: 10, color: { argb: GRIS } };
    vacio.height = 22;
  }

  for (const block of blocks) {
    // Banda del vuelo: a la izquierda el rótulo de la operación, a la derecha cuántos van y cuánto.
    const banda = sheet.getRow(fila);
    sheet.mergeCells(`A${fila}:E${fila}`);
    sheet.mergeCells(`F${fila}:H${fila}`);
    const celdaBanda = banda.getCell(1);
    celdaBanda.value = blockTimeLabel(block);
    celdaBanda.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    celdaBanda.alignment = { vertical: "middle" };
    const lugaresDelBloque = block.passengers.reduce((total, pasajero) => total + pasajero.seats, 0);
    const celdaBandaMonto = banda.getCell(6);
    celdaBandaMonto.value = `${lugaresDelBloque} ${lugaresDelBloque === 1 ? "pasajero" : "pasajeros"} · ${plata(
      block.totalCents,
      block.passengers[0]?.currency ?? "ARS"
    )}`;
    celdaBandaMonto.font = { bold: true, size: 10, color: { argb: "FFD5E1DC" } };
    celdaBandaMonto.alignment = { vertical: "middle", horizontal: "right" };
    pintarFila(sheet, { fila, desde: 1, hasta: SERVICE_ORDER_COLUMNS.length }, VERDE);
    banda.height = 20;
    fila += 1;

    // La hora de inicio de la recorrida va remarcada en su propio renglón: es la cita del chofer.
    const inicio = inicioDeRecorrida(block);
    if (inicio) {
      const renglonInicio = sheet.getRow(fila);
      sheet.mergeCells(`A${fila}:H${fila}`);
      const celdaInicio = renglonInicio.getCell(1);
      celdaInicio.value = `INICIO DE RECORRIDA ${inicio}`;
      celdaInicio.font = { bold: true, size: 14, color: { argb: TINTA } };
      celdaInicio.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      pintarFila(sheet, { fila, desde: 1, hasta: SERVICE_ORDER_COLUMNS.length }, REMARCADO);
      renglonInicio.height = 24;
      fila += 1;
    }

    block.passengers.forEach((pasajero, indice) => {
      const renglon = sheet.getRow(fila);
      const celdaPasajero = renglon.getCell(1);
      celdaPasajero.value = pasajero.name;
      celdaPasajero.font = { bold: true, size: 10, color: { argb: TINTA } };

      const celdaCant = renglon.getCell(2);
      celdaCant.value = pasajero.seats;
      celdaCant.numFmt = "0";
      celdaCant.font = { bold: true, size: 10, color: { argb: TINTA } };
      celdaCant.alignment = { horizontal: "center" };

      const celdaDni = renglon.getCell(3);
      celdaDni.value = pasajero.document;
      celdaDni.numFmt = "@";
      celdaDni.font = { size: 9.5, color: { argb: TINTA } };
      celdaDni.alignment = { horizontal: "center" };

      // Alojamiento en dos tonos: el lugar en negrita y la dirección abajo, más chica.
      const celdaAlojamiento = renglon.getCell(4);
      celdaAlojamiento.value = pasajero.lodgingDetail
        ? {
            richText: [
              { font: { bold: true, size: 9.5, color: { argb: TINTA } }, text: pasajero.lodging },
              { font: { size: 8.5, color: { argb: GRIS } }, text: `\n${pasajero.lodgingDetail}` }
            ]
          }
        : { richText: [{ font: { bold: true, size: 9.5, color: { argb: TINTA } }, text: pasajero.lodging }] };

      const celdaDerivado = renglon.getCell(5);
      celdaDerivado.value = pasajero.referredBy;
      celdaDerivado.font = { size: 9.5, color: { argb: GRIS } };

      const celdaPago = renglon.getCell(6);
      celdaPago.value = pasajero.payment;
      celdaPago.font = {
        bold: true,
        size: 9.5,
        color: { argb: pasajero.payment.startsWith("Pagado") ? PAGADO : COBRAR }
      };
      celdaPago.alignment = { horizontal: "right" };

      const metodo = pasajero.paymentMethod?.trim().toLowerCase() ?? "";
      const casilleros = `${metodo === "efectivo" ? "[x]" : "[ ]"} Efectivo\n${metodo === "transferencia" ? "[x]" : "[ ]"} Transferencia`;
      const otroMetodo = metodo && metodo !== "efectivo" && metodo !== "transferencia";
      const celdaMetodo = renglon.getCell(8);
      celdaMetodo.value = otroMetodo ? `${casilleros}\nOtro: ${pasajero.paymentMethod}` : casilleros;
      celdaMetodo.font = { size: 9.5, color: { argb: TINTA } };

      const celdaContacto = renglon.getCell(7);
      // El chofer abre el WhatsApp con un click desde el Excel (pedido del cliente).
      const whatsapp = whatsappLink(pasajero.contact);
      celdaContacto.value = whatsapp
        ? { text: pasajero.contact, hyperlink: whatsapp, tooltip: "Abrir WhatsApp" }
        : pasajero.contact;
      celdaContacto.numFmt = "@";
      celdaContacto.font = whatsapp
        ? { size: 9.5, color: { argb: TINTA }, underline: true }
        : { size: 9.5, color: { argb: TINTA } };

      for (let columna = 1; columna <= SERVICE_ORDER_COLUMNS.length; columna += 1) {
        const celda = renglon.getCell(columna);
        celda.border = BORDE_FINO;
        celda.alignment = { ...celda.alignment, vertical: "middle", wrapText: columna === 1 || columna === 4 || columna === 8 };
      }
      if (indice % 2 === 1) pintarFila(sheet, { fila, desde: 1, hasta: SERVICE_ORDER_COLUMNS.length }, ZEBRA);

      // El alto sale del texto: con un alto fijo la dirección se corta y no se lee a dónde ir.
      const lineasAlojamiento = lineasDeTexto(
        [pasajero.lodging, pasajero.lodgingDetail].filter(Boolean).join(" "),
        ANCHOS[3],
        9.5
      );
      const lineasPasajero = lineasDeTexto(pasajero.name, ANCHOS[0], 10);
      const lineasMetodo = String(celdaMetodo.value).split("\n")
        .reduce((total, linea) => total + lineasDeTexto(linea, ANCHOS[7], 9.5), 0);
      renglon.height = Math.max(lineasAlojamiento, lineasPasajero, lineasMetodo) * 12 + 6;
      fila += 1;
    });

    const subtotal = sheet.getRow(fila);
    sheet.mergeCells(`A${fila}:E${fila}`);
    const etiquetaSubtotal = subtotal.getCell(1);
    etiquetaSubtotal.value = tituloDelTotal(block);
    etiquetaSubtotal.font = { bold: true, size: 9.5, color: { argb: GRIS } };
    etiquetaSubtotal.alignment = { horizontal: "right", vertical: "middle" };
    const montoSubtotal = subtotal.getCell(6);
    // Texto, no número: el importe se arma con el mismo formateador que la columna Pago, así se
    // lee igual en Excel, en Numbers y en la vista previa del sistema (cada uno formatea distinto
    // un número con moneda, y la hoja terminaba mezclando «$ 10.400» con «ARS 10,400»).
    montoSubtotal.value = plata(block.totalCents, block.passengers[0]?.currency ?? "ARS");
    montoSubtotal.font = { bold: true, size: 10, color: { argb: TINTA } };
    montoSubtotal.alignment = { horizontal: "right", vertical: "middle" };
    for (let columna = 1; columna <= SERVICE_ORDER_COLUMNS.length; columna += 1) {
      subtotal.getCell(columna).border = {
        bottom: { style: "thin", color: { argb: BORDE } }
      };
    }
    subtotal.height = 17;

    const separacion = sheet.getRow(fila + 1);
    separacion.height = 7;
    fila += 2;
  }

  if (blocks.length > 0) {
    const total = sheet.getRow(fila);
    sheet.mergeCells(`A${fila}:E${fila}`);
    const etiquetaTotal = total.getCell(1);
    etiquetaTotal.value = blocks.length === 1 ? "TOTAL DE LA ORDEN" : "TOTAL DEL DÍA";
    etiquetaTotal.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    etiquetaTotal.alignment = { horizontal: "right", vertical: "middle" };
    const montoTotal = total.getCell(6);
    montoTotal.value = plata(
      blocks.reduce((suma, block) => suma + block.totalCents, 0),
      blocks[0].passengers[0]?.currency ?? "ARS"
    );
    montoTotal.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    montoTotal.alignment = { horizontal: "right", vertical: "middle" };
    pintarFila(sheet, { fila, desde: 1, hasta: SERVICE_ORDER_COLUMNS.length }, VERDE_HONDO);
    total.height = 24;

    const nota = sheet.getRow(fila + 2);
    sheet.mergeCells(`A${fila + 2}:H${fila + 2}`);
    nota.getCell(1).value =
      "Derivado por es el origen que se cargó en la reserva (agencia o voucher); si la venta fue directa, va vacío. " +
      "La forma de pago se carga desde la orden o se marca a mano en los casilleros. Elegirla no confirma el cobro. Cobrar / Pagado es el estado del pago de la reserva.";
    nota.getCell(1).font = { size: 8, italic: true, color: { argb: GRIS } };
    nota.getCell(1).alignment = { wrapText: true };
    const anchoTotal = ANCHOS.reduce((total, ancho) => total + ancho, 0);
    nota.height = Math.max(14, lineasDeTexto(String(nota.getCell(1).value), anchoTotal, 8) * 11 + 4);
  }

  sheet.headerFooter = {
    oddFooter: "&L&\"Calibri,Italic\"&8La Araucana Viajes S.R.L. · orden de servicio&R&8Página &P de &N"
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/** ¿Esta orden es una de las elegidas en la hoja del chofer? (`vehicle` null = la única del vuelo, o todas). */
export function esOrdenElegida(block: ServiceOrderBlock, ordenes: Array<{ flight: string; vehicle: string | null }>) {
  const ref = referenciaDeLaOrden(block);
  return ordenes.some((orden) => block.flightIds.includes(orden.flight) && (orden.vehicle === null || ref.vehicle === orden.vehicle || (block.privateOrderId && orden.vehicle === `privada-${block.privateOrderId}`)));
}

import type { ReactNode } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import { butacasParaAeropuerto, pasajerosOcupados } from "@/lib/airport/booking";
import { airportPickupStart } from "@/lib/airport/pickup-start";
import { VUELOS_QUE_NO_SE_OFRECEN } from "@/lib/airport/offered-flights";
import { CHAPELCO_BOOKING_MODE, chapelcoActiveReservationStatuses } from "@/lib/chapelco/constants";
import { buildDayBoard, dayRange, isDateKey, localDateKey, shiftDateKey, type BoardArea, type BoardRow, type BoardUnit } from "@/lib/operations/day-board";
import { Paginador } from "@/components/admin-list/paginador";
import { paginarNaves } from "@/lib/vehicles/fleet-table";
import { FleetAssignmentForm } from "../fleet-assignment-form";
import { assignVehicleAction, removeAssignmentAction } from "../aeropuerto/actions";
import { assignChapelcoVehicle, releaseChapelcoVehicle } from "../chapelco/actions";
import { diaDelViaje, etiquetaRango, ultimoDia, whereVigenteEn } from "@/lib/special-trips/rango";
import { addBoardUnitAction, addSpecialVehicleAction, createBoardScheduleAction, removeBoardScheduleAction, removeSpecialVehicleAction, setAirportDriverAction, setChapelcoDriverAction, setSpecialDriverAction } from "./actions";
import { ScheduleCrewForm, type Option } from "./crew-form";
import { BOARD_RETURN_FIELD, BOARD_RETURN_VALUE } from "./return-to";
import "./salidas-del-dia.css";

type PageProps = {
  searchParams?: Promise<{ date?: string; falta?: string; page?: string; programadas?: string; ppage?: string; notice?: string }>;
};

const AREA_LABEL: Record<BoardArea, string> = { RUTA: "Ruta", AEROPUERTO: "Aeropuerto", CHAPELCO: "Chapelco", ESPECIAL: "Viaje especial" };
const ACTIVE_RESERVATION = { notIn: ["CANCELLED"] };
const PAGE_SIZE = 6;

const hourFormat = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Salta" });
const dayFormat = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function dayTitle(dateKey: string, today: string) {
  const label = dayFormat.format(new Date(`${dateKey}T12:00:00Z`));
  const prefix = dateKey === today ? "Hoy" : dateKey === shiftDateKey(today, 1) ? "Mañana" : dateKey === shiftDateKey(today, -1) ? "Ayer" : null;
  return prefix ? `${prefix}, ${label}` : label.charAt(0).toUpperCase() + label.slice(1);
}

const seatsOf = (vehicle: { _count: { seats: number } }) => vehicle._count.seats;
const VEHICLE_SELECT = { id: true, name: true, _count: { select: { seats: true } } } as const;
const DRIVER_SELECT = { id: true, name: true, email: true } as const;

export default async function DayBoardPage({ searchParams }: PageProps) {
  const user = await getCurrentReservationsUserOrRedirect();
  const canEditRoutes = isAdminRole(user.role);
  const params = await searchParams;
  const today = localDateKey(new Date());
  const dateKey = isDateKey(params?.date) ? params.date : today;
  const falta: "nave" | "chofer" | "sobrecupo" | "todo" | null =
    params?.falta === "nave" || params?.falta === "chofer" || params?.falta === "sobrecupo"
      ? params.falta
      : params?.falta === "1" || params?.falta === "todo"
        ? "todo"
        : null;
  const onlyMissing = falta !== null;
  const page = Math.max(1, Number.parseInt(String(params?.page ?? ""), 10) || 1);
  const programmedPage = Math.max(1, Number.parseInt(String(params?.ppage ?? ""), 10) || 1);
  const programmedOpen = params?.programadas === "1";
  const { from, to } = dayRange(dateKey);
  const serviceDate = new Date(`${dateKey}T00:00:00.000Z`);

  const [schedules, flights, chapelcoRoutes, specialTrips, vehicles, drivers, routes] = await Promise.all([
    prisma.schedule.findMany({
      where: { departureAt: { gte: from, lt: to } },
      orderBy: { departureAt: "asc" },
      include: {
        route: { select: { from: true, to: true } },
        vehicle: { select: VEHICLE_SELECT },
        driver: { select: DRIVER_SELECT },
        extraUnits: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { vehicle: { select: VEHICLE_SELECT }, driver: { select: DRIVER_SELECT } } },
        reservations: { where: { status: ACTIVE_RESERVATION }, select: { passengerCount: true } },
        _count: { select: { reservations: true } }
      }
    }),
    prisma.flight.findMany({
      where: { scheduledAt: { gte: from, lt: to }, source: { not: "RETIRADO" }, number: { notIn: [...VUELOS_QUE_NO_SE_OFRECEN] } },
      orderBy: { scheduledAt: "asc" },
      include: {
        reservations: { include: { reservation: { select: { passengerCount: true, status: true } } } },
        assignments: { orderBy: { createdAt: "asc" }, include: { vehicle: { select: VEHICLE_SELECT }, driver: { select: DRIVER_SELECT } } }
      }
    }),
    prisma.travelRoute.findMany({
      where: { bookingMode: CHAPELCO_BOOKING_MODE, specialType: "CHAPELCO" },
      select: {
        id: true,
        chapelcoOperationDays: {
          where: { serviceDate },
          include: { vehicleDuties: { where: { status: "ACTIVE" }, include: { vehicle: { select: { id: true, name: true } }, driver: { select: DRIVER_SELECT } } } }
        },
        directReservations: {
          where: { bookingMode: CHAPELCO_BOOKING_MODE, status: { in: [...chapelcoActiveReservationStatuses] }, chapelcoDetails: { serviceDate } },
          select: { passengerCount: true, chapelcoDetails: { select: { ascentSlot: true } } }
        }
      }
    }),
    // Viajes especiales del día: los que salen, los que están afuera (varios días) y los que tienen una
    // nave ocupada este día aunque se hayan cargado con una sola fecha.
    prisma.specialTrip.findMany({
      where: { AND: [{ status: { not: "CANCELLED" } }, { OR: [whereVigenteEn(serviceDate), { assignments: { some: { startsAt: { lt: to }, endsAt: { gt: from } } } }] }] },
      include: { assignments: { orderBy: { startsAt: "asc" }, include: { vehicle: { select: VEHICLE_SELECT }, driver: { select: DRIVER_SELECT } } } }
    }),
    prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { ...VEHICLE_SELECT, internalNumber: true } }),
    prisma.user.findMany({ where: { role: "DRIVER", isActive: true }, orderBy: [{ name: "asc" }, { email: "asc" }], select: DRIVER_SELECT }),
    // Rutas con salidas propias, para crear una desde el tablero (aeropuerto y Chapelco tienen su lógica).
    prisma.travelRoute.findMany({
      where: { bookingMode: { notIn: ["AIRPORT", CHAPELCO_BOOKING_MODE] } },
      orderBy: [{ isActive: "desc" }, { from: "asc" }, { to: "asc" }],
      select: { id: true, from: true, to: true, isActive: true, durationMin: true }
    })
  ]);

  const board = buildDayBoard({
    dateKey,
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      routeId: schedule.routeId,
      from: schedule.route.from,
      to: schedule.route.to,
      departureAt: schedule.departureAt,
      status: schedule.status,
      passengers: schedule.reservations.reduce((sum, reservation) => sum + reservation.passengerCount, 0),
      reservations: schedule._count.reservations,
      vehicle: schedule.vehicle && { id: schedule.vehicle.id, name: schedule.vehicle.name, seats: seatsOf(schedule.vehicle) },
      driver: schedule.driver,
      extraUnits: schedule.extraUnits.map((unit) => ({
        id: unit.id,
        vehicle: { id: unit.vehicle.id, name: unit.vehicle.name, seats: seatsOf(unit.vehicle) },
        driver: unit.driver
      }))
    })),
    flights: flights.map((flight) => ({
      id: flight.id,
      number: flight.number,
      direction: flight.direction,
      scheduledAt: flight.scheduledAt,
      estimatedAt: flight.estimatedAt,
      pickupStart: airportPickupStart(flight),
      source: flight.source,
      status: flight.status,
      passengers: pasajerosOcupados(flight.reservations.map((detail) => detail.reservation)),
      units: flight.assignments.map((assignment) => ({
        id: assignment.id,
        // Aeropuerto: las unidades de menos de 26 butacas venden 4 menos (equipaje).
        vehicle: { id: assignment.vehicle.id, name: assignment.vehicle.name, seats: butacasParaAeropuerto(seatsOf(assignment.vehicle)) },
        driver: assignment.driver
      }))
    })),
    chapelco: chapelcoRoutes.map((route) => {
      const day = route.chapelcoOperationDays[0] ?? null;
      const slots = route.directReservations.map((reservation) => reservation.chapelcoDetails?.ascentSlot).filter((slot): slot is string => !!slot).sort();
      return {
        operationDayId: day?.id ?? null,
        routeId: route.id,
        dateKey,
        status: day?.status ?? "OPEN",
        passengers: route.directReservations.reduce((sum, reservation) => sum + reservation.passengerCount, 0),
        firstAscent: slots[0] ? new Date(`${dateKey}T${slots[0]}:00-03:00`) : null,
        units: (day?.vehicleDuties ?? []).map((duty) => ({ id: duty.id, capacity: duty.capacity, vehicle: duty.vehicle, driver: duty.driver }))
      };
    }),
    specialTrips: specialTrips.map((trip) => {
      const day = diaDelViaje(trip, serviceDate);
      return {
      id: trip.id,
      client: trip.client,
      passengers: trip.passengers,
      status: trip.status,
      firstLegAt: null,
      day: day ? { number: day.numero, total: day.total, returnLabel: etiquetaRango({ serviceDate: ultimoDia(trip) }, serviceDate) } : null,
      continuing: day ? !day.primero : trip.serviceDate.toISOString().slice(0, 10) !== dateKey,
      units: trip.assignments.map((assignment) => ({
        id: assignment.id,
        startsAt: assignment.startsAt,
        endsAt: assignment.endsAt,
        vehicle: { id: assignment.vehicle.id, name: assignment.vehicle.name, seats: seatsOf(assignment.vehicle) },
        driver: assignment.driver
      }))
      };
    })
  });

  // Servicios reales primero; la programación sin demanda va aparte y colapsada (issue #258).
  const serviceRows = board.rows.filter((row) => !row.programmed);
  const programmedRows = board.rows.filter((row) => row.programmed);
  const rows = falta
    ? serviceRows.filter((row) =>
        falta === "nave" ? row.missingVehicle
        : falta === "chofer" ? row.missingDriver
        : falta === "sobrecupo" ? row.overbooked
        : row.missingVehicle || row.missingDriver || row.overbooked
      )
    : serviceRows;
  const servicesPage = paginarNaves(rows, page, PAGE_SIZE);
  const programmedPageData = paginarNaves(programmedRows, programmedPage, PAGE_SIZE);
  const emptyMessage = onlyMissing && serviceRows.length
    ? "No hay servicios con ese faltante para este día."
    : programmedRows.length
      ? "No hay servicios con pasajeros para este día: abajo está la programación."
      : "No hay servicios cargados para este día.";
  const listHref = (destino: number) => {
    const query = new URLSearchParams({ date: dateKey });
    if (falta) query.set("falta", falta);
    if (destino > 1) query.set("page", String(destino));
    return `/admin/salidas-del-dia?${query.toString()}#salidas`;
  };
  const programmedHref = (destino: number) => {
    const query = new URLSearchParams({ date: dateKey, programadas: "1" });
    if (destino > 1) query.set("ppage", String(destino));
    return `/admin/salidas-del-dia?${query.toString()}#programacion`;
  };
  const servicesPaginator = (
    <div className="sd-paginacion">
      <Paginador
        page={servicesPage.page}
        totalPages={servicesPage.totalPages}
        total={servicesPage.total}
        desde={servicesPage.desde}
        hasta={servicesPage.hasta}
        hrefPagina={listHref}
        etiqueta="servicios del día"
      />
    </div>
  );
  const programmedPaginator = (
    <div className="sd-paginacion">
      <Paginador
        page={programmedPageData.page}
        totalPages={programmedPageData.totalPages}
        total={programmedPageData.total}
        desde={programmedPageData.desde}
        hasta={programmedPageData.hasta}
        hrefPagina={programmedHref}
        etiqueta="programación"
      />
    </div>
  );
  const vehicleOptions: Option[] = vehicles.map((vehicle) => ({
    id: vehicle.id,
    label: `${vehicle.name}${vehicle.internalNumber ? ` · Int. ${vehicle.internalNumber}` : ""} · ${seatsOf(vehicle)} lug.`
  }));
  const driverOptions: Option[] = drivers.map((driver) => ({ id: driver.id, label: driver.name?.trim() || driver.email }));
  // Un chofer o una nave que quedaron inactivos siguen apareciendo donde ya estaban asignados.
  const withCurrent = (options: Option[], id: string | null, label: string | null) =>
    id && !options.some((option) => option.id === id) ? [{ id, label: `${label ?? id} (inactivo)` }, ...options] : options;
  const routeOptions: Option[] = routes.map((route) => ({ id: route.id, label: `${route.from} → ${route.to}${route.isActive ? "" : " (inactiva)"}` }));
  const dayHref = (key: string) => `/admin/salidas-del-dia?date=${key}${falta ? `&falta=${falta}` : ""}`;

  const renderRow = (row: BoardRow) => (
    <li
      key={row.key}
      className="sd-row"
      data-area={row.area}
      data-sigue={row.continuing || undefined}
      data-falta={row.missingVehicle || row.missingDriver || row.overbooked || undefined}
    >
      <div className="sd-time">
        <strong>{row.at ? hourFormat.format(row.at) : row.timeText ?? "—"}</strong>
        <span>{row.atLabel}</span>
      </div>

      <div className="sd-service">
        <p className="sd-tags">
          <span className="sd-area">{AREA_LABEL[row.area]}</span>
          {row.status ? <span className="pill pill-estado" data-tono={row.status === "Demorado" ? "atencion" : "grave"}>{row.status}</span> : null}
          {row.missingVehicle ? <span className="pill pill-alerta">sin nave</span> : null}
          {row.missingDriver ? <span className="pill pill-alerta">sin chofer</span> : null}
          {row.overbooked ? <span className="pill pill-alerta">sobrecupo</span> : null}
        </p>
        <h3><Link href={row.href}>{row.title}</Link></h3>
        {row.detail ? <p className="muted">{row.detail}</p> : null}
        <p className="sd-links">
          <Link className="sd-gestionar" href={row.href}>Gestionar</Link>
          {row.area !== "RUTA" ? (
            <Link href={row.editHref}>{row.area === "CHAPELCO" ? "Ver el día" : "Editar"}</Link>
          ) : null}
        </p>
      </div>

      <div className="sd-pax">
        <strong>{row.passengers}</strong>
        <span>{row.capacity !== null ? `de ${row.capacity} lugares` : "pasajeros"}</span>
      </div>

      <div className="sd-assign">
        {row.area === "RUTA" ? (
          canEditRoutes ? (
            <RouteUnits row={row} dateKey={dateKey} vehicleOptions={vehicleOptions} driverOptions={driverOptions} withCurrent={withCurrent} />
          ) : (
            <UnitsReadOnly units={row.units} note="La nave y el chofer de las rutas los asigna un administrador." />
          )
        ) : row.area === "AEROPUERTO" ? (
          <AirportUnits row={row} dateKey={dateKey} vehicleOptions={vehicleOptions} driverOptions={driverOptions} withCurrent={withCurrent} />
        ) : row.area === "CHAPELCO" ? (
          <ChapelcoUnits row={row} dateKey={dateKey} vehicleOptions={vehicleOptions} driverOptions={driverOptions} withCurrent={withCurrent} />
        ) : (
          <SpecialUnits row={row} dateKey={dateKey} vehicleOptions={vehicleOptions} driverOptions={driverOptions} withCurrent={withCurrent} />
        )}
      </div>
    </li>
  );

  return (
    <AdminShell
      title="Salidas del día"
      eyebrow="Operación"
      role={user.role}
      action={
        <nav className="sd-days" aria-label="Elegir el día">
          <Link className="ghost-button" href={dayHref(shiftDateKey(dateKey, -1))} aria-label="Día anterior">‹</Link>
          <Link className={`ghost-button${dateKey === today ? " is-active" : ""}`} href={dayHref(today)}>Hoy</Link>
          <Link className={`ghost-button${dateKey === shiftDateKey(today, 1) ? " is-active" : ""}`} href={dayHref(shiftDateKey(today, 1))}>Mañana</Link>
          <Link className="ghost-button" href={dayHref(shiftDateKey(dateKey, 1))} aria-label="Día siguiente">›</Link>
          <form className="sd-date" action="/admin/salidas-del-dia">
            <input type="date" name="date" defaultValue={dateKey} aria-label="Fecha" />
            {falta ? <input type="hidden" name="falta" value={falta} /> : null}
            <button className="ghost-button" type="submit">Ver</button>
          </form>
        </nav>
      }
    >
      {params?.notice ? <p className="admin-notice" role="status">{params.notice}</p> : null}

      <section className="sd-head">
        <div>
          <h2>{dayTitle(dateKey, today)}</h2>
          <p className="muted">Todos los servicios del día con su nave y su chofer: rutas, aeropuerto, Chapelco y viajes especiales, por la hora en que sale la unidad.</p>
        </div>
        <div className="sd-summary">
          <Link className="sd-stat" href={`/admin/salidas-del-dia?date=${dateKey}`} aria-label="Ver todos los servicios del día">
            <span className="sd-stat-label">Servicios</span>
            <strong className="sd-stat-value">{board.summary.services}</strong>
          </Link>
          <Link className="sd-stat" href={`/admin/reservas?date=${dateKey}&until=${dateKey}`} aria-label="Gestionar las reservas y pasajeros del día">
            <span className="sd-stat-label">Pasajeros</span>
            <strong className="sd-stat-value">{board.summary.passengers}</strong>
          </Link>
          <Link className="sd-stat" data-alerta={board.summary.missingVehicle > 0 || undefined} data-activo={falta === "nave" || undefined} href={`/admin/salidas-del-dia?date=${dateKey}&falta=nave#salidas`} aria-label="Ver servicios sin nave">
            <span className="sd-stat-label">Sin nave</span>
            <strong className="sd-stat-value">{board.summary.missingVehicle}</strong>
          </Link>
          <Link className="sd-stat" data-alerta={board.summary.missingDriver > 0 || undefined} data-activo={falta === "chofer" || undefined} href={`/admin/salidas-del-dia?date=${dateKey}&falta=chofer#salidas`} aria-label="Ver servicios sin chofer">
            <span className="sd-stat-label">Sin chofer</span>
            <strong className="sd-stat-value">{board.summary.missingDriver}</strong>
          </Link>
          <Link className="sd-stat" data-alerta={board.summary.overbooked > 0 || undefined} data-activo={falta === "sobrecupo" || undefined} href={`/admin/salidas-del-dia?date=${dateKey}&falta=sobrecupo#salidas`} aria-label="Ver servicios con sobrecupo">
            <span className="sd-stat-label">Sobrecupo</span>
            <strong className="sd-stat-value">{board.summary.overbooked}</strong>
          </Link>
          {board.summary.programmed > 0 ? (
            <Link className="sd-stat" data-activo={programmedOpen || undefined} href={`/admin/salidas-del-dia?date=${dateKey}&programadas=1#programacion`} aria-label="Ver la programación del día">
              <span className="sd-stat-label">Programadas</span>
              <strong className="sd-stat-value">{board.summary.programmed}</strong>
            </Link>
          ) : null}
        </div>
        <div className="sd-filter">
          <Link className={`pill${!falta ? " is-active" : ""}`} href={`/admin/salidas-del-dia?date=${dateKey}`}>Todos</Link>
          <Link className={`pill${falta ? " is-active" : ""}`} href={`/admin/salidas-del-dia?date=${dateKey}&falta=todo`}>Sólo lo que falta asignar</Link>
        </div>
      </section>

      {/* Crear desde el tablero: una salida de ruta acá mismo; el resto, a su formulario completo. */}
      <details className="plain-card sd-add">
        <summary>
          <strong>Agregar al día</strong>
          <span className="muted">salida de ruta, vuelo, reserva, viaje especial, nave o chofer</span>
        </summary>
        <div className="sd-add-body">
          {canEditRoutes ? (
            <div className="sd-add-form">
              <h3>Salida de ruta</h3>
              <FleetAssignmentForm action={createBoardScheduleAction}>
                <input type="hidden" name="date" value={dateKey} />
                <label><span>Ruta</span>
                  <select name="routeId" defaultValue="" required>
                    <option value="" disabled>Elegir ruta…</option>
                    {routeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <label><span>Sale</span><input type="time" name="time" required /></label>
                <label><span>Nave</span>
                  <select name="vehicleId" defaultValue="">
                    <option value="">Sin nave asignada</option>
                    {vehicleOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <label><span>Chofer</span>
                  <select name="driverId" defaultValue="">
                    <option value="">Sin chofer</option>
                    {driverOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <button className="button" type="submit">Crear salida</button>
              </FleetAssignmentForm>
              <p className="muted sd-note">La llegada se calcula con la duración de la ruta. Para cambiarla, después tocás «Editar».</p>
            </div>
          ) : null}
          <div className="sd-add-links">
            <h3>Otros</h3>
            <Link className="ghost-button" href={`/admin/aeropuerto?date=${dateKey}`}>Cargar vuelo a mano</Link>
            <Link className="ghost-button" href={`/admin/reservas/nueva?servicio=aeropuerto&date=${dateKey}`}>Reserva de aeropuerto</Link>
            <Link className="ghost-button" href="/admin/viajes-especiales/nuevo">Viaje especial</Link>
            {canEditRoutes ? <Link className="ghost-button" href="/admin/naves/nueva">Nave nueva</Link> : null}
            {canEditRoutes ? <Link className="ghost-button" href="/admin/choferes/nueva">Chofer nuevo</Link> : null}
          </div>
        </div>
      </details>

      {rows.length === 0 ? (
        <p className="plain-card sd-empty">{emptyMessage}</p>
      ) : (
        <>
          <div id="salidas" className="sd-ancla" />
          {servicesPage.totalPages > 1 ? servicesPaginator : null}
          <ol className="sd-list">{servicesPage.items.map(renderRow)}</ol>
          {servicesPage.totalPages > 1 ? servicesPaginator : null}
        </>
      )}

      {programmedRows.length > 0 && !falta ? (
        <details className="plain-card sd-programmed" open={programmedOpen || programmedPageData.page > 1 ? true : undefined}>
          <div id="programacion" className="sd-ancla" />
          <summary>
            <strong>Ver la programación del día ({programmedRows.length})</strong>
            <span className="muted">salidas programadas sin pasajeros: no son un servicio hasta que tengan reservas</span>
          </summary>
          {programmedPageData.totalPages > 1 ? programmedPaginator : null}
          <ol className="sd-list sd-programmed-list">{programmedPageData.items.map(renderRow)}</ol>
          {programmedPageData.totalPages > 1 ? programmedPaginator : null}
        </details>
      ) : null}

      {driverOptions.length === 0 ? (
        <p className="muted sd-footnote">No hay choferes activos: se cargan en <Link href="/admin/choferes">Choferes</Link>.</p>
      ) : null}
    </AdminShell>
  );
}

type UnitProps = {
  row: BoardRow;
  dateKey: string;
  vehicleOptions: Option[];
  driverOptions: Option[];
  withCurrent: (options: Option[], id: string | null, label: string | null) => Option[];
};

const BoardReturn = () => <input type="hidden" name={BOARD_RETURN_FIELD} value={BOARD_RETURN_VALUE} />;

function DriverForm({ unit, action, dateKey, options }: { unit: BoardUnit; action: (formData: FormData) => Promise<void>; dateKey: string; options: Option[] }) {
  return (
    <form action={action} className="sd-driver">
      <input type="hidden" name="id" value={unit.id} />
      <input type="hidden" name="date" value={dateKey} />
      <select name="driverId" defaultValue={unit.driverId ?? ""} aria-label={`Chofer de ${unit.vehicleName}`} data-falta={!unit.driverId || undefined}>
        <option value="">Sin chofer</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <button className="ghost-button" type="submit">Guardar</button>
    </form>
  );
}

function UnitHead({ unit }: { unit: BoardUnit }) {
  return <p className="sd-unit-name"><strong>{unit.vehicleName}</strong> <span className="muted">{unit.seats} lug.</span></p>;
}

function AirportUnits({ row, dateKey, vehicleOptions, driverOptions, withCurrent }: UnitProps) {
  const free = vehicleOptions.filter((option) => !row.units.some((unit) => unit.vehicleId === option.id));
  return (
    <div className="sd-units">
      {row.units.map((unit) => (
        <div className="sd-unit" key={unit.id}>
          <UnitHead unit={unit} />
          <DriverForm unit={unit} action={setAirportDriverAction} dateKey={dateKey} options={withCurrent(driverOptions, unit.driverId, unit.driverName)} />
          <form action={removeAssignmentAction} className="sd-remove">
            <input type="hidden" name="id" value={unit.id} />
            <BoardReturn />
            <button className="text-button" type="submit" aria-label={`Quitar ${unit.vehicleName} del vuelo`}>Quitar</button>
          </form>
        </div>
      ))}
      {/* Sólo las naves que el vuelo todavía no tiene: volver a «agregar» una ya asignada le borraría el chofer. */}
      <div className="sd-sumar" data-campos="1">
<FleetAssignmentForm action={assignVehicleAction}>
        <input type="hidden" name="flightId" value={row.serviceId} />
        <BoardReturn />
        <select name="vehicleId" defaultValue="" aria-label="Combi para sumar al vuelo">
          <option value="" disabled>{row.units.length ? "Sumar otra combi…" : "Elegir combi…"}</option>
          {free.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <button className="ghost-button" type="submit">{row.units.length ? "Sumar" : "Asignar"}</button>
      </FleetAssignmentForm>
</div>
    </div>
  );
}

function ChapelcoUnits({ row, dateKey, vehicleOptions, driverOptions, withCurrent }: UnitProps) {
  const free = vehicleOptions.filter((option) => !row.units.some((unit) => unit.vehicleId === option.id));
  return (
    <div className="sd-units">
      {row.units.map((unit) => (
        <div className="sd-unit" key={unit.id}>
          <UnitHead unit={unit} />
          <DriverForm unit={unit} action={setChapelcoDriverAction} dateKey={dateKey} options={withCurrent(driverOptions, unit.driverId, unit.driverName)} />
          <form action={releaseChapelcoVehicle} className="sd-remove">
            <input type="hidden" name="id" value={unit.id} />
            <BoardReturn />
            <button className="text-button" type="submit" aria-label={`Quitar ${unit.vehicleName} de Chapelco`}>Quitar</button>
          </form>
        </div>
      ))}
      <div className="sd-sumar" data-campos="1">
<FleetAssignmentForm action={assignChapelcoVehicle}>
        <input type="hidden" name="routeId" value={row.serviceId} />
        <input type="hidden" name="serviceDate" value={dateKey} />
        <BoardReturn />
        <select name="vehicleId" defaultValue="" aria-label="Nave para sumar a Chapelco">
          <option value="" disabled>{row.units.length ? "Sumar otra nave…" : "Elegir nave…"}</option>
          {free.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <button className="ghost-button" type="submit">{row.units.length ? "Sumar" : "Asignar"}</button>
      </FleetAssignmentForm>
</div>
    </div>
  );
}

function UnitsReadOnly({ units, note }: { units: BoardUnit[]; note: ReactNode }) {
  return (
    <div className="sd-units">
      {units.length ? units.map((unit) => (
        <div className="sd-unit" key={unit.id}>
          <UnitHead unit={unit} />
          <p className={unit.driverName ? "sd-driver-name" : "sd-driver-name is-missing"}>{unit.driverName ?? "Sin chofer"}</p>
        </div>
      )) : <p className="sd-driver-name is-missing">Sin nave asignada</p>}
      <p className="muted sd-note">{note}</p>
    </div>
  );
}

const timeFormat = (date?: Date) => (date ? hourFormat.format(date) : "");
const dayKeyAr = (date: Date) => localDateKey(date);
const shortDayFormat = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", timeZone: "America/Argentina/Salta" });
/** «08:00–18:00», o con el día cuando la nave queda ocupada varios días: «jue 19 08:00 → lun 23 20:00». */
function blockLabel(from?: Date, to?: Date) {
  if (!from || !to || dayKeyAr(from) === dayKeyAr(to)) return `${timeFormat(from)}–${timeFormat(to)}`;
  const day = (date: Date) => shortDayFormat.format(date).replace(",", "").replace(".", "");
  return `${day(from)} ${timeFormat(from)} → ${day(to)} ${timeFormat(to)}`;
}

/** Rutas: las naves de la salida, cada una con su chofer; abajo, sumar otra nave a la salida. */
function RouteUnits({ row, dateKey, vehicleOptions, driverOptions, withCurrent }: UnitProps) {
  return (
    <div className="sd-units">
      {row.units.map((unit) => (
        <div className="sd-route-unit" key={unit.id}>
          <ScheduleCrewForm
            scheduleId={unit.id}
            unitKind={unit.unitKind ?? "PRIMARY"}
            dateKey={dateKey}
            vehicleId={unit.vehicleId}
            driverId={unit.driverId}
            vehicles={withCurrent(vehicleOptions, unit.vehicleId, unit.vehicleName)}
            drivers={withCurrent(driverOptions, unit.driverId, unit.driverName)}
          />
          <p className="sd-unit-meta">
            {row.units.length > 1 ? <span>{unit.passengers !== undefined ? `${unit.passengers} de ` : ""}{unit.seats} lug.</span> : null}
            {unit.status && !row.status ? <span className="pill pill-estado" data-tono="grave">{unit.status}</span> : null}
            {unit.editHref ? <Link href={unit.editHref}>Editar</Link> : null}
            {unit.removable ? (
              <form action={removeBoardScheduleAction} className="sd-remove">
                <input type="hidden" name="id" value={unit.id} />
                <input type="hidden" name="kind" value={unit.unitKind ?? "PRIMARY"} />
                <input type="hidden" name="date" value={dateKey} />
                <button className="text-button" type="submit" aria-label={`Quitar la nave ${unit.vehicleName} de la salida`}>Quitar</button>
              </form>
            ) : null}
          </p>
        </div>
      ))}
      {/* Sumar otra nave a la misma salida: el cupo pasa a ser la suma de los asientos de todas. */}
      <div className="sd-sumar" data-campos="3">
<FleetAssignmentForm action={addBoardUnitAction}>
        <input type="hidden" name="date" value={dateKey} />
        <input type="hidden" name="scheduleId" value={row.serviceId} />
        <select name="vehicleId" defaultValue="" aria-label="Nave para sumar a la salida" required>
          <option value="" disabled>{row.units.length ? "Sumar otra nave…" : "Elegir nave…"}</option>
          {vehicleOptions.filter((option) => !row.units.some((unit) => unit.vehicleId === option.id)).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select name="driverId" defaultValue="" aria-label="Chofer de la nave nueva">
          <option value="">Sin chofer</option>
          {driverOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <button className="ghost-button" type="submit">{row.units.length ? "Sumar" : "Asignar"}</button>
      </FleetAssignmentForm>
</div>
    </div>
  );
}

/** Viajes especiales: chofer de cada nave, quitar, y sumar otra nave con su horario. */
function SpecialUnits({ row, dateKey, vehicleOptions, driverOptions, withCurrent }: UnitProps) {
  const first = row.units[0];
  return (
    <div className="sd-units">
      {row.units.map((unit) => (
        <div className="sd-unit" key={unit.id}>
          <p className="sd-unit-name"><strong>{unit.vehicleName}</strong> <span className="muted">{blockLabel(unit.from, unit.to)}</span></p>
          <DriverForm unit={unit} action={setSpecialDriverAction} dateKey={dateKey} options={withCurrent(driverOptions, unit.driverId, unit.driverName)} />
          <form action={removeSpecialVehicleAction} className="sd-remove">
            <input type="hidden" name="id" value={unit.id} />
            <input type="hidden" name="date" value={dateKey} />
            <button className="text-button" type="submit" aria-label={`Quitar ${unit.vehicleName} del viaje`}>Quitar</button>
          </form>
        </div>
      ))}
      <div className="sd-sumar" data-campos="4">
<FleetAssignmentForm action={addSpecialVehicleAction}>
        <input type="hidden" name="tripId" value={row.serviceId} />
        <input type="hidden" name="date" value={dateKey} />
        <select name="vehicleId" defaultValue="" aria-label="Nave para sumar al viaje" required>
          <option value="" disabled>{row.units.length ? "Sumar otra nave…" : "Elegir nave…"}</option>
          {vehicleOptions.filter((option) => !row.units.some((unit) => unit.vehicleId === option.id)).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select name="driverId" defaultValue="" aria-label="Chofer de la nave nueva">
          <option value="">Sin chofer</option>
          {driverOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <span className="sd-window">
          <input type="time" name="from" defaultValue={timeFormat(first?.from) || "08:00"} aria-label="Desde" required />
          <input type="time" name="to" defaultValue={timeFormat(first?.to) || "18:00"} aria-label="Hasta" required />
        </span>
        <button className="ghost-button" type="submit">{row.units.length ? "Sumar" : "Asignar"}</button>
      </FleetAssignmentForm>
</div>
    </div>
  );
}


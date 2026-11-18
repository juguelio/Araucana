import type { ReactNode } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import type { AppRole } from "@/lib/auth/roles";
import { DispatchDesk, DropSelect, OriginField, ServiceDisclosure } from "./dispatch-desk";
import { LogoutButton } from "../logout-button";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import { butacasParaAeropuerto, pasajerosOcupados } from "@/lib/airport/booking";
import { airportPickupStart } from "@/lib/airport/pickup-start";
import { VUELOS_QUE_NO_SE_OFRECEN } from "@/lib/airport/offered-flights";
import { CHAPELCO_BOOKING_MODE, chapelcoActiveReservationStatuses } from "@/lib/chapelco/constants";
import { buildDayBoard, dayRange, isDateKey, localDateKey, shiftDateKey, type BoardArea, type BoardRow, type BoardUnit } from "@/lib/operations/day-board";
import { ReplaceVehicleForm } from "./replace-vehicle-form";
import { FleetAssignmentForm } from "../fleet-assignment-form";
import { assignVehicleAction, removeAssignmentAction } from "../aeropuerto/actions";
import { assignChapelcoVehicle, releaseChapelcoVehicle } from "../chapelco/actions";
import { addBoardUnitAction, addSpecialVehicleAction, createBoardScheduleAction, removeBoardScheduleAction, removeSpecialVehicleAction, setAirportDriverAction, setChapelcoDriverAction, setSpecialDriverAction } from "./actions";
import { ScheduleCrewForm, type Option } from "./crew-form";
import { BOARD_RETURN_FIELD, BOARD_RETURN_VALUE } from "./return-to";
import "./salidas-del-dia.css";
import "./panel-jornada.css";

export type DayParams = { date?: string; falta?: string; notice?: string };

const AREA_LABEL: Record<BoardArea, string> = { RUTA: "Ruta", AEROPUERTO: "Aeropuerto", CHAPELCO: "Chapelco", ESPECIAL: "Viaje especial" };
const ACTIVE_RESERVATION = { notIn: ["CANCELLED"] };

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

export async function DayWorkspace({ user, params, panel = false }: { user: { role: AppRole }; params?: DayParams; panel?: boolean }) {
  const path = panel ? "/admin" : "/admin/salidas-del-dia";
  const canEditRoutes = isAdminRole(user.role);
  const today = localDateKey(new Date());
  const dateKey = isDateKey(params?.date) ? params.date : today;
  const onlyMissing = params?.falta === "1";
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
      where: { scheduledAt: { gte: from, lt: to }, number: { notIn: [...VUELOS_QUE_NO_SE_OFRECEN] } },
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
          include: { vehicleDuties: { where: { status: "ACTIVE" }, include: { runs: { select: { id: true, direction: true, ascentSlot: true }, orderBy: { sequence: "asc" } }, vehicle: { select: { id: true, name: true } }, driver: { select: DRIVER_SELECT } } } }
        },
        directReservations: {
          where: { bookingMode: CHAPELCO_BOOKING_MODE, status: { in: [...chapelcoActiveReservationStatuses] }, chapelcoDetails: { serviceDate } },
          select: { passengerCount: true, chapelcoDetails: { select: { ascentSlot: true } } }
        }
      }
    }),
    prisma.specialTrip.findMany({
      where: { serviceDate, status: { not: "CANCELLED" } },
      include: { assignments: { orderBy: { startsAt: "asc" }, include: { vehicle: { select: VEHICLE_SELECT }, driver: { select: DRIVER_SELECT } } } }
    }),
    prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { ...VEHICLE_SELECT, internalNumber: true, publicTransport: true, kind: true } }),
    prisma.user.findMany({ where: { role: "DRIVER", isActive: true }, orderBy: [{ name: "asc" }, { email: "asc" }], select: DRIVER_SELECT }),
    // Rutas con salidas propias, para crear una desde el tablero (aeropuerto y Chapelco tienen su lógica).
    prisma.travelRoute.findMany({
      where: { bookingMode: { notIn: ["AIRPORT", CHAPELCO_BOOKING_MODE] } },
      orderBy: [{ isActive: "desc" }, { from: "asc" }, { to: "asc" }],
      select: { id: true, from: true, to: true, isActive: true, durationMin: true, bookingMode: true }
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
      vehicle: { id: schedule.vehicle.id, name: schedule.vehicle.name, seats: seatsOf(schedule.vehicle) },
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
      const slots = [
        ...route.directReservations.map(reservation => reservation.chapelcoDetails?.ascentSlot),
        ...(day?.vehicleDuties ?? []).flatMap(duty => duty.runs.filter(run => run.direction === "UP").map(run => run.ascentSlot))
      ].filter((slot): slot is string => !!slot).sort();
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
    specialTrips: specialTrips.map((trip) => ({
      id: trip.id,
      client: trip.client,
      passengers: trip.passengers,
      status: trip.status,
      firstLegAt: null,
      units: trip.assignments.map((assignment) => ({
        id: assignment.id,
        startsAt: assignment.startsAt,
        endsAt: assignment.endsAt,
        vehicle: { id: assignment.vehicle.id, name: assignment.vehicle.name, seats: seatsOf(assignment.vehicle) },
        driver: assignment.driver
      }))
    }))
  });

  const pendingRows = board.rows.filter(row => row.missingVehicle || row.missingDriver || row.overbooked);
  const rows = onlyMissing ? pendingRows : board.rows;
  const vehicleOptions: VehicleOption[] = vehicles.map((vehicle) => ({
    id: vehicle.id, seats: seatsOf(vehicle), publicTransport: vehicle.publicTransport, kind: vehicle.kind,
    label: `${vehicle.name}${vehicle.internalNumber ? ` · Int. ${vehicle.internalNumber}` : ""} · ${seatsOf(vehicle)} lug.`
  }));
  const driverOptions: Option[] = drivers.map((driver) => ({ id: driver.id, label: driver.name?.trim() || driver.email }));
  // Un chofer o una nave que quedaron inactivos siguen apareciendo donde ya estaban asignados.
  const withCurrent = (options: Option[], id: string | null, label: string | null) =>
    id && !options.some((option) => option.id === id) ? [{ id, label: `${label ?? id} (inactivo)` }, ...options] : options;
  const routeOptions: Option[] = routes.map((route) => ({ id: route.id, label: `${route.from} → ${route.to}${route.isActive ? "" : " (inactiva)"}` }));
  const arrivalBySchedule = new Map(schedules.map(s => [s.id, s.arrivalAt.getTime()]));
  const runsByDuty = new Map(chapelcoRoutes.flatMap(route =>
    route.chapelcoOperationDays.flatMap(day => day.vehicleDuties.map(duty => [duty.id, duty.runs] as const))
  ));
  const assignments = board.rows.flatMap(row => row.units.flatMap(unit => {
    const item = {
      key: unit.id, title: row.title, area: AREA_LABEL[row.area], href: row.href,
      vehicleId: unit.vehicleId, driverId: unit.driverId,
      start: (unit.from ?? row.at)?.getTime() ?? null,
      end: unit.to?.getTime() ?? arrivalBySchedule.get(unit.scheduleId ?? "") ?? null
    };
    if (row.area !== "CHAPELCO") return [item];
    const runs = runsByDuty.get(unit.id) ?? [];
    if (!runs.length) return [{ ...item, start: null }];
    return runs.map(run => ({
      ...item, key: run.id, title: run.direction === "UP" ? "Subida al cerro" : "Bajada del cerro",
      start: run.ascentSlot ? Date.parse(`${dateKey}T${run.ascentSlot}:00-03:00`) : null
    }));
  }));
  const dayHref = (key: string) => `${path}?date=${key}${onlyMissing ? "&falta=1" : ""}`;

  const dateForm = (
    <form className="sd-date" action={path}>
      <input type="date" name="date" defaultValue={dateKey} aria-label="Fecha" />
      {onlyMissing ? <input type="hidden" name="falta" value="1" /> : null}
      <button className="ghost-button" type="submit">Ver</button>
    </form>
  );

  return (
    <AdminShell
      title={panel ? "Panel de operaciones" : "Salidas del día"}
      eyebrow="Operación"
      role={user.role}
      action={
        <nav className="sd-days" aria-label="Elegir el día">
          <Link className="ghost-button" href={dayHref(shiftDateKey(dateKey, -1))} aria-label="Día anterior">‹</Link>
          <Link className={`ghost-button${dateKey === today ? " is-active" : ""}`} href={dayHref(today)}>Hoy</Link>
          {!panel && <Link className={`ghost-button${dateKey === shiftDateKey(today, 1) ? " is-active" : ""}`} href={dayHref(shiftDateKey(today, 1))}>Mañana</Link>}
          <Link className="ghost-button" href={dayHref(shiftDateKey(dateKey, 1))} aria-label="Día siguiente">›</Link>
          {panel ? <details className="plan-calendar">
            <summary>Elegir fecha</summary>
            {dateForm}
          </details> : dateForm}
        </nav>
      }
    >
      {params?.notice ? <p className="admin-notice" role="status">{params.notice}</p> : null}

      {panel ? <section className="plan-heading">
        <div>
          <h2>{dayTitle(dateKey, today)}</h2>
          <p>{board.summary.services} {board.summary.services === 1 ? "servicio" : "servicios"} · {board.summary.passengers} {board.summary.passengers === 1 ? "pasajero" : "pasajeros"}</p>
        </div>
        <nav className="plan-filters" aria-label="Filtrar servicios">
          <Link aria-current={!onlyMissing ? "page" : undefined} href={`${path}?date=${dateKey}`}>Todos</Link>
          <Link aria-current={onlyMissing ? "page" : undefined} href={`${path}?date=${dateKey}&falta=1`}>Pendientes <b>{pendingRows.length}</b></Link>
        </nav>
      </section> : (
      <section className="sd-head">
        <div>
          <h2>{dayTitle(dateKey, today)}</h2>
          <p className="muted">Todos los servicios del día con su nave y su chofer: rutas, aeropuerto, Chapelco y viajes especiales, por la hora en que sale la unidad.</p>
        </div>
        <dl className="sd-summary">
          <div><dt>Servicios</dt><dd>{board.summary.services}</dd></div>
          <div><dt>Pasajeros</dt><dd>{board.summary.passengers}</dd></div>
          <div data-alerta={board.summary.missingVehicle > 0 || undefined}><dt>Sin nave</dt><dd>{board.summary.missingVehicle}</dd></div>
          <div data-alerta={board.summary.missingDriver > 0 || undefined}><dt>Sin chofer</dt><dd>{board.summary.missingDriver}</dd></div>
          <div data-alerta={board.summary.overbooked > 0 || undefined}><dt>Sobrecupo</dt><dd>{board.summary.overbooked}</dd></div>
        </dl>
        <div className="sd-filter">
          <Link className={`pill${!onlyMissing ? " is-active" : ""}`} href={`${path}?date=${dateKey}`}>Todos</Link>
          <Link className={`pill${onlyMissing ? " is-active" : ""}`} href={`${path}?date=${dateKey}&falta=1`}>Sólo lo que falta asignar</Link>
        </div>
      </section>)}

      <DispatchDesk key={dateKey} dateKey={dateKey} panel={panel} vehicles={vehicleOptions} drivers={driverOptions} assignments={assignments} actions={
      <details name={panel ? "panel-menu" : undefined} className="plain-card sd-add">
        <summary>
          <strong>{panel ? "Agregar servicio" : "Agregar al día"}</strong>
          {!panel && <span className="muted">salida de ruta, vuelo, reserva, viaje especial, nave o chofer</span>}
        </summary>
        <div className="sd-add-body">
          {canEditRoutes ? (
            <div className="sd-add-form">
              <h3>Salida de ruta</h3>
              <FleetAssignmentForm action={createBoardScheduleAction}>
        <OriginField />
                <input type="hidden" name="date" value={dateKey} />
                <label><span>Ruta</span>
                  <select name="routeId" defaultValue="" required>
                    <option value="" disabled>Elegir ruta…</option>
                    {routeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <label><span>Sale</span><input type="time" name="time" required /></label>
                <label><span>Nave</span>
                  <DropSelect name="vehicleId" defaultValue="" required>
                    <option value="" disabled>Elegir nave…</option>
                    {vehicleOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </DropSelect>
                </label>
                <label><span>Chofer</span>
                  <DropSelect name="driverId" defaultValue="">
                    <option value="">Sin chofer</option>
                    {driverOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </DropSelect>
                </label>
                <button className="button" type="submit">Crear salida</button>
              </FleetAssignmentForm>
              <p className="muted sd-note">La llegada se calcula con la duración de la ruta. Para cambiarla, después tocás «Editar».</p>
            </div>
          ) : null}
          <div className="sd-add-links">
            <h3>Otros</h3>
            <Link className="ghost-button" href={`/admin/aeropuerto?date=${dateKey}`}>Cargar vuelo a mano</Link>
            <Link className="ghost-button" href={`/admin/aeropuerto/reservar?date=${dateKey}`}>Reserva de aeropuerto</Link>
            <Link className="ghost-button" href="/admin/viajes-especiales/nuevo">Viaje especial</Link>
            {canEditRoutes ? <Link className="ghost-button" href="/admin/naves/nueva">Nave nueva</Link> : null}
            {canEditRoutes ? <Link className="ghost-button" href="/admin/choferes/nueva">Chofer nuevo</Link> : null}
          </div>
        </div>
      </details>
      } shortcuts={panel && <details name="panel-menu" className="plan-shortcuts">
        <summary>Atajos</summary>
        <nav aria-label="Atajos de operación">
          <Link href="/admin/reservas/nueva">Nueva reserva</Link>
          <Link href={`/admin/aeropuerto/reservar?date=${dateKey}`}>Reserva de aeropuerto</Link>
          <Link href={`/admin/aeropuerto?date=${dateKey}`}>Vuelos del día</Link>
          <Link href={`/admin/chapelco?date=${dateKey}`}>Cerro del día</Link>
          <Link href="/admin?vista=comercial">Cobros y comprobantes</Link>
          <LogoutButton />
        </nav>
      </details>}>
      {rows.length === 0 ? (
        <p className="plain-card sd-empty">
          {onlyMissing && board.rows.length ? "Todo lo del día tiene nave y chofer." : "No hay servicios cargados para este día."}
        </p>
      ) : (
        <div className={panel ? "plan-sheet" : undefined}>
        {panel && <div className="plan-columns" aria-hidden="true"><span>Hora</span><span>Servicio</span><span>Equipo asignado</span><span>Pasajeros</span><span /></div>}
        <ol className="sd-list">
          {rows.map((row) => (
            <li
              key={row.key}
              className="sd-row"
              data-area={row.area}
              data-falta={row.missingVehicle || row.missingDriver || row.overbooked || undefined}
            >
              <ServiceDisclosure panel={panel} summary={panel && <ServiceSummary row={row} />}>
              {panel ? <div className="plan-detail-links">
                <Link href={row.href}>Ver servicio</Link>
                {row.editHref !== row.href && <Link href={row.editHref}>Editar servicio</Link>}
              </div> : <>
              <div className="sd-time">
                <strong>{row.at ? hourFormat.format(row.at) : "—"}</strong>
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
                {row.area !== "RUTA" && row.detail ? <p className="muted">{row.detail}</p> : null}
                {row.units.length > 0 && <p className="muted">{row.units.length === 1 ? "1 nave asignada" : `${row.units.length} naves asignadas`}</p>}
                {row.area !== "RUTA" ? (
                  <p className="sd-links"><Link href={row.editHref}>{row.area === "CHAPELCO" ? "Ver el día" : "Editar"}</Link></p>
                ) : null}
              </div>

              <div className="sd-pax">
                <strong>{row.passengers}</strong>
                <span>{row.capacity !== null ? `de ${row.capacity} lugares` : "pasajeros"}</span>
              </div>

              </>}
              <div className="sd-assign">
                {row.area === "RUTA" ? (
                  canEditRoutes ? (
                    <RouteUnits publicRoute={routes.find(r => r.id === row.routeId)?.bookingMode === "SEATED"} row={row} dateKey={dateKey} vehicleOptions={vehicleOptions} driverOptions={driverOptions} withCurrent={withCurrent} />
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
              </ServiceDisclosure>
            </li>
          ))}
        </ol>
        </div>
      )}

      {driverOptions.length === 0 ? (
        <p className="muted sd-footnote">No hay choferes activos: se cargan en <Link href="/admin/choferes">Choferes</Link>.</p>
      ) : null}
      </DispatchDesk>
    </AdminShell>
  );
}

function ServiceSummary({ row }: { row: BoardRow }) {
  const first = row.units[0];
  const count = row.units.length;
  return <>
    <span className="plan-time"><strong>{row.at ? hourFormat.format(row.at) : "—"}</strong><small>{row.atLabel}</small></span>
    <span className="plan-service">
      <small>{AREA_LABEL[row.area]}</small>
      <strong>{row.title}</strong>
      {row.detail && row.area !== "RUTA" && <span className="plan-detail">{row.detail}</span>}
      {(row.status || row.missingDriver || row.overbooked || row.missingVehicle) && <span className="plan-alert">
        {[row.status, row.missingVehicle && "Falta nave", row.missingDriver && "Falta chofer", row.overbooked && "Sobrecupo"].filter(Boolean).join(" · ")}
      </span>}
    </span>
    <span className="plan-crew">
      <strong>{count > 1 ? `${count} naves asignadas` : first?.vehicleName ?? "Sin asignar"}</strong>
      {first && <small>{count === 1 ? first.driverName : row.units.map(unit => unit.vehicleName).join(" · ")}</small>}
    </span>
    <span className="plan-load">{row.passengers}{row.capacity !== null && <small> / {row.capacity}</small>}<span className="plan-mobile-label"> pasajeros</span></span>
    <span className="plan-chevron" aria-hidden="true">⌄</span>
  </>;
}

type VehicleOption = Option & { seats: number; publicTransport: boolean; kind: string };

type UnitProps = {
  row: BoardRow;
  dateKey: string;
  vehicleOptions: VehicleOption[];
  driverOptions: Option[];
  withCurrent: (options: Option[], id: string | null, label: string | null) => Option[];
};

const BoardReturn = () => <input type="hidden" name={BOARD_RETURN_FIELD} value={BOARD_RETURN_VALUE} />;

function DriverForm({ unit, action, dateKey, options }: { unit: BoardUnit; action: (formData: FormData) => Promise<void>; dateKey: string; options: Option[] }) {
  return (
    <form action={action} className="sd-driver">
        <OriginField />
      <input type="hidden" name="id" value={unit.id} />
      <input type="hidden" name="date" value={dateKey} />
      <DropSelect name="driverId" defaultValue={unit.driverId ?? ""} aria-label={`Chofer de ${unit.vehicleName}`} data-falta={!unit.driverId || undefined}>
        <option value="">Sin chofer</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </DropSelect>
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
      {/* Sólo las naves que el vuelo todavía no tiene: volver a «agregar» una ya asignada le borraría el chofer. */}
      <div className="sd-sumar" data-campos="1">
        <FleetAssignmentForm action={assignVehicleAction}>
        <OriginField />
        <input type="hidden" name="flightId" value={row.serviceId} />
        <BoardReturn />
        <DropSelect name="vehicleId" defaultValue="" aria-label="Combi para sumar al vuelo">
          <option value="" disabled>{row.units.length ? "Sumar otra combi…" : "Elegir combi…"}</option>
          {free.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </DropSelect>
        <button className="ghost-button" type="submit">{row.units.length ? "Sumar" : "Asignar"}</button>
      </FleetAssignmentForm>
      </div>
      {row.units.map((unit) => (
        <div className="sd-unit" key={unit.id}>
          <UnitHead unit={unit} />
          <DriverForm unit={unit} action={setAirportDriverAction} dateKey={dateKey} options={withCurrent(driverOptions, unit.driverId, unit.driverName)} />
          <form action={removeAssignmentAction} className="sd-remove">
        <OriginField />
            <input type="hidden" name="id" value={unit.id} />
            <BoardReturn />
            <button className="text-button" type="submit" aria-label={`Quitar ${unit.vehicleName} del vuelo`}>Quitar</button>
          </form>
        </div>
      ))}
    </div>
  );
}

function ChapelcoUnits({ row, dateKey, vehicleOptions, driverOptions, withCurrent }: UnitProps) {
  const free = vehicleOptions.filter((option) => !row.units.some((unit) => unit.vehicleId === option.id));
  return (
    <div className="sd-units">
      <div className="sd-sumar" data-campos="1">
        <FleetAssignmentForm action={assignChapelcoVehicle}>
        <OriginField />
        <input type="hidden" name="routeId" value={row.serviceId} />
        <input type="hidden" name="serviceDate" value={dateKey} />
        <BoardReturn />
        <DropSelect name="vehicleId" defaultValue="" aria-label="Nave para sumar a Chapelco">
          <option value="" disabled>{row.units.length ? "Sumar otra nave…" : "Elegir nave…"}</option>
          {free.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </DropSelect>
        <button className="ghost-button" type="submit">{row.units.length ? "Sumar" : "Asignar"}</button>
      </FleetAssignmentForm>
      </div>
      {row.units.map((unit) => (
        <div className="sd-unit" key={unit.id}>
          <UnitHead unit={unit} />
          <DriverForm unit={unit} action={setChapelcoDriverAction} dateKey={dateKey} options={withCurrent(driverOptions, unit.driverId, unit.driverName)} />
          <form action={releaseChapelcoVehicle} className="sd-remove">
        <OriginField />
            <input type="hidden" name="id" value={unit.id} />
            <BoardReturn />
            <button className="text-button" type="submit" aria-label={`Quitar ${unit.vehicleName} de Chapelco`}>Quitar</button>
          </form>
        </div>
      ))}
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

/** Rutas: las naves de la salida, cada una con su chofer; abajo, sumar otra nave a la salida. */
function RouteUnits({ row, dateKey, vehicleOptions, driverOptions, withCurrent, publicRoute }: UnitProps & { publicRoute: boolean }) {
  return (
    <div className="sd-units">
      {/* Sumar otra nave a la misma salida: el cupo pasa a ser la suma de los asientos de todas. */}
      <div className="sd-sumar" data-campos="3">
        <FleetAssignmentForm action={addBoardUnitAction}>
        <OriginField />
        <input type="hidden" name="date" value={dateKey} />
        <input type="hidden" name="scheduleId" value={row.serviceId} />
        <DropSelect name="vehicleId" defaultValue="" aria-label="Nave para sumar a la salida" required>
          <option value="" disabled>Sumar otra nave…</option>
          {vehicleOptions.filter((option) => !row.units.some((unit) => unit.vehicleId === option.id)).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </DropSelect>
        <DropSelect name="driverId" defaultValue="" aria-label="Chofer de la nave nueva">
          <option value="">Sin chofer</option>
          {driverOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </DropSelect>
        <button className="ghost-button" type="submit">Sumar</button>
      </FleetAssignmentForm>
      </div>
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
          <ReplaceVehicleForm key={unit.vehicleId}
            scheduleId={unit.scheduleId ?? row.serviceId}
            outgoing={unit}
            passengers={row.units.find(other => other.unitKind === "PRIMARY" && other.scheduleId === unit.scheduleId)?.passengers ?? row.passengers}
            keptSeats={row.units.filter(other => other.scheduleId === unit.scheduleId && other.id !== unit.id)
              .reduce((sum, other) => sum + (vehicleOptions.find(v => v.id === other.vehicleId)?.seats ?? 0), 0)}
            vehicles={vehicleOptions.filter(v => v.seats > 0 && v.kind !== "UTILITARIO" && (!publicRoute || v.publicTransport) && !row.units.some(other => other.vehicleId === v.id))}
            drivers={driverOptions}
            date={dateKey}
          />
          <div className="sd-unit-meta">
            {row.units.length > 1 ? <span>{unit.passengers !== undefined ? `${unit.passengers} de ` : ""}{unit.seats} lug.</span> : null}
            {unit.status && !row.status ? <span className="pill pill-estado" data-tono="grave">{unit.status}</span> : null}
            {unit.editHref ? <Link href={unit.editHref}>Editar</Link> : null}
            {unit.removable ? (
              <form action={removeBoardScheduleAction} className="sd-remove">
        <OriginField />
                <input type="hidden" name="id" value={unit.id} />
                <input type="hidden" name="kind" value={unit.unitKind ?? "PRIMARY"} />
                <input type="hidden" name="date" value={dateKey} />
                <button className="text-button" type="submit" aria-label={`Quitar la nave ${unit.vehicleName} de la salida`}>Quitar</button>
              </form>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Viajes especiales: chofer de cada nave, quitar, y sumar otra nave con su horario. */
function SpecialUnits({ row, dateKey, vehicleOptions, driverOptions, withCurrent }: UnitProps) {
  const first = row.units[0];
  return (
    <div className="sd-units">
      <div className="sd-sumar" data-campos="4">
        <FleetAssignmentForm action={addSpecialVehicleAction}>
        <OriginField />
        <input type="hidden" name="tripId" value={row.serviceId} />
        <DropSelect name="vehicleId" defaultValue="" aria-label="Nave para sumar al viaje" required>
          <option value="" disabled>{row.units.length ? "Sumar otra nave…" : "Elegir nave…"}</option>
          {vehicleOptions.filter((option) => !row.units.some((unit) => unit.vehicleId === option.id)).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </DropSelect>
        <DropSelect name="driverId" defaultValue="" aria-label="Chofer de la nave nueva">
          <option value="">Sin chofer</option>
          {driverOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </DropSelect>
        <span className="sd-window">
          <input type="time" name="from" defaultValue={timeFormat(first?.from) || "08:00"} aria-label="Desde" required />
          <input type="time" name="to" defaultValue={timeFormat(first?.to) || "18:00"} aria-label="Hasta" required />
        </span>
        <button className="ghost-button" type="submit">{row.units.length ? "Sumar" : "Asignar"}</button>
      </FleetAssignmentForm>
      </div>
      {row.units.map((unit) => (
        <div className="sd-unit" key={unit.id}>
          <p className="sd-unit-name"><strong>{unit.vehicleName}</strong> <span className="muted">{timeFormat(unit.from)}–{timeFormat(unit.to)}</span></p>
          <DriverForm unit={unit} action={setSpecialDriverAction} dateKey={dateKey} options={withCurrent(driverOptions, unit.driverId, unit.driverName)} />
          <form action={removeSpecialVehicleAction} className="sd-remove">
        <OriginField />
            <input type="hidden" name="id" value={unit.id} />
            <input type="hidden" name="date" value={dateKey} />
            <button className="text-button" type="submit" aria-label={`Quitar ${unit.vehicleName} del viaje`}>Quitar</button>
          </form>
        </div>
      ))}
    </div>
  );
}

import { CHAPELCO_BOOKING_MODE } from "@/lib/chapelco/constants";
import { Deadlines } from "./deadlines";
import { WeekAgenda } from "./week-agenda";
import { assignSchoolCrew, repeatSchoolRun } from "./school-crew";
import { readDispatchDays, VEHICLE_SELECT, DRIVER_SELECT, seatsOf } from "@/lib/operations/dispatch-days";
import type { ReactNode } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import type { AppRole } from "@/lib/auth/roles";
import { DispatchDesk, DropSelect, OriginField, ServiceDisclosure } from "./dispatch-desk";
import { LogoutButton } from "../logout-button";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import { AREA_LABEL, personName, dayRange, isDateKey, localDateKey, shiftDateKey, type BoardRow, type BoardUnit } from "@/lib/operations/day-board";
import { countAdminReservations } from "@/lib/booking/repository";
import { estadoDeTaller } from "@/lib/vehicles/estado-en-flota";
import { daniosPorNave, dispatchIssues, panelServiceHref, serviceReservationScope, type DispatchAssignment } from "@/lib/operations/dispatch";
import { ReservationWorkspace, type ReservationParams } from "../reservas/reservation-workspace";
import { FleetAgenda } from "./fleet-agenda";
import { ReplaceVehicleForm } from "./replace-vehicle-form";
import { FleetAssignmentForm } from "../fleet-assignment-form";
import { assignVehicleAction, removeAssignmentAction } from "../aeropuerto/actions";
import { assignChapelcoVehicle, releaseChapelcoVehicle } from "../chapelco/actions";
import { addBoardUnitAction, addSpecialVehicleAction, createBoardScheduleAction, removeBoardScheduleAction, removeSpecialVehicleAction, setChapelcoDriverAction, setSpecialDriverAction } from "./actions";
import { ScheduleCrewForm, type Option } from "./crew-form";
import { BOARD_RETURN_FIELD, BOARD_RETURN_VALUE } from "./return-to";
import "./salidas-del-dia.css";
import "./panel-jornada.css";

export type DayParams = ReservationParams & { falta?: string; vista?: string; servicio?: string; area?: string; tipo?: string; libres?: string; recurso?: string; filtro?: string };

const hourFormat = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Salta" });
const dayFormat = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function dayTitle(dateKey: string, today: string) {
  const label = dayFormat.format(new Date(`${dateKey}T12:00:00Z`));
  const prefix = dateKey === today ? "Hoy" : dateKey === shiftDateKey(today, 1) ? "Mañana" : dateKey === shiftDateKey(today, -1) ? "Ayer" : null;
  return prefix ? `${prefix}, ${label}` : label.charAt(0).toUpperCase() + label.slice(1);
}

export async function DayWorkspace({ user, params, panel = false }: { user: { role: AppRole }; params?: DayParams; panel?: boolean }) {
  const path = panel ? "/admin" : "/admin/salidas-del-dia";
  const canEditRoutes = isAdminRole(user.role);
  const today = localDateKey(new Date());
  const dateKey = isDateKey(params?.date) ? params.date : today;
  const view = panel && (params?.vista === "reservas" || params?.vista === "flota" || params?.vista === "semana" || params?.vista === "vencimientos") ? params.vista : "jornada";
  const onlyMissing = view === "jornada" && params?.falta === "1";
  const area = panel && params?.area && Object.hasOwn(AREA_LABEL, params.area) ? params.area : "";
  const search = panel ? (params?.q ?? "").trim().slice(0, 100) : "";
  const { to } = dayRange(dateKey);

  const [days, vehicles, drivers, routes, damages, pendingPayments, pendingTrips] = await Promise.all([
    readDispatchDays(dateKey, view === "semana" ? 7 : 1),
    prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { ...VEHICLE_SELECT, internalNumber: true, publicTransport: true, kind: true } }),
    prisma.user.findMany({ where: { role: "DRIVER", isActive: true }, orderBy: [{ name: "asc" }, { email: "asc" }], select: DRIVER_SELECT }),
    // Rutas con salidas propias, para crear una desde el tablero (aeropuerto y Chapelco tienen su lógica).
    prisma.travelRoute.findMany({
      where: { bookingMode: { notIn: ["AIRPORT", CHAPELCO_BOOKING_MODE] } },
      orderBy: [{ isActive: "desc" }, { from: "asc" }, { to: "asc" }],
      select: { id: true, from: true, to: true, isActive: true, durationMin: true, bookingMode: true }
    }),
    panel ? prisma.vehicleDamage.findMany({
      where: { status: { not: "REPARADO" }, occurredAt: { lt: to } },
      orderBy: { occurredAt: "desc" }, select: { id: true, vehicleId: true, description: true, severity: true, status: true }
    }) : [],
    panel ? countAdminReservations({ date: dateKey, payment: "pending-payment" }) : 0,
    panel ? countAdminReservations({ date: dateKey, payment: "paid-unconfirmed" }) : 0
  ]);

  const { board } = days[0];
  const serviceLinks = new Map(board.rows.map(r => [r.key, r.href]));
  const assignments = panel ? days[0].assignments : days[0].assignments.map(a => ({ ...a, href: serviceLinks.get(a.rowKey) ?? a.href }));

  // Servicios reales primero; la programación sin demanda va aparte y colapsada (issue #258).
  const serviceRows = board.rows.filter((row) => !row.programmed);
  const programmedRows = board.rows.filter((row) => row.programmed);
  const vehicleDamages = daniosPorNave(damages);
  const fleetOptions: VehicleOption[] = vehicles.map((vehicle) => ({
    id: vehicle.id, seats: seatsOf(vehicle), publicTransport: vehicle.publicTransport, kind: vehicle.kind,
    label: `${vehicle.name}${vehicle.internalNumber ? ` · Int. ${vehicle.internalNumber}` : ""} · ${seatsOf(vehicle)} lug.`
  }));
  const vehicleOptions = fleetOptions.map(option => {
    const taller = estadoDeTaller(vehicleDamages.get(option.id) ?? []);
    return taller ? { ...option, label: option.label + " · " + taller.etiqueta } : option;
  });
  const driverOptions: Option[] = drivers.map((driver) => ({ id: driver.id, label: driver.name?.trim() || driver.email }));
  // Un chofer o una nave que quedaron inactivos siguen apareciendo donde ya estaban asignados.
  const withCurrent = (options: Option[], id: string | null, label: string | null) =>
    id && !options.some((option) => option.id === id) ? [{ id, label: `${label ?? id} (inactivo)` }, ...options] : options;
  const routeOptions: Option[] = routes.map((route) => ({ id: route.id, label: `${route.from} → ${route.to}${route.isActive ? "" : " (inactiva)"}` }));
  const issues = dispatchIssues(board.rows, assignments, vehicleDamages);
  const pendingRows = panel ? board.rows.filter(row => issues.has(row.key)) : serviceRows.filter(row => row.missingVehicle || row.missingDriver || row.overbooked);
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const matchRow = (row: BoardRow) => (!area || row.area === area) && (!search || normalize([
    row.title, AREA_LABEL[row.area], row.school && personName(row.school.driver), ...row.units.flatMap(unit => [unit.vehicleName, unit.driverName, unit.coDriverName])
  ].join(" ")).includes(normalize(search)));
  const rows = (onlyMissing ? pendingRows : serviceRows).filter(matchRow);
  const programs = programmedRows.filter(matchRow);
  const dayHref = (key: string) => path + "?" + new URLSearchParams({ date: key,
    ...(view !== "jornada" ? { vista: view } : {}), ...(view === "flota" && params?.tipo === "chofer" ? { tipo: "chofer" } : {}), ...(onlyMissing ? { falta: "1" } : {})
  });
  const usedVehicles = new Set(assignments.flatMap(a => a.vehicleId ? [a.vehicleId] : []));
  const usedDrivers = new Set(assignments.flatMap(a => [a.driverId, a.coDriverId].filter(Boolean)));

  const commercialQueues = new URLSearchParams({ date: dateKey, vista: "reservas" });
  if (pendingPayments && !pendingTrips) commercialQueues.set("payment", "pending-payment");
  if (pendingTrips && !pendingPayments) commercialQueues.set("payment", "paid-unconfirmed");
  const chargeLabel = pendingPayments === 1 ? "1 cobro pendiente" : pendingPayments + " cobros pendientes";
  const tripLabel = pendingTrips === 1 ? "1 viaje por confirmar" : pendingTrips + " viajes por confirmar";
  const selectedService = view === "reservas" ? board.rows.find(row => row.key === params?.servicio) : undefined;
  const scope = selectedService && serviceReservationScope(selectedService);

  const renderRow = (row: BoardRow) => (
            <li
              key={row.key}
              id={panel ? "servicio-" + row.key : undefined}
              className="sd-row"
              data-area={row.area}
              data-sigue={row.continuing || undefined}
              data-falta={row.missingVehicle || row.missingDriver || row.overbooked || undefined}
            >
              <ServiceDisclosure panel={panel} serviceKey={row.key} initiallyOpen={params?.servicio === row.key} summary={panel && <ServiceSummary row={row} issues={issues.get(row.key)} />}>
              {panel && issues.has(row.key) && <ul className="console-issues">{issues.get(row.key)!.map(message => <li key={message}>{message}</li>)}</ul>}
              {panel ? <div className="plan-detail-links">
                {serviceReservationScope(row) && <Link href={"/admin?" + new URLSearchParams({ date: row.flightDate ?? dateKey, vista: "reservas", servicio: row.key })}>Pasajeros y cobros</Link>}
                {row.area === "AEROPUERTO" && <Link href={{ pathname: "/admin/aeropuerto/orden-de-servicio/ver", query: { date: row.flightDate ?? dateKey, flight: row.serviceId, desde: "panel" } }}>Orden de servicio</Link>}
                <Link href={row.href}>Ver servicio</Link>
                {row.editHref !== row.href && <Link href={row.editHref}>Editar servicio</Link>}
              </div> : <>
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
                {row.area !== "RUTA" && row.detail ? <p className="muted">{row.detail}</p> : null}
                {row.units.length > 0 && <p className="muted">{row.units.length === 1 ? "1 nave asignada" : `${row.units.length} naves asignadas`}</p>}
                {row.area !== "RUTA" ? (
                  <p className="sd-links"><Link href={row.editHref}>{row.area === "CHAPELCO" ? "Ver el día" : "Editar"}</Link></p>
                ) : null}
              </div>

              <div className="sd-pax">
                <strong>{row.school ? "—" : row.passengers}</strong>
                <span>{row.capacity !== null ? `de ${row.capacity} lugares` : "pasajeros"}</span>
              </div>

              </>}
              <div className="sd-assign">
                {row.area === "RUTA" ? (
                  canEditRoutes ? (
                    <RouteUnits assignments={panel ? assignments : []} publicRoute={routes.find(r => r.id === row.routeId)?.bookingMode === "SEATED"} row={row} dateKey={dateKey} vehicleOptions={vehicleOptions} driverOptions={driverOptions} withCurrent={withCurrent} />
                  ) : (
                    <UnitsReadOnly units={row.units} note="La nave y el chofer de las rutas los asigna un administrador." />
                  )
                ) : row.school ? (
                  <><form action={assignSchoolCrew} className="console-filters">
                    <OriginField /><input type="hidden" name="id" value={row.serviceId} /><input type="hidden" name="revision" value={row.school.revision} />
                    <input type="hidden" name="date" value={dateKey} />
                    <label>Nave del recorrido<DropSelect name="vehicleId" defaultValue={row.school.vehicle?.id ?? ""}><option value="">Sin nave</option>
                      {withCurrent(vehicleOptions,row.school.vehicle?.id ?? null,row.school.vehicle?.name ?? null).map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</DropSelect></label>
                    <label>Chofer del recorrido<DropSelect name="driverId" defaultValue={row.school.driver?.id ?? ""}><option value="">Sin chofer</option>
                      {withCurrent(driverOptions,row.school.driver?.id ?? null,personName(row.school.driver)).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</DropSelect></label>
                    <button className="ghost-button">Guardar equipo del día</button>
                  </form>
                  <details><summary>Repetir recorrido</summary>
                    <form action={repeatSchoolRun} className="console-filters">
                      <OriginField /><input type="hidden" name="id" value={row.serviceId} /><input type="hidden" name="revision" value={row.school.revision} /><input type="hidden" name="date" value={dateKey} />
                      <label>Desde<input type="date" name="desde" defaultValue={shiftDateKey(dateKey,1)} required /></label>
                      <label>Hasta<input type="date" name="hasta" required /></label>
                      <fieldset className="repeat-days"><legend>Días de la semana</legend>
                        {["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"].map((d,i) => <label key={d}><input type="checkbox" name="dia" value={i} defaultChecked={i === new Date(dateKey).getUTCDay()} />{d}</label>)}
                      </fieldset>
                      <label>Fechas a excluir (feriados u otras)<input name="excepto" placeholder="25/12/2026, 01/01/2027" /></label>
                      <button className="ghost-button">Crear recorridos</button>
                    </form>
                  </details></>
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
  );


  const dateForm = (
    <form className="sd-date" action={path}>
      <input type="date" name="date" defaultValue={dateKey} aria-label="Fecha" />
      {view !== "jornada" && <input type="hidden" name="vista" value={view} />}
      {view === "flota" && params?.tipo === "chofer" && <input type="hidden" name="tipo" value="chofer" />}
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
          <Link className={`ghost-button${dateKey === shiftDateKey(today, 1) ? " is-active" : ""}`} href={dayHref(shiftDateKey(today, 1))}>Mañana</Link>
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
        <Link className="button console-book" href={"/admin/reservas/nueva?date=" + dateKey}>Nueva reserva</Link>
        <nav className="console-tabs" aria-label="Consola de administración">
          <Link aria-current={view === "jornada" && !onlyMissing ? "page" : undefined} href={path + "?date=" + dateKey}><span>Jornada</span><strong>{board.summary.services}</strong><small>{board.summary.services === 1 ? "servicio" : "servicios"}</small></Link>
          <Link aria-current={onlyMissing ? "page" : undefined} data-alert={pendingRows.length > 0 || undefined} href={path + "?date=" + dateKey + "&falta=1"}><span>Pendientes</span><strong>{pendingRows.length}</strong><small>{pendingRows.length === 1 ? "servicio a revisar" : "servicios a revisar"}</small></Link>
          <Link aria-current={view === "flota" ? "page" : undefined} href={path + "?date=" + dateKey + "&vista=flota"}><span>Flota y choferes</span><strong>{usedVehicles.size}</strong><small>{usedVehicles.size === 1 ? "nave" : "naves"} · {usedDrivers.size} {usedDrivers.size === 1 ? "chofer asignado" : "choferes asignados"}</small></Link>
          <Link aria-current={view === "reservas" ? "page" : undefined} href={path + "?" + commercialQueues}>
            <span>Reservas y cobros</span><strong>{pendingPayments + pendingTrips}</strong>
            <small>{[pendingPayments > 0 && chargeLabel, pendingTrips > 0 && tripLabel].filter(Boolean).join(" · ") || "Sin cobros ni viajes por confirmar"}</small>
          </Link>
        </nav>
        <nav className="ops-planning" aria-label="Planificación">
          <Link aria-current={view === "semana" ? "page" : undefined} href={path + "?date=" + dateKey + "&vista=semana"}>Trabajo semanal</Link>
          <Link href={path + "?date=" + shiftDateKey(today,1) + "&vista=flota&tipo=chofer"}>Avisar a los choferes de mañana</Link>
          <Link aria-current={view === "vencimientos" ? "page" : undefined} href={path + "?date=" + dateKey + "&vista=vencimientos"}>Vencimientos a 30 días</Link>
        </nav>
      </section> : (
      <section className="sd-head">
        <div>
          <h2>{dayTitle(dateKey, today)}</h2>
          <p className="muted">Todos los servicios del día con su nave y su chofer: rutas, aeropuerto, Chapelco, escolares y viajes especiales, por la hora en que sale la unidad.</p>
        </div>
        <dl className="sd-summary">
          <div><dt>Servicios</dt><dd>{board.summary.services}</dd></div>
          <div><dt>Pasajeros</dt><dd>{board.summary.passengers}</dd></div>
          <div data-alerta={board.summary.missingVehicle > 0 || undefined}><dt>Sin nave</dt><dd>{board.summary.missingVehicle}</dd></div>
          <div data-alerta={board.summary.missingDriver > 0 || undefined}><dt>Sin chofer</dt><dd>{board.summary.missingDriver}</dd></div>
          <div data-alerta={board.summary.overbooked > 0 || undefined}><dt>Sobrecupo</dt><dd>{board.summary.overbooked}</dd></div>
          {board.summary.programmed > 0 ? <div><dt>Programadas</dt><dd>{board.summary.programmed}</dd></div> : null}
        </dl>
        <div className="sd-filter">
          <Link className={`pill${!onlyMissing ? " is-active" : ""}`} href={`${path}?date=${dateKey}`}>Todos</Link>
          <Link className={`pill${onlyMissing ? " is-active" : ""}`} href={`${path}?date=${dateKey}&falta=1`}>Sólo lo que falta asignar</Link>
        </div>
      </section>)}

      {view === "semana" ? <WeekAgenda days={days} /> : view === "vencimientos" ? <Deadlines date={dateKey} filter={params?.filtro} /> : view === "flota" ? <FleetAgenda date={dateKey} drivers={driverOptions} vehicles={fleetOptions} assignments={assignments} damages={vehicleDamages} people={params?.tipo === "chofer"} onlyUnused={params?.libres === "1"} search={search} selected={params?.recurso} />
      : view === "reservas" ? <section className="console-work console-reservations" aria-label="Reservas y cobros de la jornada">
        {params?.servicio && <header className="console-section-head">
          <h3>{selectedService ? [selectedService.at && hourFormat.format(selectedService.at), selectedService.title].filter(Boolean).join(" · ") : "El servicio ya no figura en esta jornada"}</h3>
          <nav className="plan-detail-links">{selectedService && <Link href={panelServiceHref(dateKey, selectedService.key)}>Volver al servicio</Link>}
            <Link href={path + "?date=" + dateKey + "&vista=reservas"}>Todas las reservas del día</Link></nav>
        </header>}
        {(!params?.servicio || (selectedService && scope)) && <ReservationWorkspace service={selectedService && scope ? { key: selectedService.key, where: scope } : undefined} panel role={user.role} params={{ date: dateKey, q: search, payment: params?.payment, page: params?.page, pageSize: params?.pageSize, orden: params?.orden, dir: params?.dir }} />}
      </section> : <DispatchDesk key={dateKey} dateKey={dateKey} panel={panel} vehicles={vehicleOptions} drivers={driverOptions} assignments={assignments} actions={
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
            <Link className="ghost-button" href={`/admin/reservas/nueva?servicio=aeropuerto&date=${dateKey}`}>Reserva de aeropuerto</Link>
            <Link className="ghost-button" href={`/admin/escolares/nuevo?fecha=${dateKey}`}>Recorrido escolar</Link>
            <Link className="ghost-button" href={`/admin/escolares/nuevo?fecha=${dateKey}&tipo=personal`}>Traslado de personal</Link>
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
          <Link href={`/admin/reservas/nueva?servicio=aeropuerto&date=${dateKey}`}>Reserva de aeropuerto</Link>
          <Link href={`/admin/aeropuerto?date=${dateKey}`}>Vuelos del día</Link>
          <Link href={`/admin/chapelco?date=${dateKey}`}>Cerro del día</Link>
          <Link href="/admin?vista=comercial">Cobros y comprobantes</Link>
          <LogoutButton />
        </nav>
      </details>}>
      {panel && <section className="console-agenda-head">
        <h3>{onlyMissing ? "Servicios que requieren atención" : "Servicios de la jornada"}</h3>
        <form action="/admin" className="console-filters">
          <input type="hidden" name="date" value={dateKey} />{onlyMissing && <input type="hidden" name="falta" value="1" />}
          <label>Buscar servicio<input name="q" type="search" defaultValue={search} placeholder="Servicio, nave o chofer" maxLength={100} /></label>
          <label>Área<select name="area" defaultValue={area}><option value="">Todas las áreas</option>
            {Object.entries(AREA_LABEL).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select></label><button className="ghost-button">Filtrar</button>
          {(area || search) && <Link href={dayHref(dateKey)}>Limpiar</Link>}
        </form>
      </section>}
      {rows.length === 0 ? (
        <p className="plain-card sd-empty">
          {area || search ? "No hay servicios que coincidan con el filtro." : onlyMissing
            ? "No hay servicios pendientes de asignación."
            : programmedRows.length
              ? "Las salidas programadas para este día todavía no tienen pasajeros."
              : "No hay servicios cargados para este día."}
        </p>
      ) : (
        <div className={panel ? "plan-sheet" : undefined}>
          {panel && <div className="plan-columns" aria-hidden="true"><span>Hora</span><span>Servicio</span><span>Equipo asignado</span><span>Pasajeros</span><span /></div>}
          <ol className="sd-list">{rows.map(renderRow)}</ol>
        </div>
      )}
      {programs.length > 0 && !onlyMissing ? (
        <details id="programacion" open={programs.some(r => r.key === params?.servicio) || undefined} className={panel ? "plain-card sd-programmed plan-sheet" : "plain-card sd-programmed"}>
          <summary>
            <strong>Ver la programación del día ({programs.length})</strong>
            <span className="muted">Salidas que todavía no tienen pasajeros.</span>
          </summary>
          <ol className="sd-list sd-programmed-list">{programs.map(renderRow)}</ol>
        </details>
      ) : null}

      {driverOptions.length === 0 ? (
        <p className="muted sd-footnote">No hay choferes activos: se cargan en <Link href="/admin/choferes">Choferes</Link>.</p>
      ) : null}
      </DispatchDesk>}
    </AdminShell>
  );
}

function ServiceSummary({ row, issues = [] }: { row: BoardRow; issues?: string[] }) {
  const first = row.units[0];
  const count = row.units.length;
  return <>
    <span className="plan-time"><strong>{row.at ? hourFormat.format(row.at) : row.timeText ?? "—"}</strong><small>{row.atLabel}</small></span>
    <span className="plan-service">
      <small>{AREA_LABEL[row.area]}{row.inactiveRoute && " · Inactiva"}</small>
      <strong>{row.title}</strong>
      {row.detail && row.area !== "RUTA" && <span className="plan-detail">{row.detail}</span>}
      {(issues.length > 0 || row.status) && <span className="plan-alert">{issues[0] ?? row.status}{issues.length > 1 && " · +" + (issues.length - 1)}</span>}
    </span>
    <span className="plan-crew">
      <strong>{count > 1 ? `${count} naves asignadas` : first?.vehicleName ?? "Sin asignar"}</strong>
      {!first && row.school?.driver && <small>{personName(row.school.driver)}</small>}
      {first && <small>{count === 1 ? [first.driverName, first.coDriverName].filter(Boolean).join(" y ") : row.units.map(unit => unit.vehicleName).join(" · ")}</small>}
    </span>
    <span className="plan-load">{row.school ? "—" : row.passengers}{row.capacity !== null && <small> / {row.capacity}</small>}<span className="plan-mobile-label"> pasajeros</span></span>
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

function DriverFields({ unit, options }: { unit: BoardUnit; options: Option[] }) {
  return <>
      <DropSelect name="driverId" defaultValue={unit.driverId ?? ""} aria-label={`Chofer de ${unit.vehicleName}`} data-falta={!unit.driverId || undefined}>
        <option value="">Sin chofer</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </DropSelect>
      <button className="ghost-button" type="submit">Guardar</button>
  </>;
}

function DriverForm({ unit, action, dateKey, options }: { unit: BoardUnit; action: (formData: FormData) => Promise<void>; dateKey: string; options: Option[] }) {
  return (
    <form action={action} className="sd-driver">
        <OriginField />
      <input type="hidden" name="id" value={unit.id} />
      <input type="hidden" name="date" value={dateKey} />
      <DriverFields unit={unit} options={options} />
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
        <BoardReturn /><input type="hidden" name="boardDate" value={dateKey} />
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
          <div className="sd-airport-driver sd-driver">
            <FleetAssignmentForm action={assignVehicleAction}>
              <OriginField />
              <BoardReturn /><input type="hidden" name="boardDate" value={dateKey} />
              <input type="hidden" name="flightId" value={row.serviceId} />
              <input type="hidden" name="vehicleId" value={unit.vehicleId} />
              <input type="hidden" name="assignmentId" value={unit.id} />
              <DriverFields unit={unit} options={withCurrent(driverOptions, unit.driverId, unit.driverName)} />
            </FleetAssignmentForm>
          </div>
          <form action={removeAssignmentAction} className="sd-remove">
        <OriginField />
            <input type="hidden" name="id" value={unit.id} />
            <BoardReturn /><input type="hidden" name="boardDate" value={dateKey} />
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

const dayKeyAr = (date: Date) => localDateKey(date);
const shortDayFormat = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", timeZone: "America/Argentina/Salta" });
/** «08:00–18:00», o con el día cuando la nave queda ocupada varios días: «jue 19 08:00 → lun 23 20:00». */
function blockLabel(from?: Date, to?: Date) {
  if (!from || !to || dayKeyAr(from) === dayKeyAr(to)) return `${timeFormat(from)}–${timeFormat(to)}`;
  const day = (date: Date) => shortDayFormat.format(date).replace(",", "").replace(".", "");
  return `${day(from)} ${timeFormat(from)} → ${day(to)} ${timeFormat(to)}`;
}

const timeFormat = (date?: Date) => (date ? hourFormat.format(date) : "");

/** Rutas: las naves de la salida, cada una con su chofer; abajo, sumar otra nave a la salida. */
function RouteUnits({ row, dateKey, vehicleOptions, driverOptions, withCurrent, publicRoute, assignments }: UnitProps & { publicRoute: boolean; assignments: DispatchAssignment[] }) {
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
            otherServices={assignments.filter(a => a.vehicleId === unit.vehicleId && a.rowKey !== row.key).map(a => ({ key: a.key, title: a.title, href: a.href, time: a.start === null ? "A coordinar" : hourFormat.format(a.start) }))}
            scheduleId={unit.scheduleId ?? row.serviceId}
            outgoing={unit}
            passengers={row.units.find(other => other.unitKind === "PRIMARY" && other.scheduleId === unit.scheduleId)?.passengers ?? row.passengers}
            keptSeats={row.units.filter(other => other.scheduleId === unit.scheduleId && other.id !== unit.id)
              .reduce((sum, other) => sum + other.seats, 0)}
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
      {row.continuing && <p className="sd-note">La asignación cubre el bloque indicado. Para un relevo con otras fechas, <Link href={row.editHref}>editá los bloques del viaje</Link>.</p>}
      <div className="sd-sumar" data-campos="4">
        <FleetAssignmentForm action={addSpecialVehicleAction}>
        <OriginField />
        <input type="hidden" name="tripId" value={row.serviceId} />
        <input type="hidden" name="date" value={dateKey} />
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
          <p className="sd-unit-name"><strong>{unit.vehicleName}</strong> <span className="muted">{blockLabel(unit.from, unit.to)}</span></p>
          <DriverForm unit={unit} action={setSpecialDriverAction} dateKey={dateKey} options={withCurrent(driverOptions, unit.driverId, unit.driverName)} />
          <form action={setSpecialDriverAction} className="sd-driver">
            <OriginField /><input type="hidden" name="id" value={unit.id} /><input type="hidden" name="date" value={dateKey} />
            <input type="hidden" name="puesto" value="segundo" />
            <label>Segundo chofer <DropSelect name="driverId" defaultValue={unit.coDriverId ?? ""}>
              <option value="">Sin segundo chofer</option>
              {withCurrent(driverOptions, unit.coDriverId ?? null, unit.coDriverName ?? null).filter(d => d.id !== unit.driverId).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </DropSelect></label><button className="ghost-button">Guardar segundo chofer</button>
          </form>
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

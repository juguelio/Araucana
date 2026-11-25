import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { FleetAssignmentForm } from "@/app/admin/fleet-assignment-form";
import { addScheduleUnitAction, removeScheduleUnitAction } from "@/app/admin/salidas/actions";

type RouteSchedulePageProps = {
  params: Promise<{ id: string; scheduleId: string }>;
  searchParams?: Promise<{ notice?: string }>;
};

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "America/Argentina/Salta"
});

const timeFormatter = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Salta"
});

function reservationStatus(status: string) {
  return {
    CONFIRMED: "Confirmada",
    PENDING_PAYMENT: "Pago pendiente",
    CANCELLED: "Cancelada"
  }[status] ?? status;
}

function whatsappHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

export default async function RouteSchedulePage({ params, searchParams }: RouteSchedulePageProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const [{ id: routeId, scheduleId }, query] = await Promise.all([params, searchParams]);
  const [schedule, reservations, vehicles, drivers] = await Promise.all([
    prisma.schedule.findFirst({
      where: { id: scheduleId, routeId },
      include: {
        route: true,
        vehicle: { select: { id: true, name: true, _count: { select: { seats: true } } } },
        driver: { select: { name: true, email: true } },
        extraUnits: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: { vehicle: { select: { id: true, name: true, isActive: true, _count: { select: { seats: true } } } }, driver: { select: { name: true, email: true } } }
        }
      }
    }),
    prisma.reservation.findMany({
      where: { scheduleId },
      include: {
        passenger: true,
        payment: { select: { status: true } }
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { seats: true } } } }),
    prisma.user.findMany({ where: { role: "DRIVER", isActive: true }, orderBy: [{ name: "asc" }, { email: "asc" }], select: { id: true, name: true, email: true } })
  ]);

  if (!schedule) {
    notFound();
  }

  const here = `/admin/rutas/${routeId}/salidas/${scheduleId}`;
  const units = [
    ...(schedule.vehicle ? [{
      key: "principal", vehicle: schedule.vehicle, seats: schedule.vehicle._count.seats, driver: schedule.driver,
      remove: schedule.extraUnits.length ? { name: "primaryOf", value: schedule.id } : null
    }] : []),
    ...schedule.extraUnits.map((unit) => ({
      key: unit.id, vehicle: unit.vehicle, seats: unit.vehicle.isActive ? unit.vehicle._count.seats : 0, driver: unit.driver, remove: { name: "unitId", value: unit.id }
    }))
  ];
  const capacity = units.reduce((total, unit) => total + unit.seats, 0);
  const taken = reservations.filter((reservation) => reservation.status !== "CANCELLED").reduce((total, reservation) => total + reservation.passengerCount, 0);
  const freeVehicles = vehicles.filter((vehicle) => !units.some((unit) => unit.vehicle.id === vehicle.id));
  const status = { OPEN: "Abierta", DOCUMENTATION: "Documentación", CLOSED: "Cerrada" }[schedule.status] ?? schedule.status;
  return (
    <AdminShell role={sessionUser.role} title={`${schedule.route.from} → ${schedule.route.to}`} eyebrow="Salida" notice={query?.notice}
      action={<div className="inline-actions">
        <Link className="ghost-button" href={`/admin/rutas/${routeId}/salidas/${scheduleId}/planilla`}>Planilla del chofer</Link>
        <Link className="ghost-button" href={`/admin/rutas/${routeId}/salidas`}>Volver a salidas</Link>
        <Link className="button" href={`/admin/rutas/${routeId}/salidas/${scheduleId}/editar`}>Editar salida</Link>
      </div>}>
      <section className="plain-card admin-section">
        <h2>Datos de la salida</h2>
        <div className="summary-list">
          <div><span>{units.length > 1 ? "Naves" : "Nave"}</span><strong>{units.map((unit) => unit.vehicle.name).join(" + ") || "Sin nave asignada"}</strong></div>
          <div><span>Lugares</span><strong>{taken} de {capacity}</strong></div>
          <div><span>Estado</span><strong>{status}</strong></div>
        </div>
      </section>
      <section className="plain-card admin-section">
        <h2>Naves de la salida</h2>
        <p className="muted">El cupo de la salida es la suma de los asientos de todas sus naves. La primera es la principal; si se quita, la siguiente toma su lugar.</p>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Nave</th><th>Asientos</th><th>Chofer</th><th></th></tr></thead>
            <tbody>
              {units.map((unit, index) => (
                <tr key={unit.key}>
                  <td><strong>{unit.vehicle.name}</strong>{index === 0 ? <span className="muted"> · principal</span> : null}</td>
                  <td>{unit.seats}</td>
                  <td>{unit.driver ? unit.driver.name ?? unit.driver.email : <span className="muted">Sin chofer</span>}</td>
                  <td>
                    {unit.remove ? (
                      <form action={removeScheduleUnitAction}>
                        <input type="hidden" name={unit.remove.name} value={unit.remove.value} />
                        <input type="hidden" name="back" value={here} />
                        <button className="text-button" type="submit" aria-label={`Quitar ${unit.vehicle.name} de la salida`}>Quitar</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {freeVehicles.length ? (
          <FleetAssignmentForm action={addScheduleUnitAction}>
            <input type="hidden" name="scheduleId" value={schedule.id} />
            <select name="vehicleId" defaultValue="" aria-label="Nave para sumar a la salida" required>
              <option value="" disabled>{units.length ? "Sumar otra nave…" : "Elegir nave…"}</option>
              {freeVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle._count.seats} asientos</option>)}
            </select>
            <select name="driverId" defaultValue="" aria-label="Chofer de la nave nueva">
              <option value="">Sin chofer</option>
              {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name ?? driver.email}</option>)}
            </select>
            <button className="ghost-button" type="submit">{units.length ? "Sumar nave" : "Asignar nave"}</button>
          </FleetAssignmentForm>
        ) : null}
      </section>
      <section className="plain-card admin-section schedule-reservations-panel">
        <div className="admin-edit-head">
          <div>
            <p className="eyebrow">Pasajeros asignados</p>
            <h2>Reservas de esta salida</h2>
            <p className="muted">{dateFormatter.format(schedule.departureAt)} · Sale {timeFormatter.format(schedule.departureAt)} · Llega {timeFormatter.format(schedule.arrivalAt)}</p>
          </div>
          <span className="status-pill active">{reservations.length} {reservations.length === 1 ? "reserva" : "reservas"}</span>
        </div>
        {reservations.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Reserva</th><th>Pasajero</th><th>Contacto</th><th>Asiento</th><th>Estado</th><th>Pago</th></tr></thead>
              <tbody>
                {reservations.map((reservation) => {
                  const whatsappUrl = whatsappHref(reservation.passenger.phone);
                  return (
                    <tr key={reservation.id}>
                      <td><Link className="table-link" href={`/admin/reservas/${reservation.code}`}>{reservation.code}</Link></td>
                      <td>{reservation.passenger.firstName} {reservation.passenger.lastName}</td>
                      <td>
                        <div className="reservation-contact"><span>{reservation.passenger.email}</span>{whatsappUrl ? <a href={whatsappUrl} target="_blank" rel="noreferrer">WhatsApp</a> : null}</div>
                      </td>
                      <td><strong>{reservation.passengerCount} {reservation.passengerCount === 1 ? "lugar" : "lugares"}</strong></td>
                      <td><span className={`status-pill ${reservation.status === "CANCELLED" ? "inactive" : "active"}`}>{reservationStatus(reservation.status)}</span></td>
                      <td>{reservation.payment?.status ?? "Pendiente"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="empty-admin-state"><strong>Todavía no hay reservas asignadas.</strong><span>Los pasajeros que reserven esta salida aparecerán acá.</span></div>}
      </section>
    </AdminShell>
  );
}

"use client";

import { useMemo, useState } from "react";
import type { DriverRouteOption, DriverUpcomingSchedule } from "@/lib/driver/schedules";

type DriverRouteSchedulesPanelProps = {
  routes: DriverRouteOption[];
  schedules: DriverUpcomingSchedule[];
};

const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const timeFormatter = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function initialRouteId(routes: DriverRouteOption[], schedules: DriverUpcomingSchedule[]) {
  return schedules[0]?.routeId ?? routes[0]?.id ?? "";
}

function firstScheduleIdForRoute(schedules: DriverUpcomingSchedule[], routeId: string) {
  return schedules.find((schedule) => schedule.routeId === routeId)?.id ?? "";
}

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

function formatTime(value: string) {
  return timeFormatter.format(new Date(value));
}

function formatScheduleStatus(status: string) {
  const labels: Record<string, string> = {
    OPEN: "Abierta",
    DOCUMENTATION: "Documentacion",
    CLOSED: "Cerrada"
  };

  return labels[status] ?? status;
}

function formatReservationStatus(status: string) {
  const labels: Record<string, string> = {
    CONFIRMED: "Confirmada",
    PENDING_PAYMENT: "Pago pendiente",
    CANCELLED: "Cancelada"
  };

  return labels[status] ?? status;
}

function formatPaymentStatus(status: string | null) {
  if (!status) {
    return "-";
  }

  const labels: Record<string, string> = {
    APPROVED: "Aprobado",
    PENDING: "Pendiente",
    REJECTED: "Rechazado"
  };

  return labels[status] ?? status;
}

function whatsappHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

export function DriverRouteSchedulesPanel({ routes, schedules }: DriverRouteSchedulesPanelProps) {
  const firstRouteId = initialRouteId(routes, schedules);
  const [selectedRouteId, setSelectedRouteId] = useState(firstRouteId);
  const [selectedScheduleId, setSelectedScheduleId] = useState(firstScheduleIdForRoute(schedules, firstRouteId));
  const routeSchedules = useMemo(
    () => schedules.filter((schedule) => schedule.routeId === selectedRouteId),
    [schedules, selectedRouteId]
  );
  const selectedSchedule =
    routeSchedules.find((schedule) => schedule.id === selectedScheduleId) ?? routeSchedules[0] ?? null;

  return (
    <section className="plain-card admin-section">
      <div>
        <p className="eyebrow">Ruta de trabajo</p>
        <h2 className="route-title">Salidas proximas</h2>
      </div>

      {routes.length === 0 ? (
        <p className="muted">No hay rutas activas para choferes.</p>
      ) : (
        <>
          <div className="admin-form-grid">
            <label className="span-2">
              Ruta
              <select
                value={selectedRouteId}
                onChange={(event) => {
                  const routeId = event.target.value;
                  setSelectedRouteId(routeId);
                  setSelectedScheduleId(firstScheduleIdForRoute(schedules, routeId));
                }}
              >
                {routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.label} · {route.via}
                  </option>
                ))}
              </select>
            </label>

            <label className="span-2">
              Salida
              <select
                value={selectedSchedule?.id ?? ""}
                disabled={routeSchedules.length === 0}
                onChange={(event) => setSelectedScheduleId(event.target.value)}
              >
                {routeSchedules.length === 0 ? <option value="">Sin salidas proximas</option> : null}
                {routeSchedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    {formatDateTime(schedule.departureAt)} · {schedule.vehicle.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedSchedule ? (
            <div className="driver-schedule-detail">
              <div className="driver-summary-grid">
                <div>
                  <span>Ruta</span>
                  <strong>{selectedSchedule.routeLabel}</strong>
                  <small>{selectedSchedule.route.via}</small>
                </div>
                <div>
                  <span>Salida</span>
                  <strong>{formatDateTime(selectedSchedule.departureAt)}</strong>
                  <small>Llega {formatTime(selectedSchedule.arrivalAt)}</small>
                </div>
                <div>
                  <span>Nave</span>
                  <strong>{selectedSchedule.vehicle.name}</strong>
                  <small>{selectedSchedule.vehicle.licensePlate ?? "Sin patente"}</small>
                </div>
                <div>
                  <span>Pasajeros</span>
                  <strong>{selectedSchedule.passengerCount}</strong>
                  <small>
                    {selectedSchedule.availableSeats}/{selectedSchedule.totalSeats} asientos disponibles
                  </small>
                </div>
              </div>

              {selectedSchedule.stops.length > 0 ? (
                <div className="manifest-block">
                  <h3>Paradas de ruta</h3>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Parada</th>
                          <th>Minuto</th>
                          <th>Nota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSchedule.stops.map((stop) => (
                          <tr key={`${selectedSchedule.id}-${stop.name}-${stop.minutes ?? "sin-minuto"}`}>
                            <td>{stop.name}</td>
                            <td>{stop.minutes === null ? "-" : `${stop.minutes} min`}</td>
                            <td>{stop.note ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              <div className="manifest-block">
                <div className="admin-edit-head">
                  <h3>Personas que suben</h3>
                  <span className={`status-pill ${selectedSchedule.status === "CLOSED" ? "inactive" : "active"}`}>
                    {formatScheduleStatus(selectedSchedule.status)}
                  </span>
                </div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Pasajero</th>
                        <th>Telefono</th>
                        <th>Documento</th>
                        <th>Asiento</th>
                        <th>Estado</th>
                        <th>Pago</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSchedule.passengers.map((passenger) => {
                        const whatsappUrl = whatsappHref(passenger.phone);

                        return (
                          <tr key={passenger.reservationId}>
                            <td>{passenger.code}</td>
                            <td>{passenger.passengerName}</td>
                            <td>
                              {whatsappUrl ? (
                                <a className="table-link" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                                  {passenger.phone}
                                </a>
                              ) : (
                                passenger.phone
                              )}
                            </td>
                            <td>{passenger.documentLabel}</td>
                            <td>{passenger.seatNumber ?? "-"}</td>
                            <td>{formatReservationStatus(passenger.reservationStatus)}</td>
                            <td>{formatPaymentStatus(passenger.paymentStatus)}</td>
                          </tr>
                        );
                      })}
                      {selectedSchedule.passengers.length === 0 ? (
                        <tr>
                          <td colSpan={7}>No hay pasajeros para esta salida.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <p className="muted driver-empty-state">No hay salidas proximas para esta ruta.</p>
          )}
        </>
      )}
    </section>
  );
}

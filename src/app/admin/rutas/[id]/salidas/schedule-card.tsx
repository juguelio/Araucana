import Link from "next/link";
import { vehicleDetails, vehicleLabel } from "@/lib/booking/schedule-vehicle";
import type { AdminScheduleRowDto } from "@/lib/booking/types";
import { deleteScheduleAction, setScheduleStatusAction, setScheduleVehicleAction } from "../../../salidas/actions";

export type VehicleOption = {
  id: string;
  name: string;
  licensePlate?: string | null;
  internalNumber?: string | null;
};

export type CalendarSchedule = Pick<
  AdminScheduleRowDto,
  "id" | "vehicleId" | "vehicleName" | "vehiclePlate" | "vehicleInternalNumber" | "extraVehicleNames" | "availableSeats" | "totalSeats" | "status"
>;

/**
 * Naves que ofrece el selector rápido (issue #81). La unidad asignada puede haber quedado inactiva y
 * ya no venir en la lista de activas: se agrega marcada, para que el selector no muestre otra nave
 * como si fuera la asignada.
 */
export function scheduleVehicleOptions(schedule: CalendarSchedule, vehicles: VehicleOption[]): VehicleOption[] {
  if (!schedule.vehicleId || vehicles.some((vehicle) => vehicle.id === schedule.vehicleId)) {
    return vehicles;
  }

  return [
    {
      id: schedule.vehicleId,
      name: `${schedule.vehicleName} (inactiva)`,
      licensePlate: schedule.vehiclePlate,
      internalNumber: schedule.vehicleInternalNumber
    },
    ...vehicles
  ];
}

export function statusLabel(status: string) {
  return { OPEN: "Abierta", DOCUMENTATION: "Documentación", CLOSED: "Cerrada" }[status] ?? status;
}

/**
 * Una salida en el calendario de la ruta: hora, cupo, la nave asignada y el cambio rápido de nave
 * sin abrir el formulario completo. El nombre y el interno van a la vista porque son los datos con
 * los que el despachante arma la semana.
 */
export function ScheduleCard({ schedule, routeId, vehicles, timeLabel }: {
  schedule: CalendarSchedule;
  routeId: string;
  vehicles: VehicleOption[];
  timeLabel: string;
}) {
  const nave = { name: schedule.vehicleName, licensePlate: schedule.vehiclePlate, internalNumber: schedule.vehicleInternalNumber };
  const detalle = vehicleDetails(nave);

  return (
    <article
      className={`calendar-schedule ${schedule.status === "CLOSED" ? "is-closed" : ""}`}
      data-estado={schedule.status}
      data-completa={(schedule.totalSeats > 0 && schedule.availableSeats === 0) || undefined}
    >
      <div className="calendar-schedule-line">
        <strong>{timeLabel}</strong>
        <span className="calendar-schedule-cupo" title="Lugares libres / total">{schedule.availableSeats}/{schedule.totalSeats}</span>
      </div>
      <small className="calendar-schedule-estado">{statusLabel(schedule.status)}</small>
      <p className="calendar-schedule-vehicle">
        <strong>{schedule.vehicleName}</strong>
        {detalle ? <span>{detalle}</span> : null}
        {schedule.extraVehicleNames?.length ? <span>+ {schedule.extraVehicleNames.join(" + ")}</span> : null}
      </p>
      <form action={setScheduleVehicleAction} className="calendar-schedule-vehicle-change">
        <input type="hidden" name="id" value={schedule.id} />
        <select name="vehicleId" defaultValue={schedule.vehicleId ?? ""} required aria-label={`Nave de la salida de las ${timeLabel}`}>
          {!schedule.vehicleId ? <option value="" disabled>Elegir nave…</option> : null}
          {scheduleVehicleOptions(schedule, vehicles).map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle)}</option>
          ))}
        </select>
        <button type="submit">{schedule.vehicleId ? "Cambiar nave" : "Asignar nave"}</button>
      </form>
      <div className="calendar-schedule-actions">
        <Link href={`/admin/rutas/${routeId}/salidas/${schedule.id}`}>Reservas y naves</Link>
        <Link href={`/admin/rutas/${routeId}/salidas/${schedule.id}/editar`}>Editar</Link>
        <form action={setScheduleStatusAction}>
          <input type="hidden" name="id" value={schedule.id} />
          <input type="hidden" name="status" value={schedule.status === "CLOSED" ? "OPEN" : "CLOSED"} />
          <button type="submit">{schedule.status === "CLOSED" ? "Abrir" : "Cerrar"}</button>
        </form>
        <form action={deleteScheduleAction}>
          <input type="hidden" name="id" value={schedule.id} />
          <button type="submit" aria-label="Eliminar salida">×</button>
        </form>
      </div>
    </article>
  );
}

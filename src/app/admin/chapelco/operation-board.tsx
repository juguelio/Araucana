import type { ChapelcoAvailabilityDto } from "@/lib/chapelco/types";
import { updateChapelcoSeasonAction } from "./actions";

type VehicleOption = {
  id: string;
  name: string;
  _count: { seats: number };
};

type ReservationOption = {
  id: string;
  registros: string[];
  code: string;
  passengerCount: number;
  status: string;
  passenger: {
    firstName: string;
    lastName: string;
    phone: string;
  };
  payment: {
    status: string;
  } | null;
  chapelcoDetails: {
    ascentSlot: string;
    pickupName: string;
    pickupAddress: string;
  } | null;
};

function dateInputValue(date?: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

export function OperationBoard({
  routeId,
  serviceStartDate,
  serviceEndDate,
  serviceDate,
  vehicles,
  reservations,
  availability
}: {
  routeId: string;
  serviceStartDate?: Date | null;
  serviceEndDate?: Date | null;
  serviceDate: string;
  vehicles: VehicleOption[];
  reservations: ReservationOption[];
  availability: ChapelcoAvailabilityDto;
}) {
  const totalFleetCapacity = vehicles.reduce((total, vehicle) => total + vehicle._count.seats, 0);
  const seasonLabel =
    serviceStartDate && serviceEndDate
      ? `${dateInputValue(serviceStartDate)} al ${dateInputValue(serviceEndDate)}`
      : "Sin temporada configurada";

  return (
    <div className="admin-section-grid">
      <section className="plain-card admin-section">
        <h2>Temporada Chapelco</h2>
        <form className="admin-form-grid" action={updateChapelcoSeasonAction}>
          <input type="hidden" name="routeId" value={routeId} />
          <input type="hidden" name="serviceDate" value={serviceDate} />
          <label>
            Fecha inicio
            <input name="serviceStartDate" type="date" defaultValue={dateInputValue(serviceStartDate)} required />
          </label>
          <label>
            Fecha fin
            <input name="serviceEndDate" type="date" defaultValue={dateInputValue(serviceEndDate)} required />
          </label>
          <div className="form-actions span-2">
            <button className="button" type="submit">
              Guardar temporada
            </button>
          </div>
        </form>
      </section>

      <section className="plain-card admin-section">
        <h2>Dia consultado</h2>
        <form className="admin-form-grid" action="/admin/chapelco" method="get">
          <label>
            Fecha
            <input name="date" type="date" defaultValue={serviceDate} required />
          </label>
          <div className="form-actions">
            <button className="ghost-button" type="submit">
              Ver dia
            </button>
          </div>
        </form>
        <p className="muted">
          Temporada: {seasonLabel}. {availability.isServiceActive ? "Servicio activo para esta fecha." : "Servicio fuera de temporada."}
        </p>
      </section>

      <section className="stats-grid admin-section">
        {availability.slots.map((slot) => (
          <div className="stat-card" key={slot.slot}>
            <strong>{slot.availablePeople}</strong>
            <span>{slot.slot} libres de {slot.totalCapacity}</span>
          </div>
        ))}
      </section>

      <section className="plain-card admin-section">
        <h2>Naves disponibles para Chapelco</h2>
        <p className="muted">
          Chapelco toma automaticamente todas las naves activas cargadas en la seccion Naves. Capacidad total actual:{" "}
          {totalFleetCapacity} cupos.
        </p>
        <table className="data-table">
          <thead>
            <tr>
              <th>Nave</th>
              <th>Cupos</th>
              <th>Estado Chapelco</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle) => (
              <tr key={vehicle.id}>
                <td>{vehicle.name}</td>
                <td>{vehicle._count.seats}</td>
                <td>Disponible automaticamente</td>
              </tr>
            ))}
            {vehicles.length === 0 ? (
              <tr>
                <td colSpan={3}>No hay naves activas cargadas.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="plain-card admin-section">
        <h2>Reservas Chapelco del dia</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Responsable</th>
              <th>Horario</th>
              <th>Busqueda</th>
              <th>Personas</th>
              <th>Pago</th>
              <th>Manifiesto</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((reservation) => (
              <tr key={reservation.id}>
                <td>{reservation.code}</td>
                <td>{reservation.passenger.firstName} {reservation.passenger.lastName}</td>
                <td>{reservation.chapelcoDetails?.ascentSlot}</td>
                <td>{reservation.chapelcoDetails?.pickupName}</td>
                <td>{reservation.passengerCount}</td>
                <td>{reservation.payment?.status ?? "Pendiente"}</td>
                <td>{reservation.registros.length ? reservation.registros.map((linea, i) => <div key={i}>{linea}</div>) : "Sin vuelta asignada"}</td>
              </tr>
            ))}
            {reservations.length === 0 ? (
              <tr>
                <td colSpan={7}>No hay reservas Chapelco para este dia.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

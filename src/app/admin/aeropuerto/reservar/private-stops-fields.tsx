"use client";

import "./private-transfer.css";
import type { PrivateStop } from "@/lib/airport/private-transfer";
import { privatePassengerCount } from "@/lib/airport/private-transfer";

export type PrivateVehicleOption = { id: string; name: string; seats: number };

export function PrivateStopsFields({ stops, onChange, vehicles, vehicleId, onVehicle }: {
  stops: PrivateStop[];
  onChange: (stops: PrivateStop[]) => void;
  vehicles: PrivateVehicleOption[];
  vehicleId: string;
  onVehicle?: (id: string) => void;
}) {
  const total = privatePassengerCount(stops);
  function update(index: number, change: Partial<PrivateStop>) {
    onChange(stops.map((stop, i) => i === index ? { ...stop, ...change } : stop));
  }
  return <>
    {stops.map((stop, i) => (
      <div className="private-stop" key={i}>
        <label>Parada {i + 1}
          <input required maxLength={200} placeholder="Alojamiento o dirección y localidad" value={stop.destination}
            onChange={event => update(i, { destination: event.target.value })} />
        </label>
        <label>Pasajeros en la parada {i + 1}
          <input type="number" min={1} max={24} required value={stop.passengers || ""}
            onChange={event => update(i, { passengers: Number(event.target.value) })} />
        </label>
        {stops.length > 1 && <button type="button" className="ghost-button" onClick={() => onChange(stops.filter((_, n) => n !== i))}>Quitar parada {i + 1}</button>}
      </div>
    ))}
    <button className="ghost-button" type="button" disabled={total >= 24} onClick={() => onChange([...stops, { destination: "", passengers: 1 }])}>Agregar parada</button>
    <p>Total del grupo · {total} {total === 1 ? "pasajero" : "pasajeros"}</p>
    {onVehicle && <label>Nave exclusiva
      <select aria-label="Nave exclusiva" value={vehicleId} onChange={event => onVehicle(event.target.value)}>
        <option value="">Pendiente de asignación</option>
        {vehicles.filter(v => v.seats >= total || v.id === vehicleId).map(v => <option key={v.id} value={v.id}>{v.name} · {v.seats} lugares</option>)}
      </select>
    </label>}
  </>;
}

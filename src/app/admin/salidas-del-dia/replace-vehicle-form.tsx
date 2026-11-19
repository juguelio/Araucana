"use client";
import { useState } from "react";
import type { BoardUnit } from "@/lib/operations/day-board";
import { FleetAssignmentForm } from "../fleet-assignment-form";
import { DropSelect, OriginField } from "./dispatch-desk";
import { replaceBoardVehicleAction } from "./actions";
import type { Option } from "./crew-form";

type Choice = { key: number; vehicleId: string; driverId: string };
type Props = {
  otherServices: { key: string; title: string; href: string; time: string }[];
  scheduleId: string; outgoing: BoardUnit; date: string; passengers: number; keptSeats: number;
  vehicles: (Option & { seats: number })[]; drivers: Option[];
};

export function ReplaceVehicleForm({ scheduleId, outgoing, date, passengers, keptSeats, vehicles, drivers, otherServices }: Props) {
  const [choices, setChoices] = useState<Choice[]>([{ key: 0, vehicleId: "", driverId: drivers.some(d => d.id === outgoing.driverId) ? outgoing.driverId! : "" }]);
  const capacity = choices.reduce((sum, row) => sum + (vehicles.find(v => v.id === row.vehicleId)?.seats ?? 0), keptSeats);
  function change(key: number, fields: Partial<Omit<Choice, "key">>) {
    setChoices(rows => rows.map(row => row.key === key ? { ...row, ...fields } : row));
  }
  return <details className="sd-replace">
    <summary>Reemplazar por avería</summary>
    <p>Retirar <strong>{outgoing.vehicleName}</strong> de esta salida. Elegí qué naves la cubren.</p>
    {otherServices.length > 0 && <details className="console-impact"><summary>Otros tramos de esta nave en la jornada ({otherServices.length})</summary>
      <ul>{otherServices.map(service => <li key={service.key}><a href={service.href}>{service.time} · {service.title}</a></li>)}</ul>
    </details>}
    {!vehicles.length && <p>No hay naves de reemplazo disponibles en la flota habilitada.</p>}
    <FleetAssignmentForm action={replaceBoardVehicleAction}>
      <OriginField />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <input type="hidden" name="outgoingId" value={outgoing.vehicleId} />
      {choices.map((row, i) => <div className="sd-replacement-row" key={row.key}>
        <label>Nave de reemplazo {i + 1}
          <DropSelect name="vehicleId" required value={row.vehicleId} onChange={e => change(row.key, { vehicleId: e.target.value })}>
            <option value="">Elegir nave…</option>
            {vehicles.map(v => <option key={v.id} value={v.id} disabled={choices.some(c => c.key !== row.key && c.vehicleId === v.id)}>{v.label}</option>)}
          </DropSelect>
        </label>
        <label>Chofer del reemplazo {i + 1}
          <DropSelect name="driverId" value={row.driverId} onChange={e => change(row.key, { driverId: e.target.value })}>
            <option value="">Asignar después</option>
            {drivers.map(d => <option key={d.id} value={d.id} disabled={choices.some(c => c.key !== row.key && c.driverId === d.id)}>{d.label}</option>)}
          </DropSelect>
        </label>
        {choices.length > 1 && <button type="button" onClick={() => setChoices(rows => rows.filter(c => c.key !== row.key))}>Quitar reemplazo {i + 1}</button>}
      </div>)}
      {choices.length < vehicles.length && <button type="button" className="ghost-button" onClick={() => setChoices(rows => [...rows, { key: Math.max(...rows.map(c => c.key)) + 1, vehicleId: "", driverId: "" }])}>Sumar otro reemplazo</button>}
      <p role="status">{passengers} pasajeros reservados · {capacity} lugares al confirmar.{capacity < passengers && ` Faltan ${passengers - capacity}.`}</p>
      <button className="button" type="submit" disabled={!choices.every(c => c.vehicleId) || capacity < passengers}>Confirmar reemplazo</button>
    </FleetAssignmentForm>
  </details>;
}

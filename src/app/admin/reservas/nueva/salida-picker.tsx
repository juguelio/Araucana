"use client";

import { useMemo, useState } from "react";
import "./salida-picker.css";

export type SalidaOption = {
  id: string;
  from: string;
  to: string;
  dayKey: string;
  dayLabel: string;
  timeLabel: string;
  availableSeats: number;
  status: string;
};

/**
 * El campo «Salida» del alta manual era un solo <select> con todas las salidas futuras pegadas en
 * una línea ("Aeropuerto Chapelco (CPC) -> San Martin de los Andes · jue, 05 nov · 09:00 · 24
 * lugares libres"): con más de un puñado no se podía recorrer. Acá el mismo campo se filtra por
 * origen, destino y fecha (en cascada) y las opciones quedan agrupadas por día.
 */
export function SalidaPicker({ schedules }: { schedules: SalidaOption[] }) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [day, setDay] = useState("");
  const [pickedId, setPickedId] = useState(schedules[0]?.id ?? "");

  const origins = useMemo(() => unique(schedules.map((schedule) => schedule.from)), [schedules]);

  const destinations = useMemo(
    () => unique(schedules.filter((schedule) => !origin || schedule.from === origin).map((schedule) => schedule.to)),
    [schedules, origin]
  );

  const porRuta = useMemo(
    () => schedules.filter((schedule) => (!origin || schedule.from === origin) && (!destination || schedule.to === destination)),
    [schedules, origin, destination]
  );

  const days = useMemo(() => {
    const byDay = new Map<string, { key: string; label: string; count: number }>();
    for (const schedule of porRuta) {
      const entry = byDay.get(schedule.dayKey);
      if (entry) entry.count += 1;
      else byDay.set(schedule.dayKey, { key: schedule.dayKey, label: schedule.dayLabel, count: 1 });
    }
    return [...byDay.values()];
  }, [porRuta]);

  const matches = useMemo(() => porRuta.filter((schedule) => !day || schedule.dayKey === day), [porRuta, day]);

  // La selección sigue a la lista filtrada: si la salida marcada queda afuera, cae en la primera.
  const selectedId = matches.some((schedule) => schedule.id === pickedId) ? pickedId : matches[0]?.id ?? "";
  const selected = matches.find((schedule) => schedule.id === selectedId) ?? null;

  const groups = useMemo(() => {
    const byDay = new Map<string, { key: string; label: string; items: SalidaOption[] }>();
    for (const schedule of matches) {
      const group = byDay.get(schedule.dayKey);
      if (group) group.items.push(schedule);
      else byDay.set(schedule.dayKey, { key: schedule.dayKey, label: schedule.dayLabel, items: [schedule] });
    }
    return [...byDay.values()];
  }, [matches]);

  // Con origen y destino ya elegidos la ruta es obvia: no hace falta repetirla en cada opción.
  const showRoute = !origin || !destination;

  function changeOrigin(value: string) {
    setOrigin(value);
    if (destination && !schedules.some((schedule) => schedule.from === value && schedule.to === destination)) {
      setDestination("");
    }
  }

  return (
    <div className="salida-picker">
      <div className="salida-filters">
        <label>
          Origen
          <select name="originFilter" value={origin} onChange={(event) => changeOrigin(event.target.value)}>
            <option value="">Todos</option>
            {origins.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Destino
          <select name="destinationFilter" value={destination} onChange={(event) => setDestination(event.target.value)}>
            <option value="">Todos</option>
            {destinations.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fecha
          <select name="dateFilter" value={day} onChange={(event) => setDay(event.target.value)}>
            <option value="">Todas</option>
            {days.map((option) => (
              <option value={option.key} key={option.key}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="salida-field">
        Salida
        <select name="scheduleId" value={selectedId} onChange={(event) => setPickedId(event.target.value)} required>
          {groups.length ? null : <option value="">Sin salidas para esos filtros</option>}
          {groups.map((group) => (
            <optgroup label={group.label} key={group.key}>
              {group.items.map((schedule) => (
                <option value={schedule.id} key={schedule.id}>
                  {showRoute ? `${schedule.from} → ${schedule.to} · ` : ""}
                  {schedule.timeLabel} · {schedule.availableSeats} libres
                  {schedule.status === "DOCUMENTATION" ? " · documentación" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <p className="salida-hint">
        {matches.length === 0
          ? "No hay salidas con esos filtros."
          : `${matches.length} ${matches.length === 1 ? "salida" : "salidas"}${selected ? ` · ${selected.dayLabel} ${selected.timeLabel} · ${selected.availableSeats} lugares libres` : ""}`}
      </p>
    </div>
  );
}

function unique(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "es"));
}

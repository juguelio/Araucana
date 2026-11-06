"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

const SEMANA = ["L", "M", "M", "J", "V", "S", "D"];
const monthFormatter = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormatter = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/**
 * El campo «Salida» del alta manual era un solo <select> con todas las salidas futuras pegadas en
 * una línea ("Aeropuerto Chapelco (CPC) -> San Martin de los Andes · jue, 05 nov · 09:00 · 24
 * lugares libres"): con más de un puñado no se podía recorrer. Acá el mismo campo se filtra por
 * origen, destino y fecha (en cascada, con mini calendario) y las opciones quedan agrupadas por día.
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

  // Cantidad de salidas por día (los días sin salidas quedan apagados en el calendario).
  const porDia = useMemo(() => {
    const counts = new Map<string, number>();
    for (const schedule of porRuta) counts.set(schedule.dayKey, (counts.get(schedule.dayKey) ?? 0) + 1);
    return counts;
  }, [porRuta]);

  const etiquetas = useMemo(() => {
    const labels = new Map<string, string>();
    for (const schedule of schedules) labels.set(schedule.dayKey, schedule.dayLabel);
    return labels;
  }, [schedules]);

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
    const destinoSigueValido = !destination || schedules.some((schedule) => schedule.from === value && schedule.to === destination);
    if (!destinoSigueValido) setDestination("");
    const destinoEfectivo = destinoSigueValido ? destination : "";
    if (day && !schedules.some((schedule) => schedule.from === value && (!destinoEfectivo || schedule.to === destinoEfectivo) && schedule.dayKey === day)) {
      setDay("");
    }
  }

  function changeDestination(value: string) {
    setDestination(value);
    // Si la fecha elegida deja de tener salidas para esa ruta, se suelta.
    if (day && !schedules.some((schedule) => (!origin || schedule.from === origin) && (!value || schedule.to === value) && schedule.dayKey === day)) {
      setDay("");
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
          <select name="destinationFilter" value={destination} onChange={(event) => changeDestination(event.target.value)}>
            <option value="">Todos</option>
            {destinations.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className="salida-day-field">
          <span className="salida-day-label">Fecha</span>
          <Calendario
            value={day}
            counts={porDia}
            labels={etiquetas}
            onChange={setDay}
          />
        </div>
      </div>

      <fieldset className="salida-field">
        <legend>Salida</legend>
        {groups.length === 0 ? (
          <p className="salida-empty">Sin salidas para esos filtros.</p>
        ) : (
          <div className="salida-grupos">
            {groups.map((group) => (
              <div className="salida-grupo" key={group.key}>
                {/* Agrupado por día y con la misma tarjeta de salida que la página pública de rutas. */}
                <p className="salida-grupo-dia">{group.label}</p>
                <div className="schedule-rail salida-rail" aria-label={`Salidas del ${group.label}`}>
                  {group.items.map((schedule) => (
                    <label className="schedule-option" key={schedule.id}>
                      <input
                        type="radio"
                        name="scheduleId"
                        value={schedule.id}
                        checked={schedule.id === selectedId}
                        onChange={() => setPickedId(schedule.id)}
                        required
                      />
                      <span className="schedule-card">
                        <span className="schedule-date">
                          {showRoute ? `${schedule.from} → ${schedule.to}` : schedule.status === "DOCUMENTATION" ? "Documentación" : "Salida"}
                        </span>
                        <strong className="schedule-time">{schedule.timeLabel}</strong>
                        <span className="schedule-seats">
                          {schedule.availableSeats} {schedule.availableSeats === 1 ? "libre" : "libres"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </fieldset>

      <p className="salida-hint">
        {matches.length === 0
          ? "No hay salidas con esos filtros."
          : `${matches.length} ${matches.length === 1 ? "salida" : "salidas"}${selected ? ` · ${selected.dayLabel} ${selected.timeLabel} · ${selected.availableSeats} lugares libres` : ""}`}
      </p>
    </div>
  );
}

type CalendarioProps = {
  value: string;
  counts: Map<string, number>;
  labels: Map<string, string>;
  onChange: (value: string) => void;
};

/** Mini calendario del filtro Fecha: sólo los días con salidas son clickeables. */
function Calendario({ value, counts, labels, onChange }: CalendarioProps) {
  const [abierto, setAbierto] = useState(false);
  const [mes, setMes] = useState(() => value.slice(0, 7) || "hoy");
  const contenedor = useRef<HTMLDivElement>(null);

  const mesesDisponibles = useMemo(() => [...new Set([...counts.keys()].map((key) => key.slice(0, 7)))].sort(), [counts]);

  // Mes a mostrar: el elegido si tiene salidas, si no el primero disponible (o el actual).
  const mesVisible = useMemo(() => {
    const candidato = mes !== "hoy" ? mes : mesesDisponibles[0] ?? hoyKey().slice(0, 7);
    return mesesDisponibles.includes(candidato) ? candidato : mesesDisponibles[0] ?? candidato;
  }, [mes, mesesDisponibles]);

  useEffect(() => {
    if (!abierto) return;
    function cerrar(event: MouseEvent) {
      if (contenedor.current && !contenedor.current.contains(event.target as Node)) setAbierto(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setAbierto(false);
    }
    document.addEventListener("mousedown", cerrar);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", cerrar);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  function abrir() {
    if (!abierto) {
      // Al abrir, si la fecha elegida no está a la vista, se muestra su mes.
      if (value) setMes(value.slice(0, 7));
      else if (mes === "hoy" && mesesDisponibles[0]) setMes(mesesDisponibles[0]);
    }
    setAbierto(!abierto);
  }

  const [anio, numeroMes] = mesVisible.split("-").map(Number);
  const primerDia = new Date(Date.UTC(anio, numeroMes - 1, 1));
  const desplazamiento = (primerDia.getUTCDay() + 6) % 7; // lunes = 0
  const diasDelMes = new Date(Date.UTC(anio, numeroMes, 0)).getUTCDate();
  const hoy = hoyKey();

  const indiceMes = mesesDisponibles.indexOf(mesVisible);
  const anterior = indiceMes > 0 ? mesesDisponibles[indiceMes - 1] : null;
  const siguiente = indiceMes >= 0 && indiceMes < mesesDisponibles.length - 1 ? mesesDisponibles[indiceMes + 1] : null;

  const etiquetaMes = monthFormatter.format(new Date(Date.UTC(anio, numeroMes - 1, 15)));

  return (
    <div className="salida-cal" ref={contenedor}>
      <button
        type="button"
        className="salida-cal-trigger"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        onClick={abrir}
      >
        <span>{value ? labels.get(value) ?? value : "Todas las fechas"}</span>
        <span aria-hidden="true" className="salida-cal-caret">▾</span>
      </button>

      {abierto ? (
        <div className="salida-cal-pop" role="dialog" aria-label="Elegir fecha de la salida">
          <div className="salida-cal-head">
            <button type="button" aria-label="Mes anterior" disabled={!anterior} onClick={() => anterior && setMes(anterior)}>
              ‹
            </button>
            <strong>{etiquetaMes}</strong>
            <button type="button" aria-label="Mes siguiente" disabled={!siguiente} onClick={() => siguiente && setMes(siguiente)}>
              ›
            </button>
          </div>

          <div className="salida-cal-week" aria-hidden="true">
            {SEMANA.map((dia, indice) => (
              <span key={`${dia}-${indice}`}>{dia}</span>
            ))}
          </div>

          <div className="salida-cal-grid">
            {Array.from({ length: desplazamiento }, (_, indice) => (
              <span key={`vacio-${indice}`} />
            ))}
            {Array.from({ length: diasDelMes }, (_, indice) => {
              const numero = indice + 1;
              const key = `${mesVisible}-${String(numero).padStart(2, "0")}`;
              const salidas = counts.get(key) ?? 0;
              const clase = ["salida-cal-dia"];
              if (salidas > 0) clase.push("is-abierto");
              if (key === value) clase.push("is-elegido");
              if (key === hoy) clase.push("is-hoy");
              return (
                <button
                  type="button"
                  key={key}
                  className={clase.join(" ")}
                  disabled={salidas === 0}
                  aria-pressed={key === value}
                  aria-label={`${dayFormatter.format(new Date(`${key}T12:00:00Z`))}${salidas ? ` · ${salidas} ${salidas === 1 ? "salida" : "salidas"}` : " · sin salidas"}`}
                  onClick={() => {
                    onChange(key);
                    setAbierto(false);
                  }}
                >
                  {numero}
                  {salidas > 0 ? <small aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          <div className="salida-cal-foot">
            <span className="salida-cal-leyenda">
              <small aria-hidden="true" /> con salidas
            </span>
            <button
              type="button"
              className="salida-cal-todas"
              onClick={() => {
                onChange("");
                setAbierto(false);
              }}
            >
              Todas las fechas
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function hoyKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Salta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function unique(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "es"));
}

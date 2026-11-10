"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { diaEfectivo as diaEfectivoDe, diasConSalidas, tiraDeDias, type SalidaOption } from "./salida-picker-utils";
import "./salida-picker.css";

export type { SalidaOption } from "./salida-picker-utils";

function formatFare(priceCents: number, currency: string) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(priceCents / 100);
}

const SEMANA = ["L", "M", "M", "J", "V", "S", "D"];
const monthFormatter = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormatter = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });
const weekdayShort = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });

/**
 * Campo «Salida» del alta manual.
 *
 * Antes: un <select> con todas las salidas futuras en un renglón. Después: las salidas agrupadas por
 * día, todos los días apilados — con la operación real (588 salidas en 71 días) eso eran 71 bloques y
 * el formulario del pasajero quedaba miles de píxeles abajo.
 *
 * Ahora el día es el eje: se elige ruta, la tira de los próximos días (o el calendario para más
 * adelante) y se ven sólo los horarios de ese día, con los lugares libres y la cantidad a reservar.
 */
export function SalidaPicker({ schedules }: { schedules: SalidaOption[] }) {
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [dia, setDia] = useState("");
  const [pickedId, setPickedId] = useState(schedules[0]?.id ?? "");
  const [cantidad, setCantidad] = useState(1);

  const origenes = useMemo(() => unicos(schedules.map((schedule) => schedule.from)), [schedules]);

  // El destino se ofrece en cascada: los que salen del origen elegido.
  const destinos = useMemo(
    () => unicos(schedules.filter((schedule) => !origen || schedule.from === origen).map((schedule) => schedule.to)),
    [schedules, origen]
  );

  const porRuta = useMemo(
    () => schedules.filter((schedule) => (!origen || schedule.from === origen) && (!destino || schedule.to === destino)),
    [schedules, origen, destino]
  );

  // Días con salidas para la ruta elegida, con el conteo que se muestra en cada botón.
  const dias = useMemo(() => diasConSalidas(porRuta), [porRuta]);

  const conteoPorDia = useMemo(() => new Map(dias.map((d) => [d.key, d.count])), [dias]);

  // El día elegido manda; si quedó sin salidas (cambió la ruta), cae en el primero disponible.
  const diaEfectivo = diaEfectivoDe(dias, dia);

  // La tira muestra los próximos días con salidas; si se eligió una fecha lejana en el calendario,
  // se agrega adelante para no perder de vista lo que está seleccionado.
  const tira = useMemo(() => tiraDeDias(dias, diaEfectivo), [dias, diaEfectivo]);

  const matches = useMemo(() => porRuta.filter((schedule) => schedule.dayKey === diaEfectivo), [porRuta, diaEfectivo]);

  const selectedId = matches.some((schedule) => schedule.id === pickedId) ? pickedId : matches[0]?.id ?? "";
  const selected = matches.find((schedule) => schedule.id === selectedId) ?? null;

  // La cantidad nunca puede superar los lugares libres de la salida elegida.
  const maxCantidad = Math.max(selected?.availableSeats ?? 1, 1);
  const cantidadAjustada = Math.min(Math.max(cantidad, 1), maxCantidad);
  useEffect(() => {
    setCantidad((actual) => Math.min(Math.max(actual, 1), maxCantidad));
  }, [maxCantidad]);
  // Lo que se confirma es la salida elegida, no el filtro: la ruta del resumen sale de la salida.
  const rutaElegida = selected ? `${selected.from} → ${selected.to}` : "";

  /** Si el destino elegido no existe para el nuevo origen, se suelta; lo mismo con el día. */
  function cambiarOrigen(value: string) {
    setOrigen(value);
    const destinoSigueValido = !destino || schedules.some((schedule) => schedule.from === value && schedule.to === destino);
    if (!destinoSigueValido) setDestino("");
    const destinoEfectivo = destinoSigueValido ? destino : "";
    const quedan = schedules.some(
      (schedule) => schedule.from === value && (!destinoEfectivo || schedule.to === destinoEfectivo) && schedule.dayKey === dia
    );
    if (dia && !quedan) setDia("");
  }

  function cambiarDestino(value: string) {
    setDestino(value);
    const quedan = schedules.some(
      (schedule) => (!origen || schedule.from === origen) && (!value || schedule.to === value) && schedule.dayKey === dia
    );
    if (dia && !quedan) setDia("");
  }

  return (
    <div className="salida-picker">
      <div className="salida-top">
        <label className="salida-ruta">
          Origen
          <select value={origen} onChange={(event) => cambiarOrigen(event.target.value)}>
            <option value="">Todos</option>
            {origenes.map((opcion) => (
              <option value={opcion} key={opcion}>
                {opcion}
              </option>
            ))}
          </select>
        </label>
        <label className="salida-ruta">
          Destino
          <select value={destino} onChange={(event) => cambiarDestino(event.target.value)}>
            <option value="">Todos</option>
            {destinos.map((opcion) => (
              <option value={opcion} key={opcion}>
                {opcion}
              </option>
            ))}
          </select>
        </label>
        {/* El botón no repite la fecha: la fecha elegida se ve en la tira, esto es la puerta a los
            días que quedan fuera de los próximos siete. */}
        <div className="salida-fecha" role="group" aria-label="Elegir otra fecha">
          <span className="salida-label">Fecha</span>
          <Calendario value={diaEfectivo} counts={conteoPorDia} onChange={setDia} />
        </div>
      </div>

      <div className="salida-tira-wrap">
        <div className="salida-tira" role="group" aria-label="Próximos días con salidas">
          {tira.map((opcion) => (
            <button
              type="button"
              key={opcion.key}
              className="salida-dia"
              data-elegido={opcion.key === diaEfectivo}
              data-hoy={opcion.key === hoyKey()}
              aria-pressed={opcion.key === diaEfectivo}
              title={`${opcion.count} ${opcion.count === 1 ? "salida" : "salidas"}`}
              onClick={() => setDia(opcion.key)}
            >
              <span className="salida-dia-semana">{weekdayShort.format(new Date(`${opcion.key}T12:00:00Z`))}</span>
              <strong className="salida-dia-numero">{Number(opcion.key.slice(-2))}</strong>
              <span className="salida-dia-mes">{monthShort.format(new Date(`${opcion.key}T12:00:00Z`))}</span>
              <small className="salida-dia-cantidad">{opcion.count}</small>
            </button>
          ))}
          {dias.length > tira.length ? (
            <span className="salida-tira-mas" title="El resto de los días se eligen en «Otra fecha»">
              +{dias.length - tira.length} días
            </span>
          ) : null}
        </div>
      </div>

      <fieldset className="salida-field">
        <legend>Salida</legend>
        {matches.length === 0 ? (
          <p className="salida-empty">Sin salidas para esa ruta y fecha.</p>
        ) : (
          <div className="schedule-rail salida-rail" aria-label={`Salidas del día`}>
            {matches.map((schedule) => (
              <label className="schedule-option" key={schedule.id}>
                <input
                  type="radio"
                  name="scheduleId"
                  value={schedule.id}
                  checked={schedule.id === selectedId}
                  onChange={() => setPickedId(schedule.id)}
                  required
                />
                <span className="schedule-card" title={`${schedule.from} → ${schedule.to}`}>
                  <span className="schedule-date">
                    {schedule.status === "DOCUMENTATION"
                      ? "Documentación"
                      : origen && destino
                        ? "Salida"
                        : `${schedule.from} → ${schedule.to}`}
                  </span>
                  <strong className="schedule-time">{schedule.timeLabel}</strong>
                  <span className="schedule-seats">
                    {schedule.availableSeats} {schedule.availableSeats === 1 ? "libre" : "libres"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {selected?.stopFares?.length ? (
        <label className="salida-ruta">
          Dónde baja el pasajero
          <select key={selected.id} name="dropoffStop" defaultValue="">
            <option value="">{selected.to} · {formatFare(selected.priceCents ?? 0, selected.currency ?? "ARS")}</option>
            {selected.stopFares.map((fare) => (
              <option key={fare.name} value={fare.name}>{fare.name} · {formatFare(fare.priceCents, selected.currency ?? "ARS")}</option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="salida-pie">
        <div className="salida-cantidad">
          <span className="salida-cantidad-label">Lugares</span>
          <div className="salida-stepper">
            <button
              type="button"
              aria-label="Un lugar menos"
              disabled={cantidadAjustada <= 1}
              onClick={() => setCantidad(Math.max(1, cantidadAjustada - 1))}
            >
              −
            </button>
            <input
              type="number"
              name="passengerCount"
              min="1"
              max={maxCantidad}
              value={cantidadAjustada}
              onChange={(event) => setCantidad(Number(event.target.value) || 1)}
              onBlur={() => setCantidad(cantidadAjustada)}
              required
            />
            <button
              type="button"
              aria-label="Un lugar más"
              disabled={cantidadAjustada >= maxCantidad}
              onClick={() => setCantidad(Math.min(maxCantidad, cantidadAjustada + 1))}
            >
              +
            </button>
          </div>
        </div>
        <p className="salida-resumen">
          {selected ? (
            <>
              <strong>{selected.dayLabel} · {selected.timeLabel}</strong>
              <span>{rutaElegida}</span>
              <small>{selected.availableSeats} lugares libres</small>
            </>
          ) : (
            "Elegí una salida para continuar."
          )}
        </p>
      </div>
    </div>
  );
}

type CalendarioProps = {
  value: string;
  counts: Map<string, number>;
  onChange: (value: string) => void;
};

/** Mini calendario del filtro Fecha: sólo los días con salidas son clickeables. */
function Calendario({ value, counts, onChange }: CalendarioProps) {
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
        <span>Otra fecha</span>
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
            {SEMANA.map((diaSemana, indice) => (
              <span key={`${diaSemana}-${indice}`}>{diaSemana}</span>
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
                onChange(primeraFechaConSalidas(counts));
                setAbierto(false);
              }}
            >
              Próximo día con salidas
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function unicos(valores: string[]) {
  return [...new Set(valores)].sort((a, b) => a.localeCompare(b, "es"));
}

function primeraFechaConSalidas(counts: Map<string, number>) {
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

function hoyKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Salta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FlotaEnVivo } from "@/lib/driver/en-vivo";
import type { Recorrido } from "@/lib/driver/recorrido";
import type { ServicioEvaluado } from "@/lib/driver/servicios";
import {
  asignarColores,
  distanciaVisible,
  horaSenal,
  nombreUnidad,
  unidadesActuales
} from "@/lib/driver/mapa-vivo";
import { claveUnidad, MapaUnidades } from "./mapa-unidades";

/** Criterio de Jugue en #316: el panel lee cada 30 s (el chofer reporta cada 3 s). */
const REFRESCO_MS = 30_000;
/** El historial se pide aparte: si falla, el mapa de posiciones no se cae. */
const REFRESCO_RECORRIDOS_MS = 60_000;

const ESTADO = {
  "en-movimiento": "En movimiento",
  detenida: "Detenida",
  "sin-senal": "Sin señal"
} as const;

const ORDEN = { "en-movimiento": 0, detenida: 1, "sin-senal": 2 } as const;

function hace(minutos: number) {
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (resto === 0) return horas === 1 ? "hace 1 h" : `hace ${horas} h`;
  return `hace ${horas} h ${resto} min`;
}

function haceSegundos(segundos: number) {
  return segundos < 60 ? "hace instantes" : hace(Math.floor(segundos / 60));
}

function horaCorta(fecha: Date | string | null) {
  if (!fecha) return "";
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  return d.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires"
  });
}

export function FlotaEnVivoMapa({
  inicial,
  recorridosIniciales,
  servicios = [],
  unidadInicial = null
}: {
  inicial: FlotaEnVivo;
  recorridosIniciales: Recorrido[];
  servicios?: ServicioEvaluado[];
  unidadInicial?: string | null;
}) {
  const [flota, setFlota] = useState(inicial);
  const [recorridos, setRecorridos] = useState(recorridosIniciales);
  const [truncado, setTruncado] = useState(false);
  const [mostrar, setMostrar] = useState(true);
  const [seleccion, setSeleccion] = useState<string | null>(() => {
    if (!unidadInicial) return null;
    const encontrada = inicial.naves.find(
      (n) => n.vehicleId === unidadInicial || n.internalNumber === unidadInicial || claveUnidad(n) === unidadInicial
    );
    return encontrada ? claveUnidad(encontrada) : null;
  });
  const [encuadre, setEncuadre] = useState<{ tipo: "todas" | "recorrido"; numero: number }>({
    tipo: "todas",
    numero: 0
  });
  const [errorPosiciones, setErrorPosiciones] = useState("");
  const [errorHistorial, setErrorHistorial] = useState("");
  const [reloj, setReloj] = useState(() => Date.now());

  useEffect(() => {
    if (!unidadInicial) return;
    const encontrada = flota.naves.find(
      (n) => n.vehicleId === unidadInicial || n.internalNumber === unidadInicial || claveUnidad(n) === unidadInicial
    );
    if (encontrada) setSeleccion(claveUnidad(encontrada));
  }, [unidadInicial, flota.naves]);

  // La antigüedad se recalcula con el reloj local: si el servidor no responde, la pantalla no sigue
  // diciendo «hace 1 min» para siempre.
  const naves = useMemo(
    () => unidadesActuales(flota.naves, reloj, flota.ventanaMinutos),
    [flota.naves, flota.ventanaMinutos, reloj]
  );

  /** Metros por tramo, sumados sólo para la unidad que ese chofer tiene ahora. */
  const metrosPorUnidad = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const tramo of recorridos) {
      const actual = naves.find((nave) => claveUnidad(nave) === claveUnidad(tramo));
      if (!actual) continue;
      mapa.set(claveUnidad(tramo), (mapa.get(claveUnidad(tramo)) ?? 0) + tramo.metros);
    }
    return mapa;
  }, [recorridos, naves]);

  /** Servicio actual o próximo asignado a cada unidad hoy, para mostrarlo en la tarjeta lateral. */
  const servicioPorVehiculo = useMemo(() => {
    const mapa = new Map<string, ServicioEvaluado>();
    const vigentes = servicios
      .filter((s) => s.nivel !== "pasado")
      .sort((a, b) => (a.minutosParaSalir ?? 9_999) - (b.minutosParaSalir ?? 9_999));
    for (const srv of vigentes) {
      for (const u of srv.unidades) {
        if (!mapa.has(u.vehicleId)) mapa.set(u.vehicleId, srv);
      }
    }
    return mapa;
  }, [servicios]);

  const filas = useMemo(() => {
    const vivas = naves
      .map((nave) => ({
        clave: claveUnidad(nave),
        nave,
        nombre: nave.driverName ?? "Chofer sin nombre",
        unidad: nombreUnidad(nave),
        metros: metrosPorUnidad.get(claveUnidad(nave)) ?? null,
        servicio: servicioPorVehiculo.get(nave.vehicleId) ?? null,
        detalle:
          nave.estado === "detenida"
            ? `Parado ${haceSegundos(nave.stoppedDurationSeconds)}`
            : nave.estado === "sin-senal"
              ? `Sin reportar ${hace(nave.minutosDesdeLaSenal)}`
              : nave.speedKmh != null
                ? `Circulando ${Math.round(nave.speedKmh)} km/h`
                : "Circulando"
      }))
      .sort(
        (a, b) => ORDEN[a.nave.estado] - ORDEN[b.nave.estado] || a.nombre.localeCompare(b.nombre, "es")
      );
    return { vivas, sinDato: flota.sinUbicacion };
  }, [naves, metrosPorUnidad, servicioPorVehiculo, flota.sinUbicacion]);

  /** Un color por chofer, estable y sin repetir mientras alcance la paleta. */
  const colores = useMemo(
    () => asignarColores([...naves.map((nave) => nave.driverId), ...recorridos.map((tramo) => tramo.driverId)]),
    [naves, recorridos]
  );

  const seleccionada = seleccion ? naves.find((nave) => claveUnidad(nave) === seleccion) ?? null : null;
  const tramosSeleccionados = seleccion
    ? recorridos.filter((tramo) => claveUnidad(tramo) === seleccion)
    : [];
  const servicioSeleccionado = seleccionada ? servicioPorVehiculo.get(seleccionada.vehicleId) ?? null : null;

  const seleccionar = useCallback((clave: string) => {
    setSeleccion((actual) => (actual === clave ? null : clave));
  }, []);

  useEffect(() => {
    const intervalo = window.setInterval(() => setReloj(Date.now()), 5_000);
    return () => window.clearInterval(intervalo);
  }, []);

  const traerPosiciones = useCallback(async (senal?: AbortSignal) => {
    try {
      const respuesta = await fetch("/api/v1/admin/driver-locations", { cache: "no-store", signal: senal });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const datos = (await respuesta.json()) as { flota: FlotaEnVivo };
      setFlota(datos.flota);
      setReloj(Date.now());
      setErrorPosiciones("");
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setErrorPosiciones("No pudimos actualizar las posiciones. Reintentamos cada 30 s.");
    }
  }, []);

  const traerRecorridos = useCallback(async (senal?: AbortSignal) => {
    try {
      const respuesta = await fetch("/api/v1/admin/driver-trails", { cache: "no-store", signal: senal });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const datos = (await respuesta.json()) as { recorridos: Recorrido[]; truncado?: boolean };
      setRecorridos(datos.recorridos);
      setTruncado(Boolean(datos.truncado));
      setErrorHistorial("");
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      // No se vacía la línea que ya estaba: un timeout no debe borrar el recorrido.
      setErrorHistorial("No pudimos actualizar los recorridos. Seguimos mostrando los últimos que trajimos.");
    }
  }, []);

  useEffect(() => {
    const control = new AbortController();
    const intervalo = window.setInterval(() => void traerPosiciones(control.signal), REFRESCO_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") void traerPosiciones(control.signal);
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      control.abort();
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [traerPosiciones]);

  useEffect(() => {
    const control = new AbortController();
    const intervalo = window.setInterval(() => void traerRecorridos(control.signal), REFRESCO_RECORRIDOS_MS);
    return () => {
      control.abort();
      window.clearInterval(intervalo);
    };
  }, [traerRecorridos]);

  const segundos = Math.max(0, Math.floor((reloj - Date.parse(flota.actualizadoEn)) / 1000));
  const vivas = naves.filter((nave) => nave.estado !== "sin-senal").length;

  return (
    <section className="flota-en-vivo">
      <div className="flota-toolbar">
        <div className="flota-en-vivo-estado" role="status" aria-live="polite">
          <span className="flota-leyenda">
            <span className="flota-punto is-en-movimiento" aria-hidden="true" /> {vivas} reportando
          </span>
          <span className="flota-leyenda">
            <span className="flota-punto is-sin-senal" aria-hidden="true" /> {naves.length - vivas} sin señal
          </span>
          <span className="flota-leyenda">
            <span className="flota-punto is-recorrido" aria-hidden="true" /> {recorridos.length} tramo
            {recorridos.length === 1 ? "" : "s"} de recorrido
          </span>
          <span className="flota-en-vivo-refresco">
            {segundos < 60 ? `Actualizado hace ${segundos} s` : `Actualizado ${hace(Math.floor(segundos / 60))}`}
          </span>
        </div>

        <div className="flota-controles">
          <button
            type="button"
            className="flota-toggle"
            aria-pressed={mostrar}
            onClick={() => setMostrar((valor) => !valor)}
          >
            {mostrar ? "Ocultar recorridos" : "Ver recorridos"}
          </button>
          <button
            type="button"
            className="flota-toggle"
            onClick={() => setEncuadre((e) => ({ tipo: "todas", numero: e.numero + 1 }))}
          >
            Ver todas
          </button>
          <button
            type="button"
            className="flota-toggle"
            disabled={!seleccion || tramosSeleccionados.length === 0}
            onClick={() => setEncuadre((e) => ({ tipo: "recorrido", numero: e.numero + 1 }))}
          >
            Encuadrar recorrido
          </button>
          {seleccion ? (
            <button type="button" className="flota-toggle" onClick={() => setSeleccion(null)}>
              Quitar selección
            </button>
          ) : null}
          <button
            type="button"
            className="flota-toggle"
            onClick={() => {
              void traerPosiciones();
              void traerRecorridos();
            }}
          >
            Actualizar ahora
          </button>
        </div>
      </div>

      {errorPosiciones ? (
        <p className="flota-en-vivo-error" role="alert">
          {errorPosiciones}
        </p>
      ) : null}
      {errorHistorial ? (
        <p className="flota-en-vivo-error" role="alert">
          {errorHistorial}{" "}
          <button type="button" className="flota-enlace" onClick={() => void traerRecorridos()}>
            Reintentar
          </button>
        </p>
      ) : null}
      {truncado ? (
        <p className="flota-aviso" role="status">
          El historial superó el máximo que se lee de una vez: algún recorrido puede empezar más tarde de
          lo que pasó en realidad.
        </p>
      ) : null}

      <div className="flota-en-vivo-grid">
        <div className="flota-mapa-col">
          <MapaUnidades
            naves={naves}
            recorridos={recorridos}
            mostrar={mostrar}
            seleccion={seleccion}
            onSeleccion={seleccionar}
            encuadre={encuadre}
            colores={colores}
          />
          <p className="flota-mapa-leyenda">
            <span><i className="inicio" aria-hidden="true" /> círculo hueco: dónde arrancó el tramo</span>
            <span><i className="sentido" aria-hidden="true" /> flecha: para dónde fue</span>
            <span><i className="fin" aria-hidden="true" /> punto lleno: última posición del tramo</span>
            <span>cada unidad tiene su color, igual que en la lista</span>
          </p>
        </div>

        <aside className="flota-panel" aria-label="Unidades y choferes">
          <h2>
            Unidades <span>{filas.vivas.length}</span>
          </h2>
          {filas.vivas.length === 0 ? (
            <p className="flota-panel-vacio">
              Ninguna unidad está reportando. La posición aparece cuando el chofer abre su panel en el
              celular.
            </p>
          ) : (
            <ul>
              {filas.vivas.map((fila) => {
                const activa = fila.clave === seleccion;
                return (
                  <li key={fila.clave}>
                    <button
                      type="button"
                      className="flota-fila"
                      data-estado={fila.nave.estado}
                      aria-pressed={activa}
                      onClick={() => seleccionar(fila.clave)}
                      title={activa ? "Quitar selección" : "Ver esta unidad en el mapa"}
                    >
                      <span
                        className="flota-fila-color"
                        style={{ background: colores.get(fila.nave.driverId) ?? "#c9c4ba" }}
                        aria-hidden="true"
                      />
                      <span className="flota-fila-texto">
                        <span className="flota-fila-top">
                          <strong>{fila.unidad}</strong>
                          <span className="flota-fila-hora">{horaSenal(fila.nave.recordedAt)}</span>
                        </span>
                        <span className="flota-fila-chofer">{fila.nombre}</span>
                        <small>
                          {ESTADO[fila.nave.estado]} · {fila.detalle}
                        </small>
                        <small className="flota-fila-recorrido">
                          {fila.metros != null && fila.metros > 0
                            ? `Recorrido ≈ ${distanciaVisible(fila.metros)}`
                            : "Sin recorrido todavía"}
                        </small>
                        {fila.servicio ? (
                          <small className={`flota-fila-servicio is-${fila.servicio.nivel}`}>
                            {fila.servicio.enCurso ? "Ahora" : horaCorta(fila.servicio.at)} · {fila.servicio.titulo}
                            {fila.servicio.pasajeros > 0 ? ` (${fila.servicio.pasajeros} pas.)` : ""}
                          </small>
                        ) : (
                          <small className="flota-fila-servicio is-libre">Sin servicio próximo hoy</small>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {filas.sinDato.length > 0 ? (
            <>
              <h2>
                Sin ubicación <span>{filas.sinDato.length}</span>
              </h2>
              <ul>
                {filas.sinDato.map((chofer) => (
                  <li key={chofer.driverId}>
                    <div className="flota-fila" data-estado="sin-dato">
                      <span className="flota-punto is-sin-dato" aria-hidden="true" />
                      <span className="flota-fila-texto">
                        <strong>{chofer.driverName ?? "Chofer sin nombre"}</strong>
                        <small>No mandó posición nunca</small>
                      </span>
                      <span className="flota-fila-hora">—</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {seleccion ? (
            <div className="flota-detalle">
              <h2>Seleccionado</h2>
              <p>
                {seleccionada
                  ? `${nombreUnidad(seleccionada)} · ${seleccionada.driverName ?? "Chofer"}`
                  : "Unidad sin posición actual"}
              </p>
              <p className="flota-detalle-dato">
                {tramosSeleccionados.length
                  ? `${tramosSeleccionados.length} tramo${tramosSeleccionados.length === 1 ? "" : "s"} · ≈ ${distanciaVisible(
                      tramosSeleccionados.reduce((total, tramo) => total + tramo.metros, 0)
                    )} en la ventana`
                  : "Esa unidad no tiene recorrido en la ventana."}
              </p>
              {servicioSeleccionado ? (
                <p className="flota-detalle-dato">
                  Servicio: <Link href={servicioSeleccionado.href}>{servicioSeleccionado.titulo}</Link> (
                  {servicioSeleccionado.enCurso ? "en curso" : horaCorta(servicioSeleccionado.at)})
                </p>
              ) : null}
              {seleccionada ? (
                <p className="flota-detalle-links">
                  <Link href={`/admin/naves/${seleccionada.vehicleId}`}>Ficha de la nave</Link>
                  {" · "}
                  <Link href={`/admin/naves/${seleccionada.vehicleId}/recorridos`}>Historial de servicios</Link>
                </p>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

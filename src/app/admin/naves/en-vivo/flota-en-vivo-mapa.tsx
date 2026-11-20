"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import type { EstadoDeNaveEnVivo, FlotaEnVivo, NaveEnVivo } from "@/lib/driver/en-vivo";
import "leaflet/dist/leaflet.css";

/** Cada cuánto se vuelven a pedir las posiciones. El chofer reporta cada 3 s; 10 s alcanza para
 *  ver la nave moverse sin castigar la base ni el teléfono de quien mira. */
const REFRESCO_MS = 10_000;

/** San Martín de los Andes: el encuadre inicial cuando todavía no hay ninguna nave reportando. */
const CENTRO_SMA: [number, number] = [-40.1579, -71.3534];

const ETIQUETA: Record<EstadoDeNaveEnVivo, string> = {
  "en-movimiento": "En movimiento",
  detenida: "Detenida",
  "sin-senal": "Sin señal"
};

const horaArgentina = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function hace(minutos: number) {
  if (minutos <= 0) return "recién";
  return minutos === 1 ? "hace 1 min" : `hace ${minutos} min`;
}

function nombreDeNave(nave: NaveEnVivo) {
  return nave.internalNumber ? `Interno ${nave.internalNumber}` : nave.vehicleName;
}

function detalleDeNave(nave: NaveEnVivo) {
  const partes = [ETIQUETA[nave.estado], nave.driverName ?? "sin chofer"];
  if (nave.estado !== "sin-senal" && nave.speedKmh != null) partes.push(`${Math.round(nave.speedKmh)} km/h`);
  partes.push(hace(nave.minutosDesdeLaSenal));
  return partes.join(" · ");
}

export function FlotaEnVivoMapa({ inicial }: { inicial: FlotaEnVivo }) {
  const [flota, setFlota] = useState(inicial);
  const [error, setError] = useState("");
  const [reloj, setReloj] = useState(() => Date.now());
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<LeafletMap | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const marcadores = useRef(new Map<string, Marker>());
  const encuadreHecho = useRef(false);

  const sincronizar = useCallback((datos: FlotaEnVivo) => {
    const L = leaflet.current;
    const map = mapa.current;
    if (!L || !map) return;

    const vistos = new Set<string>();
    for (const nave of datos.naves) {
      vistos.add(nave.vehicleId);
      const posicion: [number, number] = [nave.latitude, nave.longitude];
      const icono = L.divIcon({
        className: `flota-pin is-${nave.estado}`,
        html: "<span></span>",
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -12]
      });
      const globo = () => {
        const el = document.createElement("div");
        el.className = "flota-globo";
        const titulo = document.createElement("strong");
        titulo.textContent = nombreDeNave(nave);
        const linea = document.createElement("span");
        linea.textContent = detalleDeNave(nave);
        const hora = document.createElement("small");
        hora.textContent = `Última señal: ${horaArgentina.format(new Date(nave.recordedAt))}`;
        el.append(titulo, linea, hora);
        return el;
      };

      const existente = marcadores.current.get(nave.vehicleId);
      if (existente) {
        existente.setLatLng(posicion);
        existente.setIcon(icono);
        existente.setPopupContent(globo());
        continue;
      }

      const marcador = L.marker(posicion, { icon: icono, title: nombreDeNave(nave) }).addTo(map);
      marcador.bindPopup(globo);
      marcadores.current.set(nave.vehicleId, marcador);
    }

    for (const [vehicleId, marcador] of marcadores.current) {
      if (vistos.has(vehicleId)) continue;
      marcador.remove();
      marcadores.current.delete(vehicleId);
    }

    // El encuadre se hace una sola vez: si se repitiera en cada refresco, el mapa se movería solo
    // mientras el operador lo está mirando. Incluye las naves sin señal: su última posición también
    // tiene que entrar en el encuadre, si no «no desaparecen» sólo en la lista.
    if (!encuadreHecho.current && datos.naves.length > 0) {
      map.fitBounds(datos.naves.map((nave) => [nave.latitude, nave.longitude] as [number, number]), {
        padding: [48, 48],
        maxZoom: 14
      });
      encuadreHecho.current = true;
    }
  }, []);

  useEffect(() => {
    let cancelado = false;

    async function crearMapa() {
      const L = await import("leaflet");
      if (cancelado || !contenedor.current || mapa.current) return;
      const map = L.map(contenedor.current, { scrollWheelZoom: true, zoomControl: true }).setView(CENTRO_SMA, 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19
      }).addTo(map);
      leaflet.current = L;
      mapa.current = map;
      window.setTimeout(() => map.invalidateSize(), 150);
      sincronizar(flota);
    }

    void crearMapa();

    return () => {
      cancelado = true;
      mapa.current?.remove();
      mapa.current = null;
      leaflet.current = null;
      marcadores.current.clear();
    };
    // `flota` sólo se usa para el primer dibujo; los refrescos los maneja el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sincronizar]);

  useEffect(() => {
    sincronizar(flota);
  }, [flota, sincronizar]);

  useEffect(() => {
    let cancelado = false;

    async function traer() {
      try {
        const respuesta = await fetch("/api/v1/admin/driver-locations", { cache: "no-store" });
        if (!respuesta.ok) throw new Error("sin respuesta");
        const datos = (await respuesta.json()) as { flota: FlotaEnVivo };
        if (cancelado) return;
        setFlota(datos.flota);
        setReloj(Date.now());
        setError("");
      } catch {
        if (!cancelado) setError("No pudimos actualizar las posiciones. Seguimos reintentando.");
      }
    }

    const intervalo = window.setInterval(() => void traer(), REFRESCO_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") void traer();
    };
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      cancelado = true;
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  useEffect(() => {
    const intervalo = window.setInterval(() => setReloj(Date.now()), 5000);
    return () => window.clearInterval(intervalo);
  }, []);

  const segundosDesdeLaActualizacion = Math.max(
    0,
    Math.floor((reloj - new Date(flota.actualizadoEn).getTime()) / 1000)
  );
  const vivas = flota.naves.filter((nave) => nave.estado !== "sin-senal").length;
  const sinSenal = flota.naves.length - vivas;

  function enfocar(nave: NaveEnVivo) {
    const map = mapa.current;
    if (!map) return;
    map.panTo([nave.latitude, nave.longitude], { animate: true });
    marcadores.current.get(nave.vehicleId)?.openPopup();
  }

  return (
    <section className="flota-en-vivo">
      <div className="flota-en-vivo-estado" role="status">
        <span>
          <span className="flota-punto is-en-movimiento" aria-hidden="true" /> {vivas} reportando
        </span>
        <span>
          <span className="flota-punto is-sin-senal" aria-hidden="true" /> {sinSenal} sin señal
        </span>
        <span className="flota-en-vivo-refresco">
          Actualizado {segundosDesdeLaActualizacion < 60 ? `hace ${segundosDesdeLaActualizacion} s` : hace(Math.floor(segundosDesdeLaActualizacion / 60))}
        </span>
      </div>

      {error ? (
        <p className="flota-en-vivo-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flota-en-vivo-grid">
        <div ref={contenedor} className="flota-mapa" role="application" aria-label="Mapa de las naves en vivo" />

        <aside className="flota-panel">
          <h2>
            Naves <span>{flota.naves.length}</span>
          </h2>
          {flota.naves.length === 0 ? (
            <p className="flota-panel-vacio">
              Todavía no hay ninguna nave reportando. La posición llega cuando el chofer abre su panel
              en el celular.
            </p>
          ) : (
            <ul>
              {flota.naves.map((nave) => (
                <li key={nave.vehicleId}>
                  <button type="button" className="flota-fila" data-estado={nave.estado} onClick={() => enfocar(nave)}>
                    <span className={`flota-punto is-${nave.estado}`} aria-hidden="true" />
                    <span className="flota-fila-texto">
                      <strong>{nombreDeNave(nave)}</strong>
                      <small>{detalleDeNave(nave)}</small>
                    </span>
                    <span className="flota-fila-hora">{horaArgentina.format(new Date(nave.recordedAt))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {flota.sinUbicacion.length > 0 ? (
            <>
              <h2>
                Sin ubicación <span>{flota.sinUbicacion.length}</span>
              </h2>
              <p className="flota-panel-vacio">
                Choferes activos que todavía no mandaron una posición: puede que no hayan abierto la app o
                que el navegador les haya negado el permiso.
              </p>
              <ul>
                {flota.sinUbicacion.map((chofer) => (
                  <li key={chofer.driverId}>
                    <span className="flota-fila" data-estado="sin-dato">
                      <span className="flota-punto is-sin-dato" aria-hidden="true" />
                      <span className="flota-fila-texto">
                        <strong>{chofer.driverName ?? "Chofer sin nombre"}</strong>
                        <small>Sin ubicación</small>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

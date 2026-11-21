"use client";

import { useEffect, useRef, useState } from "react";
import type { CircleMarker, CircleMarkerOptions, Layer, Map as LeafletMap, Marker, Polyline } from "leaflet";
import type { NaveEnVivo } from "@/lib/driver/en-vivo";
import type { Recorrido } from "@/lib/driver/recorrido";
import { distanciaVisible, horaSenal, nombreUnidad, puedeAnimar } from "@/lib/driver/mapa-vivo";
import "leaflet/dist/leaflet.css";

export const claveUnidad = (n: { driverId: string; vehicleId: string }) => `${n.driverId}/${n.vehicleId}`;
const ESTADO = { "en-movimiento": "En movimiento", detenida: "Detenida", "sin-senal": "Sin señal" };
const textoSeguro = (texto: string) => { const el = document.createElement("span"); el.textContent = texto; return el; };

export function MapaUnidades({ naves, recorridos, mostrar, seleccion, onSeleccion, encuadre, colores }: {
  naves: NaveEnVivo[]; recorridos: Recorrido[]; mostrar: boolean; seleccion: string | null;
  onSeleccion: (clave: string) => void; encuadre: { tipo: "todas" | "recorrido"; numero: number };
  colores: Map<string, string>;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<LeafletMap | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const pins = useRef(new Map<string, { marker: Marker; dato: NaveEnVivo }>());
  const lineas = useRef<Layer[]>([]);
  const animaciones = useRef(new Map<string, number>());
  const seleccionRef = useRef(onSeleccion);
  seleccionRef.current = onSeleccion;
  const inicial = useRef(false);
  const [listo, setListo] = useState(false);
  const [errorMapa, setErrorMapa] = useState("");
  const [errorTiles, setErrorTiles] = useState(false);

  useEffect(() => {
    let cancelado = false;
    let observer: ResizeObserver | undefined;
    void import("leaflet").then((L) => {
      if (cancelado || !contenedor.current) return;
      const map = L.map(contenedor.current, { scrollWheelZoom: false }).setView([-40.1579, -71.3534], 12);
      // OSM estándar (sin API key) y el fondo se atenúa por CSS: así quedan las calles como referencia
      // pero el color de los recorridos gana. Los mapas claros de CARTO ahora exigen clave y meten marca.
      const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors", maxZoom: 19
      }).addTo(map);
      tiles.on("tileerror", () => { if (!cancelado) setErrorTiles(true); });
      leaflet.current = L;
      mapa.current = map;
      observer = new ResizeObserver(() => map.invalidateSize());
      observer.observe(contenedor.current);
      setListo(true);
    }).catch(() => { if (!cancelado) setErrorMapa("No se pudo cargar el mapa. La lista de unidades sigue disponible; recargá la página para reintentar."); });
    return () => {
      cancelado = true;
      observer?.disconnect();
      for (const id of animaciones.current.values()) cancelAnimationFrame(id);
      animaciones.current.clear();
      mapa.current?.remove();
      mapa.current = null;
      pins.current.clear();
      lineas.current = [];
      inicial.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapa.current;
    const L = leaflet.current;
    if (!listo || !map || !L) return;
    const vistos = new Set<string>();
    // Con la pestaña en segundo plano el navegador frena `requestAnimationFrame`: si se animara, el
    // pin quedaría clavado en la posición vieja hasta que alguien mire. Ahí se salta directo.
    const reducir =
      matchMedia("(prefers-reduced-motion: reduce)").matches || document.visibilityState !== "visible";
    for (const nave of naves) {
      const key = nave.vehicleId;
      vistos.add(key);
      const posicion: [number, number] = [nave.latitude, nave.longitude];
      const globo = document.createElement("div");
      globo.className = "flota-globo";
      for (const texto of [nombreUnidad(nave), nave.driverName ?? "Chofer sin nombre", ESTADO[nave.estado],
        `Última señal: ${horaSenal(nave.recordedAt)} · hace ${nave.minutosDesdeLaSenal} min`]) globo.append(textoSeguro(texto));
      const colorUnidad = colores.get(nave.driverId) ?? "#4f6a62";
      const icon = L.divIcon({
        className: `flota-pin is-${nave.estado}`, html: `<span style="border-color:${colorUnidad}"></span>`,
        iconSize: [22, 22], iconAnchor: [11, 11]
      });
      let entrada = pins.current.get(key);
      if (!entrada) {
        const marker = L.marker(posicion, { icon, title: nombreUnidad(nave) }).addTo(map).bindPopup(globo);
        marker.on("click", () => { const actual = pins.current.get(key); if (actual) seleccionRef.current(claveUnidad(actual.dato)); });
        entrada = { marker, dato: nave };
        pins.current.set(key, entrada);
        marker.bindTooltip(textoSeguro(nombreUnidad(nave)), { permanent: true, direction: "top", offset: [0, -11], className: "flota-pin-etiqueta" });
      } else {
        const { marker, dato: anterior } = entrada;
        marker.setIcon(icon).setPopupContent(globo);
        marker.setTooltipContent(textoSeguro(nombreUnidad(nave)));
        const nuevoReporte = anterior.recordedAt !== nave.recordedAt || anterior.driverId !== nave.driverId;
        if (nuevoReporte || nave.estado === "sin-senal") {
          const raf = animaciones.current.get(key);
          if (raf != null) cancelAnimationFrame(raf);
          animaciones.current.delete(key);
          if (nuevoReporte && puedeAnimar(anterior, nave, reducir)) {
            const origen = marker.getLatLng();
            const inicio = performance.now();
            const avanzar = (ahora: number) => {
              const t = Math.min(1, (ahora - inicio) / 1000);
              marker.setLatLng([origen.lat + (posicion[0] - origen.lat) * t, origen.lng + (posicion[1] - origen.lng) * t]);
              if (t < 1) animaciones.current.set(key, requestAnimationFrame(avanzar));
              else animaciones.current.delete(key);
            };
            animaciones.current.set(key, requestAnimationFrame(avanzar));
          } else marker.setLatLng(posicion);
        }
        entrada.dato = nave;
      }
      entrada.marker.setOpacity(seleccion && claveUnidad(nave) !== seleccion ? 0.45 : 1);
      entrada.marker.setZIndexOffset(claveUnidad(nave) === seleccion ? 1000 : 0);
    }
    for (const [key, entrada] of pins.current) {
      if (vistos.has(key)) continue;
      const raf = animaciones.current.get(key);
      if (raf != null) cancelAnimationFrame(raf);
      animaciones.current.delete(key);
      entrada.marker.remove(); pins.current.delete(key);
    }
  }, [listo, naves, seleccion]);

  /**
   * Encuadre inicial una sola vez, incluyendo los recorridos: si sólo entran los puntos actuales, la
   * línea se sale del mapa y aparece cortada. Los refrescos siguientes no reencuadran, para no moverle
   * el mapa al operador mientras lo está mirando.
   */
  useEffect(() => {
    if (!listo || !mapa.current || inicial.current) return;
    const puntos: [number, number][] = [
      ...naves.map(n => [n.latitude, n.longitude] as [number, number]),
      ...(mostrar ? recorridos.flatMap(r => r.puntos.map(p => p.punto)) : [])
    ];
    if (!puntos.length) return;
    mapa.current.fitBounds(puntos, { padding: [45, 45], maxZoom: 14 });
    inicial.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, naves, recorridos, mostrar]);

  useEffect(() => {
    const map = mapa.current;
    const L = leaflet.current;
    if (!listo || !map || !L) return;
    for (const linea of lineas.current) linea.remove();
    lineas.current = [];
    if (!mostrar) return;
    for (const recorrido of recorridos) {
      if (recorrido.puntos.length < 2 || (seleccion && claveUnidad(recorrido) !== seleccion)) continue;
      const puntos = recorrido.puntos.map(p => p.punto);
      const color = colores.get(recorrido.driverId) ?? "#4f6a62";
      // Un halo blanco debajo: sobre el mapa de calles el trazo solo se perdía entre rutas y etiquetas.
      const halo = L.polyline(puntos, {
        color: "#ffffff", weight: seleccion ? 8 : 6, opacity: 0.85, lineCap: "round", lineJoin: "round"
      }).addTo(map);
      const linea = L.polyline(puntos, {
        color, weight: seleccion ? 4.5 : 3.5, opacity: 0.95, lineCap: "round", lineJoin: "round"
      }).addTo(map);
      // Inicio (hueco) y última posición del tramo: sin esto el trazo no dice para dónde fue.
      const salida = L.circleMarker(puntos[0], {
        radius: 4, color, weight: 2, fillColor: "#ffffff", fillOpacity: 1
      }).addTo(map);
      const ultimo = puntos[puntos.length - 1];
      const anterior = puntos[puntos.length - 2] ?? ultimo;
      const rumbo = (Math.atan2(ultimo[1] - anterior[1], ultimo[0] - anterior[0]) * 180) / Math.PI;
      const llegada = L.marker(ultimo, {
        interactive: false,
        icon: L.divIcon({
          className: "flota-flecha", iconSize: [18, 18], iconAnchor: [9, 9],
          html: `<span style="transform:rotate(${90 - rumbo}deg);border-bottom-color:${color}"></span>`
        })
      }).addTo(map);
      lineas.current.push(salida, llegada);
      linea.bindTooltip(textoSeguro(`${recorrido.driverName ?? "Chofer"} · ${recorrido.internalNumber ?? recorrido.vehicleName} · ≈ ${distanciaVisible(recorrido.metros)}`), { sticky: true });
      linea.on("click", () => seleccionRef.current(claveUnidad(recorrido)));
      lineas.current.push(halo, linea);
    }
  }, [listo, recorridos, seleccion, mostrar, colores]);

  useEffect(() => {
    if (!listo || !mapa.current || encuadre.numero === 0) return;
    const puntos: [number, number][] = encuadre.tipo === "recorrido"
      ? recorridos.filter(r => !seleccion || claveUnidad(r) === seleccion).flatMap(r => r.puntos.map(p => p.punto))
      : naves.map(n => [n.latitude, n.longitude]);
    if (puntos.length) mapa.current.fitBounds(puntos, { padding: [48, 48], maxZoom: 15, animate: false });
    // Sólo una acción del operador cambia el encuadre, nunca el polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encuadre, listo]);

  useEffect(() => {
    if (!seleccion || !listo) return;
    const entrada = [...pins.current.values()].find(p => claveUnidad(p.dato) === seleccion);
    if (entrada && mapa.current) {
      mapa.current.panTo(entrada.marker.getLatLng(), { animate: !matchMedia("(prefers-reduced-motion: reduce)").matches });
      entrada.marker.openPopup();
    }
  }, [seleccion, listo]);

  return <div className="flota-mapa-wrap">
    <div ref={contenedor} className="flota-mapa" aria-label="Mapa de últimas posiciones y recorridos" />
    {errorMapa ? <p className="flota-en-vivo-error" role="alert">{errorMapa}</p> : !listo ? <p role="status">Cargando mapa…</p> : null}
    {errorTiles && <p className="flota-en-vivo-error" role="status">El mapa base no cargó por completo. Las posiciones y la lista siguen disponibles.</p>}
  </div>;
}

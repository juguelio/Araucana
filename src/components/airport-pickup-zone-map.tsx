"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { CircleMarker, LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { airportPickupLimits, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import styles from "./airport-address-map.module.css";

export function AirportPickupZoneMap({ coverage, point, onSelect, selectedRing, onMoveVertex, arrival = false }: {
  coverage?: AirportCoverage;
  point: PickupPoint | null;
  onSelect: (point: PickupPoint) => void;
  /** Índice del contorno en edición (0 = perímetro, 1… = excluidos) o `"extra"` para la zona con recargo. */
  selectedRing?: number | "extra";
  onMoveVertex?: (index: number, point: PickupPoint) => void;
  arrival?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<CircleMarker | null>(null);
  const shapes = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const selectOnMap = useEffectEvent(onSelect);
  const moveVertex = useEffectEvent((index: number, point: PickupPoint) => onMoveVertex?.(index, point));

  useEffect(() => {
    let cancelled = false;
    async function setup() {
      const L = await import("leaflet");
      if (cancelled || !container.current) return;
      const instance = L.map(container.current, { scrollWheelZoom: false }).setView([-40.153, -71.344], 14);
      map.current = instance;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
      }).addTo(instance);
      shapes.current = L.layerGroup().addTo(instance);
      marker.current = L.circleMarker(instance.getCenter(), { radius: 7, color: "#0645ad", fillOpacity: 1 });
      instance.on("click", ({ latlng }) => selectOnMap([latlng.lat, latlng.lng]));
      setReady(true);
    }
    void setup().catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
      shapes.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !coverage) return;
    let cancelled = false;
    void import("leaflet").then((L) => {
      const group = shapes.current;
      if (cancelled || !group) return;
      group.clearLayers();
      // La zona con recargo va primero: queda debajo del verde y de los sectores excluidos.
      const rings: Array<{ ring: PickupPoint[]; color: string; key: number | "extra"; fill: number }> = [
        { ring: coverage.extraBoundary ?? [], color: "#d07a12", key: "extra", fill: 0.12 },
        { ring: coverage.boundary, color: "#267247", key: 0, fill: 0.18 },
        ...coverage.exclusions.map((ring, i) => ({ ring, color: "#a52a26", key: i + 1, fill: 0.18 }))
      ];
      rings.forEach(({ ring, color, key, fill }) => {
        const style = { color, fillOpacity: fill, interactive: false, weight: selectedRing === key ? 5 : 3 };
        if (ring.length >= 3) L.polygon(ring, style).addTo(group);
        else if (ring.length === 2) L.polyline(ring, style).addTo(group);
        if (selectedRing === key) {
          ring.forEach((vertex, vertexIndex) => {
            const handle = L.marker(vertex, {
              draggable: true,
              icon: L.divIcon({ className: styles.vertex, iconSize: [14, 14] }),
              title: `Mover punto ${vertexIndex + 1}`
            }).addTo(group);
            handle.on("dragend", () => {
              const { lat, lng } = handle.getLatLng();
              moveVertex(vertexIndex, [lat, lng]);
            });
          });
        }
      });
      L.polyline(airportPickupLimits, { color: "#c52222", dashArray: "5 5", interactive: false }).addTo(group);
    });
    return () => { cancelled = true; };
  }, [coverage, ready, selectedRing]);

  useEffect(() => {
    if (!ready || !map.current || !marker.current) return;
    if (point) marker.current.setLatLng(point).addTo(map.current);
    else marker.current.remove();
  }, [point, ready]);

  const pointLabel = arrival ? "punto de destino" : "punto de búsqueda";

  return (
    <div className={styles.map}>
      <strong>{coverage ? "Mapa de cobertura" : `Confirmá el ${pointLabel}`}</strong>
      <p className="muted">{coverage ? "Hacé clic para agregar puntos al contorno o arrastrá un punto para moverlo." : "Buscá la dirección en Google Maps y marcá el mismo lugar en este mapa."}</p>
      <div className={styles.zoneMap}>
        <div ref={container} className={styles.zoneCanvas} aria-label={coverage ? "Mapa de cobertura de búsqueda para el aeropuerto" : `Mapa del ${pointLabel}`} />
        {ready ? <span className={styles.crosshair} aria-hidden="true">+</span> : null}
      </div>
      <button className="ghost-button" type="button" disabled={!ready} onClick={() => {
        const center = map.current?.getCenter();
        if (center) onSelect([center.lat, center.lng]);
      }}>{coverage ? "Agregar punto en el centro" : "Marcar el punto central"}</button>
      {failed ? <p className="field-error" role="alert">No pudimos cargar el mapa.</p> : null}
    </div>
  );
}

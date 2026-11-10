"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { CircleMarker, LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { airportPickupLimits, isInsideAirportPickupZone, OUTSIDE_PICKUP_ZONE, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import styles from "./airport-address-map.module.css";

export function AirportPickupZoneMap({ coverage, point, onSelect, editing = false, selectedRing, onMoveVertex }: {
  coverage: AirportCoverage;
  point: PickupPoint | null;
  onSelect: (point: PickupPoint) => void;
  editing?: boolean;
  selectedRing?: number;
  onMoveVertex?: (index: number, point: PickupPoint) => void;
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
    if (!ready) return;
    let cancelled = false;
    void import("leaflet").then((L) => {
      const group = shapes.current;
      if (cancelled || !group) return;
      group.clearLayers();
      const rings = [coverage.boundary, ...coverage.exclusions];
      rings.forEach((ring, index) => {
        const color = index === 0 ? "#267247" : "#a52a26";
        const style = { color, fillOpacity: 0.18, interactive: false, weight: selectedRing === index ? 5 : 3 };
        if (ring.length >= 3) L.polygon(ring, style).addTo(group);
        else if (ring.length === 2) L.polyline(ring, style).addTo(group);
        if (editing && selectedRing === index) {
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
  }, [coverage, editing, ready, selectedRing]);

  useEffect(() => {
    if (!ready || !map.current || !marker.current) return;
    if (point) marker.current.setLatLng(point).addTo(map.current);
    else marker.current.remove();
  }, [point, ready]);

  return (
    <div className={styles.map}>
      <strong>{editing ? "Mapa de cobertura" : "Confirmá el punto de búsqueda"}</strong>
      <p className="muted">{editing ? "Hacé clic para agregar puntos al contorno o arrastrá un punto para moverlo." : "Marcá la dirección en el mapa de cobertura. También podés mover el mapa y usar el punto central."}</p>
      <div className={styles.zoneMap}>
        <div ref={container} className={styles.zoneCanvas} aria-label="Mapa de cobertura de búsqueda para el aeropuerto" />
        {ready ? <span className={styles.crosshair} aria-hidden="true">+</span> : null}
      </div>
      <button className="ghost-button" type="button" disabled={!ready} onClick={() => {
        const center = map.current?.getCenter();
        if (center) onSelect([center.lat, center.lng]);
      }}>{editing ? "Agregar punto en el centro" : "Usar el centro del mapa"}</button>
      <div aria-live="polite">
        {point && isInsideAirportPickupZone(point, coverage) ? <p>El punto está dentro de la zona de búsqueda.</p> : null}
        {failed || (point && !isInsideAirportPickupZone(point, coverage)) ? (
          <>
            <p className="field-error">{failed ? "No pudimos cargar el mapa de cobertura." : OUTSIDE_PICKUP_ZONE}</p>
            {!editing ? <a href="https://wa.me/5492944649049" target="_blank" rel="noreferrer">Consultar por WhatsApp ↗</a> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

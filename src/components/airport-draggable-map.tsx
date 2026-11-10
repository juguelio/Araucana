"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PickupPoint } from "@/lib/airport/pickup-zone";
import styles from "./airport-address-map.module.css";

export function AirportDraggableMap({ point, approximate, disabled, onMove }: {
  point: PickupPoint | null;
  approximate: boolean;
  disabled: boolean;
  onMove: (point: PickupPoint) => boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const finishDrag = useEffectEvent((pin: Marker) => {
    const { lat, lng } = pin.getLatLng();
    if ((disabled || !onMove([lat, lng])) && point) pin.setLatLng(point);
  });

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      const instance = L.map(container.current, { scrollWheelZoom: false }).setView([-40.153, -71.344], 14);
      map.current = instance;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(instance);
      const pin = L.marker(instance.getCenter(), {
        draggable: true,
        title: "Arrastrá el marcador para ajustar el punto",
        icon: L.divIcon({ className: styles.vertex, iconSize: [22, 22] })
      });
      pin.on("dragend", () => finishDrag(pin));
      marker.current = pin;
      setReady(true);
    }).catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    const pin = marker.current;
    if (!ready || !instance || !pin) return;
    if (!point) {
      pin.remove();
      return;
    }
    const alreadyVisible = instance.hasLayer(pin);
    pin.setLatLng(point).addTo(instance);
    if (!alreadyVisible) instance.setView(point, approximate ? 13 : 18);
    if (disabled) pin.dragging?.disable();
    else pin.dragging?.enable();
  }, [point, approximate, disabled, ready]);

  return (
    <div className={styles.map}>
      <div className={styles.zoneMap}>
        <div ref={container} className={styles.zoneCanvas} role="region" aria-label="Mapa del punto del traslado" />
      </div>
      {ready && point ? <p className="muted">{approximate ? "Este lugar es una referencia. Arrastrá el marcador hasta el punto exacto y confirmalo." : "Arrastrá el marcador hasta el punto correcto y confirmalo."}</p> : null}
      {failed ? <p className="field-error" role="alert">No pudimos cargar el mapa.</p> : null}
    </div>
  );
}

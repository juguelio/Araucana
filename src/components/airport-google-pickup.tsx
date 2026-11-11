/// <reference types="google.maps" />

"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { isInsideAirportPickupZone, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import { googlePickupMapId, loadGoogleLibrary } from "@/lib/airport/google-maps";
import { airportSearchCenter } from "@/lib/airport/place-search-area";
import styles from "./airport-address-map.module.css";

function toLatLng([lat, lng]: PickupPoint) {
  return { lat, lng };
}

type AirportGooglePickupProps = {
  coverage: AirportCoverage;
  point: PickupPoint | null;
  reference: { point: PickupPoint; approximate: boolean } | null;
  approximate: boolean;
  disabled: boolean;
  onPoint: (point: PickupPoint) => void;
  onUnavailable: () => void;
};

export function AirportGooglePickup({
  coverage, point, reference, approximate, disabled, onPoint, onUnavailable
}: AirportGooglePickupProps) {
  const mapHost = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const marker = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const pick = useEffectEvent((location: google.maps.LatLng | null) => {
    if (!disabled && location) onPoint([location.lat(), location.lng()]);
  });
  const unavailable = useEffectEvent(() => onUnavailable());

  useEffect(() => {
    const host = mapHost.current;
    if (!host) return;
    let active = true;
    let click: google.maps.MapsEventListener | undefined;
    void Promise.all([loadGoogleLibrary("maps"), loadGoogleLibrary("marker")]).then(([maps, markers]) => {
      if (!active) return;
      const instance = new maps.Map(host, {
        center: airportSearchCenter, zoom: 13, mapId: googlePickupMapId, gestureHandling: "cooperative",
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false
      });
      marker.current = new markers.AdvancedMarkerElement({ title: "Punto marcado para el traslado" });
      click = instance.addListener("click", (event: google.maps.MapMouseEvent) => pick(event.latLng));
      setMap(instance);
    }).catch(() => { if (active) unavailable(); });

    return () => {
      active = false;
      click?.remove();
      if (marker.current) marker.current.map = null;
      marker.current = null;
      host.replaceChildren();
    };
  }, []);

  useEffect(() => {
    if (!map || !coverage.enabled) return;
    let active = true;
    let polygon: google.maps.Polygon | undefined;
    void loadGoogleLibrary("maps").then(({ Polygon }) => {
      if (!active) return;
      polygon = new Polygon({
        map,
        paths: [coverage.boundary, ...coverage.exclusions].map((ring, index) => {
          // Para dibujar un hueco, su contorno debe tener orientación opuesta al exterior.
          const area = ring.reduce((sum, [lat, lng], vertex) => {
            const [nextLat, nextLng] = ring[(vertex + 1) % ring.length];
            return sum + lng * nextLat - nextLng * lat;
          }, 0);
          const path = ring.map(toLatLng);
          return (area > 0) === (index === 0) ? path : path.reverse();
        }),
        clickable: false,
        strokeColor: "#24604c",
        strokeWeight: 2,
        fillColor: "#24604c",
        fillOpacity: 0.14
      });
    });
    return () => {
      active = false;
      polygon?.setMap(null);
    };
  }, [coverage, map]);

  useEffect(() => {
    const pin = marker.current;
    if (!map || !pin) return;
    if (!point) {
      pin.map = null;
      return;
    }
    const position = toLatLng(point);
    if (!pin.map) map.setZoom(approximate ? 15 : 18);
    if (!pin.map || !map.getBounds()?.contains(position)) map.setCenter(position);
    pin.position = position;
    pin.map = map;
  }, [approximate, map, point]);

  useEffect(() => {
    if (!map || !reference) return;
    map.setCenter(toLatLng(reference.point));
    map.setZoom(reference.approximate ? 15 : 18);
  }, [map, reference]);

  return (
    <div className={styles.map}>
      <div className={styles.zoneMap}>
        <div ref={mapHost} className={styles.zoneCanvas} role="region" aria-label="Google Maps · punto del traslado" />
        {reference && !point ? <span aria-hidden="true" className={styles.crosshair}>+</span> : null}
      </div>
      {!map ? <p role="status" className="muted">Cargando Google Maps…</p> : null}
      {map ? (
        <p className="muted">
          Marcá la entrada exacta en el mapa. {coverage.enabled ? "La zona sombreada muestra la cobertura." : ""}
        </p>
      ) : null}
      {reference && !point && coverage.enabled ? (
        <p role="status" className="muted">
          {isInsideAirportPickupZone(reference.point, coverage)
            ? "El resultado de Google está dentro de la cobertura."
            : "El resultado de Google está fuera de la cobertura."}
        </p>
      ) : null}
    </div>
  );
}

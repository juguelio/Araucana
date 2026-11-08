"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";

type Point = [number, number];

const provinces = [
  ["Jujuy", -23.8, -65.4], ["Salta", -24.8, -65.4], ["Formosa", -25.8, -58.2], ["Chaco", -27.4, -60.8],
  ["Misiones", -27.4, -55.9], ["Tucumán", -26.9, -65.3], ["Catamarca", -27.3, -66.0], ["Santiago del Estero", -27.8, -63.3],
  ["Corrientes", -28.8, -58.8], ["La Rioja", -29.4, -66.8], ["Santa Fe", -30.7, -60.9], ["Córdoba", -31.4, -64.2],
  ["San Juan", -30.8, -68.8], ["Entre Ríos", -31.7, -59.0], ["Mendoza", -33.2, -68.6], ["San Luis", -33.6, -66.0],
  ["Buenos Aires", -36.4, -60.0], ["La Pampa", -36.6, -65.5], ["Neuquén", -38.9, -70.1], ["Río Negro", -40.8, -67.3],
  ["Chubut", -43.4, -68.8], ["Santa Cruz", -48.8, -69.8], ["Tierra del Fuego", -54.3, -67.8]
] as const;

const ChilePoints = [["Santiago", -33.45, -70.67], ["Temuco", -38.74, -72.59], ["Puerto Montt", -41.47, -72.94], ["Punta Arenas", -53.16, -70.91]] as const;

const routes = [
  { id: "siete-lagos", title: "Ruta de los 7 Lagos", subtitle: "Una maravilla natural del mundo", color: "#a2281b", points: [[-40.16, -71.35], [-40.42, -71.45], [-40.58, -71.55], [-40.72, -71.68], [-40.82, -71.78], [-40.95, -71.81], [-41.02, -71.83]] as Point[] },
  { id: "cruce-cordillera", title: "Cruce Cordillera", subtitle: "De los Andes hacia Chile", color: "#315e87", points: [[-40.16, -71.35], [-40.13, -71.63], [-40.10, -71.78], [-40.12, -71.89], [-40.09, -72.07]] as Point[] }
];

export function HistoricalMap() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const routeLayers = useRef<Record<string, Polyline>>({});
  const [activeRoute, setActiveRoute] = useState("siete-lagos");

  useEffect(() => {
    let cancelled = false;
    async function createMap() {
      const L = await import("leaflet");
      if (cancelled || !mapElement.current || mapRef.current) return;
      const map = L.map(mapElement.current, { scrollWheelZoom: true, zoomControl: true, zoomSnap: 0.25, minZoom: 3, maxZoom: 11 }).setView([-35.8, -68.5], 4.7);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);

      provinces.forEach(([name, lat, lng]) => {
        L.marker([lat, lng], { icon: L.divIcon({ className: "province-pin", html: "<span></span>", iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(map).bindTooltip(name, { direction: "top", offset: [0, -7] });
      });
      ChilePoints.forEach(([name, lat, lng]) => {
        L.marker([lat, lng], { icon: L.divIcon({ className: "chile-pin", html: "<span></span>", iconSize: [12, 12], iconAnchor: [6, 6] }) }).addTo(map).bindTooltip(`${name}, Chile`, { direction: "top", offset: [0, -6] });
      });
      routes.forEach((route) => { routeLayers.current[route.id] = L.polyline(route.points, { color: route.color, weight: route.id === "siete-lagos" ? 5 : 4, opacity: route.id === "siete-lagos" ? 1 : .78, lineCap: "round", lineJoin: "round", dashArray: route.id === "cruce-cordillera" ? "10 8" : undefined }).addTo(map).bindTooltip(route.title); });
      mapRef.current = map;
      window.setTimeout(() => map.invalidateSize(), 150);
    }
    // El mapa está al final de la home: Leaflet y los mosaicos de OpenStreetMap (~100 KB) se
    // piden recién cuando el mapa se acerca a la pantalla, no al abrir la página.
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "undefined" || !mapElement.current) {
      void createMap();
    } else {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          void createMap();
        }
      }, { rootMargin: "400px 0px" });
      observer.observe(mapElement.current);
    }
    return () => { cancelled = true; observer?.disconnect(); mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  function focusRoute(route: typeof routes[number]) {
    setActiveRoute(route.id);
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(route.points, { padding: [45, 45], maxZoom: 8, animate: true });
    Object.entries(routeLayers.current).forEach(([id, layer]) => layer.setStyle({ opacity: id === route.id ? 1 : .3, weight: id === route.id ? 6 : 3 }));
  }

  return <div className="historical-map real-map-card"><div className="real-map-heading"><div><span className="map-live-dot" /> Destinos que nos inspiran</div><span>Mové · acercá · explorá</span></div><div className="real-map-layout"><div className="leaflet-map-wrap"><div ref={mapElement} className="leaflet-map" /><div className="map-map-note">Pins: provincias argentinas y destinos de Chile</div></div><aside className="real-route-panel"><p className="eyebrow">Recorridos destacados</p><h3>Patagonia<br /><span>para descubrir.</span></h3><p className="route-panel-copy">El mapa se puede mover y ampliar con el mouse, trackpad o los dedos.</p>{routes.map((route) => <button className={`real-route-button ${activeRoute === route.id ? "is-active" : ""}`} key={route.id} onClick={() => focusRoute(route)}><span className="real-route-line" style={{ backgroundColor: route.color }} /><span><strong>{route.title}</strong><small>{route.subtitle}</small></span><span>↗</span></button>)}<div className="map-legend"><span className="legend-pin province-pin"><i /></span> Provincias argentinas<br /><span className="legend-pin chile-pin"><i /></span> Norte y sur de Chile</div></aside></div></div>;
}

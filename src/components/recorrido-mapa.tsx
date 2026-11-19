"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { AEROPUERTO_CHAPELCO } from "@/lib/airport/route-order";
import "./recorrido-mapa.css";

export type ParadaDelMapa = {
  code: string;
  /** Número de la fila en la orden (1, 2, 3…). */
  numero: number;
  nombre: string;
  lugar: string;
  pasajeros: number;
  punto: { latitude: number; longitude: number } | null;
};

/**
 * «Visualizar recorrido»: debajo de una orden de servicio, el mapa con las paradas numeradas en el orden
 * de la hoja, unidas por una línea, y el aeropuerto donde termina (partidas) o donde arranca (arribos).
 * Sirve para revisar de un vistazo que el recorrido no vaya y venga. Los pasajeros sin punto en el mapa
 * se listan abajo.
 */
export function VerRecorrido({ paradas, sentido, titulo }: { paradas: ParadaDelMapa[]; sentido: "ARRIVAL" | "DEPARTURE"; titulo: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="recorrido-mapa no-print">
      <button className="ghost-button" type="button" aria-expanded={abierto} onClick={() => setAbierto((actual) => !actual)}>
        {abierto ? "Ocultar recorrido" : "Visualizar recorrido"}
      </button>
      {abierto ? <MapaDelRecorrido paradas={paradas} sentido={sentido} titulo={titulo} /> : null}
    </div>
  );
}

function MapaDelRecorrido({ paradas, sentido, titulo }: { paradas: ParadaDelMapa[]; sentido: "ARRIVAL" | "DEPARTURE"; titulo: string }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<LeafletMap | null>(null);
  const [fallo, setFallo] = useState(false);
  const ubicadas = paradas.filter((parada) => parada.punto);
  const sinUbicar = paradas.filter((parada) => !parada.punto);

  useEffect(() => {
    let cancelado = false;
    async function armar() {
      const L = await import("leaflet");
      if (cancelado || !contenedor.current) return;
      const instancia = L.map(contenedor.current, { scrollWheelZoom: false });
      mapa.current = instancia;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
      }).addTo(instancia);

      const aeropuerto: [number, number] = [AEROPUERTO_CHAPELCO.latitude, AEROPUERTO_CHAPELCO.longitude];
      const puntos = ubicadas.map((parada) => [parada.punto!.latitude, parada.punto!.longitude] as [number, number]);
      // Partida: junta a la gente y termina en el aeropuerto. Arribo: sale del aeropuerto y deja a la gente.
      const camino = sentido === "DEPARTURE" ? [...puntos, aeropuerto] : [aeropuerto, ...puntos];
      L.polyline(camino, { color: "#1f5c4a", weight: 4, opacity: 0.75 }).addTo(instancia);

      L.marker(aeropuerto, {
        icon: L.divIcon({ className: "recorrido-mapa-aeropuerto", html: "✈", iconSize: [30, 30] }),
        title: sentido === "DEPARTURE" ? "Aeropuerto Chapelco (fin del recorrido)" : "Aeropuerto Chapelco (inicio del recorrido)"
      }).addTo(instancia);
      ubicadas.forEach((parada) => {
        L.marker([parada.punto!.latitude, parada.punto!.longitude], {
          icon: L.divIcon({ className: "recorrido-mapa-parada", html: String(parada.numero), iconSize: [28, 28] }),
          title: `${parada.numero}. ${parada.nombre} · ${parada.pasajeros} · ${parada.lugar}`
        })
          .bindTooltip(`${parada.numero}. ${parada.nombre} (${parada.pasajeros}) · ${parada.lugar}`)
          .addTo(instancia);
      });

      // Encuadre: las paradas (el aeropuerto queda lejos y achicaría todo); si no hay ninguna, el aeropuerto.
      if (puntos.length) instancia.fitBounds(L.latLngBounds(puntos), { padding: [36, 36], maxZoom: 16 });
      else instancia.setView(aeropuerto, 13);
    }
    void armar().catch(() => { if (!cancelado) setFallo(true); });
    return () => {
      cancelado = true;
      mapa.current?.remove();
      mapa.current = null;
    };
    // El mapa se arma una vez por apertura: las paradas cambian al recargar la orden.
  }, []);

  return (
    <div className="recorrido-mapa-cuerpo">
      {fallo ? (
        <p className="muted">No se pudo cargar el mapa.</p>
      ) : (
        <div ref={contenedor} className="recorrido-mapa-lienzo" role="img" aria-label={`Mapa del recorrido de ${titulo}: ${ubicadas.length} paradas`} />
      )}
      <p className="muted recorrido-mapa-nota">
        {sentido === "DEPARTURE"
          ? "Los números siguen el orden de la hoja: el 1 es el primer retiro y la línea termina en el aeropuerto."
          : "Los números siguen el orden de la hoja: la línea sale del aeropuerto y el 1 es la primera parada."}
      </p>
      {sinUbicar.length ? (
        <p className="recorrido-mapa-sin-ubicar">
          <strong>Sin punto en el mapa ({sinUbicar.length}):</strong>{" "}
          {sinUbicar.map((parada) => `${parada.numero}. ${parada.nombre} (${parada.lugar})`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

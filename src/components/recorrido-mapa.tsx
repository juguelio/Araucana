"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { AEROPUERTO_CHAPELCO } from "@/lib/airport/route-order";
import type { AirportOfficePickup } from "@/lib/airport/office-pickup";
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

type RecorridoProps = {
  paradas: ParadaDelMapa[];
  sentido: "ARRIVAL" | "DEPARTURE";
  titulo: string;
  oficina: Pick<AirportOfficePickup, "address" | "point">;
};

/**
 * «Visualizar recorrido»: debajo de una orden de servicio, el mapa con las paradas numeradas en el orden
 * de la hoja, unidas por una línea. Las partidas salen de la oficina y terminan en el aeropuerto;
 * los arribos arrancan en el aeropuerto.
 * Sirve para revisar de un vistazo que el recorrido no vaya y venga. Los pasajeros sin punto en el mapa
 * se listan abajo.
 */
export function VerRecorrido({ paradas, sentido, titulo, oficina }: RecorridoProps) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="recorrido-mapa no-print">
      <button className="ghost-button" type="button" aria-expanded={abierto} onClick={() => setAbierto((actual) => !actual)}>
        {abierto ? "Ocultar recorrido" : "Visualizar recorrido"}
      </button>
      {abierto ? <MapaDelRecorrido paradas={paradas} sentido={sentido} titulo={titulo} oficina={oficina} /> : null}
    </div>
  );
}

function MapaDelRecorrido({ paradas, sentido, titulo, oficina }: RecorridoProps) {
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
      const paradasUbicadas = paradas.filter((parada) => parada.punto);
      const puntos = paradasUbicadas.map((parada) => [parada.punto!.latitude, parada.punto!.longitude] as [number, number]);
      // La oficina es el origen de la nave, aunque el atajo del checkout esté desactivado.
      const origen = sentido === "DEPARTURE" ? oficina.point : null;
      const puntosEnCiudad = origen ? [origen, ...puntos] : puntos;
      const camino = sentido === "DEPARTURE" ? [...puntosEnCiudad, aeropuerto] : [aeropuerto, ...puntos];
      L.polyline(camino, { color: "#1f5c4a", weight: 4, opacity: 0.75 }).addTo(instancia);

      if (origen) {
        const etiqueta = document.createElement("span");
        etiqueta.textContent = `Oficina · ${oficina.address} (inicio del recorrido)`;
        L.marker(origen, {
          icon: L.divIcon({ className: "recorrido-mapa-oficina", html: "O", iconSize: [30, 30] }),
          title: etiqueta.textContent,
          zIndexOffset: 1000
        }).bindTooltip(etiqueta).addTo(instancia);
      }

      L.marker(aeropuerto, {
        icon: L.divIcon({ className: "recorrido-mapa-aeropuerto", html: "✈", iconSize: [30, 30] }),
        title: sentido === "DEPARTURE" ? "Aeropuerto Chapelco (fin del recorrido)" : "Aeropuerto Chapelco (inicio del recorrido)"
      }).addTo(instancia);
      paradasUbicadas.forEach((parada) => {
        L.marker([parada.punto!.latitude, parada.punto!.longitude], {
          icon: L.divIcon({ className: "recorrido-mapa-parada", html: String(parada.numero), iconSize: [28, 28] }),
          title: `${parada.numero}. ${parada.nombre} · ${parada.pasajeros} · ${parada.lugar}`
        })
          .bindTooltip(`${parada.numero}. ${parada.nombre} (${parada.pasajeros}) · ${parada.lugar}`)
          .addTo(instancia);
      });

      // Encuadre: oficina y paradas; el aeropuerto queda lejos y achicaría todo.
      if (puntosEnCiudad.length) instancia.fitBounds(L.latLngBounds(puntosEnCiudad), { padding: [36, 36], maxZoom: 16 });
      else instancia.setView(aeropuerto, 13);
    }
    void armar().catch(() => { if (!cancelado) setFallo(true); });
    return () => {
      cancelado = true;
      mapa.current?.remove();
      mapa.current = null;
    };
  }, [paradas, sentido, oficina]);

  return (
    <div className="recorrido-mapa-cuerpo">
      {fallo ? (
        <p className="muted">No se pudo cargar el mapa.</p>
      ) : (
        <div ref={contenedor} className="recorrido-mapa-lienzo" role="img" aria-label={`Mapa del recorrido de ${titulo}: ${ubicadas.length} paradas`} />
      )}
      <p className="muted recorrido-mapa-nota">
        {sentido === "DEPARTURE"
          ? oficina.point
            ? `La línea sale de la oficina (${oficina.address}), sigue los retiros en el orden de la hoja y termina en el aeropuerto. El 1 es el primer retiro.`
            : `Salida desde la oficina: ${oficina.address}. Falta configurar su punto en el mapa para mostrar el tramo inicial. Los números siguen el orden de la hoja y la línea termina en el aeropuerto.`
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

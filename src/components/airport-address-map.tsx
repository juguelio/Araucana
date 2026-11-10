"use client";

import { useEffect, useState } from "react";
import styles from "./airport-address-map.module.css";

export function AirportAddressMap({ address }: { address: string }) {
  const street = address.trim();
  const [settledStreet, setSettledStreet] = useState(street);

  useEffect(() => {
    const timer = setTimeout(() => setSettledStreet(street), 600);
    return () => clearTimeout(timer);
  }, [street]);
  const location = "San Martín de los Andes, Neuquén, Argentina";
  const mapStreet = street && settledStreet;
  const query = mapStreet ? `${mapStreet}, ${location}` : location;
  const mapsUrl = `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query })}`;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;
  const mapSrc = apiKey
    ? `https://www.google.com/maps/embed/v1/place?${new URLSearchParams({ key: apiKey, q: query })}`
    : `https://www.google.com/maps?${new URLSearchParams({ q: query, output: "embed" })}`;

  return (
    <div className={styles.map}>
      <iframe
        title="Ubicación de la dirección en Google Maps"
        src={mapSrc}
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
      <p className="muted" aria-live="polite">
        {!street ? "Ingresá una dirección para ubicarla en el mapa."
          : street !== settledStreet ? "Actualizando la ubicación…"
            : "Verificá que el marcador coincida con la dirección ingresada."}
      </p>
      {street && street === settledStreet ? <a href={mapsUrl} target="_blank" rel="noreferrer">Abrir en Google Maps ↗</a> : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import styles from "./airport-address-map.module.css";

export function AirportAddressMap({ address }: { address: string }) {
  const street = address.trim();

  // Remount the preview when the address changes so it never shows a stale location.
  return <MapPreview key={street} address={street} />;
}

function MapPreview({ address }: { address: string }) {
  const [visible, setVisible] = useState(false);
  const query = `${address}, San Martín de los Andes, Neuquén, Argentina`;
  const mapsUrl = `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query })}`;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;
  const mapSrc = apiKey
    ? `https://www.google.com/maps/embed/v1/place?${new URLSearchParams({ key: apiKey, q: query })}`
    : `https://www.google.com/maps?${new URLSearchParams({ q: query, output: "embed" })}`;

  return (
    <div className={styles.map}>
      <div className={styles.actions}>
        <button className="ghost-button" type="button" disabled={!address} aria-expanded={visible} onClick={() => setVisible(!visible)}>
          {visible ? "Ocultar mapa" : "Ver dirección en el mapa"}
        </button>
        {visible ? <a href={mapsUrl} target="_blank" rel="noreferrer">Abrir en Google Maps ↗</a> : null}
      </div>
      {visible ? (
        <>
          <iframe
            title="Ubicación de la dirección en Google Maps"
            src={mapSrc}
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
          <p className="muted">Verificá que el marcador coincida con la dirección ingresada.</p>
        </>
      ) : null}
    </div>
  );
}

"use client";

import { corridorStops, destinationsFrom, fareStopName } from "@/lib/booking/segment-fares";

export function SegmentStopFields({ route, boarding, dropoff, onChange, disabled, dropoffErrorId }: {
  route: Parameters<typeof destinationsFrom>[0] & { currency: string };
  boarding: string;
  dropoff: string;
  onChange: (boarding: string, dropoff: string) => void;
  disabled?: boolean;
  dropoffErrorId?: string;
}) {
  const stops = corridorStops(route);
  const selectedEnd = stops.length ? fareStopName(dropoff) : dropoff;
  const destinations = destinationsFrom(route, boarding);
  if (stops.length === 0 && destinations.length < 2) return null;
  const price = new Intl.NumberFormat("es-AR", { style: "currency", currency: route.currency, maximumFractionDigits: 2 });
  return (
    <>
      {stops.length > 0 && (
        <label>
          Parada de subida
          <select name="boardingStop" disabled={disabled} value={boarding} onChange={(event) => {
            const next = event.target.value;
            const valid = destinationsFrom(route, next).some((fare) => fare.name === (selectedEnd || route.to));
            onChange(next, valid ? dropoff : "");
          }}>
            {stops.slice(0, -1).map((name) => <option key={name} value={name === route.from ? "" : name}>{name}</option>)}
          </select>
        </label>
      )}
      <label>
        Parada de bajada
        <select name="dropoffStop" disabled={disabled} value={selectedEnd} aria-invalid={Boolean(dropoffErrorId)} aria-describedby={dropoffErrorId} onChange={(event) => onChange(boarding, event.target.value)}>
          {destinations.map(({ name, priceCents }) => (
            <option key={name} value={name === route.to ? "" : name}>{name} · {price.format(priceCents / 100)}</option>
          ))}
        </select>
      </label>
    </>
  );
}

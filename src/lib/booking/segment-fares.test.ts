import { describe, expect, it } from "vitest";
import { corridorStops, destinationsFrom, segmentPrice } from "./segment-fares";

const terminal = "Villa Traful";
const catalogs = [
  { from: "Villa La Angostura", full: 19000, pairs: 15 },
  { from: "San Martín de los Andes", full: 30000, pairs: 36 }
];

describe("tarifario de Villa Traful", () => {
  it.each(catalogs)("ofrece cada tramo de $from y su vuelta por el mismo importe", ({ from, full, pairs }) => {
    const route = { bookingMode: "SEATED", from, to: terminal, priceCents: full * 100 };
    const reverse = { ...route, from: route.to, to: from };
    const stops = corridorStops(route);
    let count = 0;
    for (const [i, boarding] of stops.slice(0, -1).entries()) {
      const options = destinationsFrom(route, i ? boarding : "");
      expect(options.map((option) => option.name)).toEqual(stops.slice(i + 1));
      for (const { name, priceCents } of options) {
        expect(priceCents).toBeGreaterThan(0);
        expect(segmentPrice(reverse, name === terminal ? "" : name, boarding === from ? "" : boarding)).toBe(priceCents);
        count++;
      }
    }
    expect(count).toBe(pairs);
  });

  it("cobra la celda del tarifario y reconoce los nombres históricos", () => {
    const vla = { bookingMode: "SEATED", from: "Villa La Angostura", to: terminal, priceCents: 1900000 };
    expect(segmentPrice(vla, "Lago Espejo", "Ruca Malen")).toBe(480000);
    expect(segmentPrice(vla, "Emp. Ruta Prov. 65", "Puerto Arrayan")).toBe(510000);
    expect(segmentPrice(vla, "Lago Espejo", "Lago Espejo")).toBeUndefined();
    expect(segmentPrice(vla, "El Portezuelo", "Lago Espejo")).toBeUndefined();
    expect(segmentPrice(vla, "Acceso Chapelco")).toBeUndefined();
    expect(segmentPrice({ ...vla, bookingMode: "AIRPORT" }, "El Portezuelo")).toBeUndefined();
  });
});

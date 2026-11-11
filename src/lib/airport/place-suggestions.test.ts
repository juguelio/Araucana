import { afterEach, expect, it, vi } from "vitest";
import { suggestAirportPlaces } from "./place-suggestions";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("devuelve las esquinas de GeoRef en la misma lista de sugerencias", async () => {
  const fetchProvider = vi.fn().mockResolvedValue(Response.json({
    direcciones: [{
      nomenclatura: "Av. San Martín y Belgrano", calle_cruce_1: { id: "cruce" },
      ubicacion: { lat: -40.1565, lon: -71.3497 }
    }]
  }));
  vi.stubGlobal("fetch", fetchProvider);

  await expect(suggestAirportPlaces("San Martín y Belgrano", new AbortController().signal)).resolves.toEqual([
    { label: "Av. San Martín y Belgrano", point: [-40.1565, -71.3497], source: "georef", approximate: false }
  ]);
  expect(fetchProvider).toHaveBeenCalledOnce();
});

it("busca barrios en Photon y devuelve latitud antes que longitud", async () => {
  vi.stubEnv("AIRPORT_PHOTON_URL", "https://photon.test/api/");
  vi.stubEnv("AIRPORT_GEOCODER_URL", "");
  const fetchProvider = vi.fn().mockResolvedValue(Response.json({
    features: [{
      geometry: { type: "Point", coordinates: [-71.33, -40.14] },
      properties: { name: "El Arenal", city: "San Martín de los Andes", type: "district" }
    }]
  }));
  vi.stubGlobal("fetch", fetchProvider);

  await expect(suggestAirportPlaces("Barrio El Arenal", new AbortController().signal)).resolves.toEqual([
    { label: "El Arenal, San Martín de los Andes", point: [-40.14, -71.33], source: "photon", approximate: true }
  ]);
  expect(fetchProvider.mock.calls[0][0].searchParams.get("q")).toBe("El Arenal");
});

it("usa el autocompletado de LocationIQ si está configurado", async () => {
  vi.stubEnv("AIRPORT_GEOCODER_URL", "https://us1.locationiq.com/v1/search");
  vi.stubEnv("AIRPORT_GEOCODER_KEY", "test-key");
  const fetchProvider = vi.fn().mockResolvedValue(Response.json([{
    display_name: "Patagonia Plaza Hotel, San Martín de los Andes",
    lat: "-40.1578774", lon: "-71.3547721", type: "hotel", class: "tourism"
  }]));
  vi.stubGlobal("fetch", fetchProvider);

  await expect(suggestAirportPlaces("Patagonia Plaza", new AbortController().signal)).resolves.toEqual([
    { label: "Patagonia Plaza Hotel, San Martín de los Andes", point: [-40.1578774, -71.3547721], source: "locationiq", approximate: false }
  ]);
  const [url] = fetchProvider.mock.calls[0];
  expect(url.hostname + url.pathname).toBe("api.locationiq.com/v1/autocomplete");
  expect(url.searchParams.get("bounded")).toBe("1");
});

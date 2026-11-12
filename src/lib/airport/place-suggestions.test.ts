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

it("prioriza San Martín de los Andes sobre otras localidades", async () => {
  vi.stubEnv("AIRPORT_GEOCODER_URL", "https://us1.locationiq.com/v1/search");
  vi.stubEnv("AIRPORT_GEOCODER_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([
    { display_name: "El Arenal, Junín de los Andes", lat: "-40.07", lon: "-71.1", type: "suburb" },
    { display_name: "El Arenal, Municipio de San Martín de los Andes", lat: "-40.14", lon: "-71.33", type: "suburb" }
  ])));

  const matches = await suggestAirportPlaces("El Arenal", new AbortController().signal);
  expect(matches.map((match) => match.label)).toEqual([
    "El Arenal, Municipio de San Martín de los Andes",
    "El Arenal, Junín de los Andes"
  ]);
});

it("busca Curruhinca 440 en San Martín y ofrece la calle oficial como referencia", async () => {
  vi.stubEnv("AIRPORT_GEOCODER_URL", "https://us1.locationiq.com/v1/search");
  vi.stubEnv("AIRPORT_GEOCODER_KEY", "test-key");
  const unrelated = { display_name: "440, Avenida San Martín, San Martín de los Andes", lat: "-40.158", lon: "-71.355", class: "building" };
  const fetchProvider = vi.fn()
    .mockResolvedValueOnce(Response.json([unrelated]))
    .mockResolvedValueOnce(Response.json({ direcciones: [{
      calle: { nombre: "CACIQUE CURRUHUINCA" },
      altura: { valor: 440 },
      localidad_censal: { nombre: "San Martín de los Andes" },
      ubicacion: { lat: null, lon: null }
    }] }))
    .mockResolvedValueOnce(Response.json([unrelated, {
      display_name: "Cacique Curruhuinca, Cantera, San Martín de los Andes",
      lat: "-40.1539068", lon: "-71.3434156", class: "highway"
    }]));
  vi.stubGlobal("fetch", fetchProvider);

  await expect(suggestAirportPlaces("Curruhinca 440", new AbortController().signal)).resolves.toEqual([
    { label: "Cacique Curruhuinca 440, San Martín de los Andes", point: [-40.1539068, -71.3434156], source: "locationiq", approximate: true }
  ]);
  expect(fetchProvider.mock.calls[0][0].searchParams.get("q")).toBe("Curruhinca 440, San Martín de los Andes");
  expect(fetchProvider.mock.calls[1][0].searchParams.get("localidad_censal")).toBe("San Martín de los Andes");
  expect(fetchProvider.mock.calls[2][0].searchParams.get("q")).toBe("Cacique Curruhuinca 440, San Martín de los Andes");
});

it("respeta una localidad indicada y conserva la coincidencia exacta de calle y altura", async () => {
  vi.stubEnv("AIRPORT_GEOCODER_URL", "https://us1.locationiq.com/v1/search");
  vi.stubEnv("AIRPORT_GEOCODER_KEY", "test-key");
  const label = "440, Avenida San Martín, Junín de los Andes";
  const fetchProvider = vi.fn().mockResolvedValue(Response.json([
    { display_name: "440, Belgrano, Junín de los Andes", lat: "-40.07", lon: "-71.1" },
    { display_name: label, lat: "-40.08", lon: "-71.09" }
  ]));
  vi.stubGlobal("fetch", fetchProvider);

  await expect(suggestAirportPlaces("San Martín 440, Junín de los Andes", new AbortController().signal)).resolves.toEqual([
    { label, point: [-40.08, -71.09], source: "locationiq", approximate: false }
  ]);
  expect(fetchProvider).toHaveBeenCalledOnce();
  expect(fetchProvider.mock.calls[0][0].searchParams.get("q")).toBe("San Martín 440, Junín de los Andes");
});

it("ofrece el domicilio del nomenclador aunque ningún geocoder tenga las coordenadas", async () => {
  vi.stubEnv("AIRPORT_GEOCODER_URL", "https://us1.locationiq.com/v1/search");
  vi.stubEnv("AIRPORT_GEOCODER_KEY", "test-key");
  const fetchProvider = vi.fn()
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json({ direcciones: [{
      calle: { nombre: "BERTHA KOESSLER" },
      altura: { valor: 1686 },
      localidad_censal: { nombre: "San Martín de los Andes" },
      ubicacion: { lat: null, lon: null }
    }] }))
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json([]));
  vi.stubGlobal("fetch", fetchProvider);

  await expect(suggestAirportPlaces("koessler 1686", new AbortController().signal)).resolves.toEqual([
    { label: "Bertha Koessler 1686, San Martín de los Andes", point: null, source: "georef", approximate: true }
  ]);
});

it("ancla el pin sobre la calle cuando el geocoder conoce el eje pero no la altura", async () => {
  vi.stubEnv("AIRPORT_GEOCODER_URL", "https://us1.locationiq.com/v1/search");
  vi.stubEnv("AIRPORT_GEOCODER_KEY", "test-key");
  const fetchProvider = vi.fn()
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json({ direcciones: [{
      calle: { nombre: "AV RODOLFO KOESSLER" },
      altura: { valor: 1600 },
      localidad_censal: { nombre: "San Martín de los Andes" },
      ubicacion: { lat: null, lon: null }
    }] }))
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json([{
      lat: "-40.1535518",
      lon: "-71.3321884",
      display_name: "Avenida Rodolfo Koessler, El Oasis, San Martín de los Andes, Neuquén, Argentina",
      class: "highway",
      type: "primary"
    }]));
  vi.stubGlobal("fetch", fetchProvider);

  const [suggestion] = await suggestAirportPlaces("av rodolfo koessler 1600", new AbortController().signal);
  expect(suggestion.label).toBe("Av Rodolfo Koessler 1600, San Martín de los Andes");
  expect(suggestion.point).toEqual([-40.1535518, -71.3321884]);
  expect(suggestion.approximate).toBe(true);
  // la última consulta es la calle sola, sin la altura
  expect(fetchProvider.mock.calls.at(-1)?.[0].toString()).toContain("q=Av+Rodolfo+Koessler");
});

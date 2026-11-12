import { afterEach, expect, it, vi } from "vitest";
import { lookupStreetOptions, resolveStreetAddress, streetCategory, streetLabel } from "./street-address";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function configurarGeocoder() {
  vi.stubEnv("AIRPORT_GEOCODER_URL", "https://us1.locationiq.com/v1/search");
  vi.stubEnv("AIRPORT_GEOCODER_KEY", "test-key");
}

const koessler = {
  nombre: "BERTHA KOESSLER", categoria: "CALLE", localidad_censal: { nombre: "San Martín de los Andes" }
};
const avenida = {
  nombre: "AV RODOLFO KOESSLER", categoria: "AV", localidad_censal: { nombre: "San Martín de los Andes" }
};

it("muestra el nombre de la calle como se escribe en la ciudad", () => {
  expect(streetLabel("BERTHA KOESSLER")).toBe("Bertha Koessler");
  expect(streetLabel("AV RODOLFO KOESSLER")).toBe("Av Rodolfo Koessler");
  expect(streetLabel("PJE RUCA NIRE")).toBe("Pje Ruca Nire");
});

it("traduce la categoría del nomenclador", () => {
  expect(streetCategory("AV")).toBe("Avenida");
  expect(streetCategory("CALLE")).toBe("Calle");
  expect(streetCategory("PASAJE")).toBe("Pasaje");
  expect(streetCategory("RUTA")).toBe("Ruta");
});

it("lista las calles homónimas para que el operador elija", async () => {
  const fetchProvider = vi.fn().mockResolvedValue(Response.json({ calles: [koessler, avenida] }));
  vi.stubGlobal("fetch", fetchProvider);

  await expect(lookupStreetOptions("koessler", new AbortController().signal)).resolves.toEqual([
    { name: "Bertha Koessler", category: "Calle", locality: "San Martín de los Andes" },
    { name: "Av Rodolfo Koessler", category: "Avenida", locality: "San Martín de los Andes" }
  ]);
  const [url] = fetchProvider.mock.calls[0];
  expect(url.hostname + url.pathname).toBe("apis.datos.gob.ar/georef/api/v2.0/calles");
  expect(url.searchParams.get("localidad_censal")).toBe("San Martín de los Andes");
  expect(url.searchParams.get("nombre")).toBe("koessler");
});

it("no consulta el nomenclador con menos de dos letras", async () => {
  const fetchProvider = vi.fn();
  vi.stubGlobal("fetch", fetchProvider);

  await expect(lookupStreetOptions("k", new AbortController().signal)).resolves.toEqual([]);
  expect(fetchProvider).not.toHaveBeenCalled();
});

it("arma el domicilio con la calle elegida y la altura tipeada", async () => {
  configurarGeocoder();
  const sinCoordenadas = { calle: { nombre: "BERTHA KOESSLER" }, altura: { valor: 1686 }, localidad_censal: { nombre: "San Martín de los Andes" }, ubicacion: { lat: null, lon: null } };
  const otraCalle = { calle: { nombre: "AV RODOLFO KOESSLER" }, altura: { valor: 1686 }, localidad_censal: { nombre: "San Martín de los Andes" }, ubicacion: { lat: null, lon: null } };
  const fetchProvider = vi.fn()
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json({ direcciones: [sinCoordenadas, otraCalle] }))
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json([]));
  vi.stubGlobal("fetch", fetchProvider);

  await expect(resolveStreetAddress("Bertha Koessler", "1686", new AbortController().signal)).resolves.toEqual({
    label: "Bertha Koessler 1686, San Martín de los Andes",
    point: null,
    source: "georef",
    approximate: true
  });
});

it("no acepta una altura que no es un número", async () => {
  configurarGeocoder();
  const fetchProvider = vi.fn();
  vi.stubGlobal("fetch", fetchProvider);

  await expect(resolveStreetAddress("Bertha Koessler", "sin altura", new AbortController().signal)).resolves.toBeNull();
  await expect(resolveStreetAddress("Bertha Koessler", "", new AbortController().signal)).resolves.toBeNull();
  expect(fetchProvider).not.toHaveBeenCalled();
});

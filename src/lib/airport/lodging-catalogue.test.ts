import { afterEach, describe, expect, it, vi } from "vitest";
import catalogue from "./data/sma-lodgings.json";
import { complementaryLodgings, findMunicipalLodgings, municipalLodgings, suggestMunicipalLodgings, unlistedLodgings, withMunicipalLodgings } from "./lodging-catalogue";
import complementary from "./data/sma-lodgings-complementary.json";
import { normalizePlaceText } from "./place-search-area";
import { suggestAirportPlaces } from "./place-suggestions";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("importa el directorio completo sin duplicados ni datos esenciales faltantes", () => {
  expect(municipalLodgings).toHaveLength(catalogue.reportedCount);
  expect(new Set(municipalLodgings.map((place) => place.id)).size).toBe(catalogue.reportedCount);
  for (const place of municipalLodgings) {
    for (const field of [place.id, place.name, place.type, place.zone, place.address]) expect(field.trim()).not.toBe("");
    expect(place.sourceUrl).toBe(`https://sanmartindelosandes.gob.ar/ver-alojamiento/?id=${place.id}`);
  }
});

it.each(municipalLodgings)("encuentra $name ($id) por nombre, sin tildes y con su tipo", (place) => {
  for (const query of [place.name, normalizePlaceText(place.name), `${place.type} ${place.name}`, `${place.name}, San Martín de los Andes`]) {
    expect(findMunicipalLodgings(query).map((result) => result.id), query).toContain(place.id);
  }
});

it("distingue los dos Esquiador y tolera un error de escritura", () => {
  for (const query of ["hotel del esquiador", "hote del esquiador", "esquiadr", "Esquia"]) {
    expect(findMunicipalLodgings(query).map((place) => place.id)).toEqual(expect.arrayContaining(["165", "185"]));
  }
  expect(findMunicipalLodgings("Hostal del Esquiador")[0].address).toBe("Cnel. Rohde 975");
  expect(findMunicipalLodgings("Del Viejo Esquiador")[0].address).toBe("Av. San Martín 1242");
});

it("no mezcla localidades explícitas ni inventa coordenadas", () => {
  expect(findMunicipalLodgings("Esquiador, Junín de los Andes")).toEqual([]);
  expect(findMunicipalLodgings("Esquiador, Centro")).toHaveLength(2);
  expect(findMunicipalLodgings("zzzzzzzzzz")).toEqual([]);
  expect(findMunicipalLodgings("es")).toEqual([]);
  expect(suggestMunicipalLodgings("esquiador")).toEqual([
    expect.objectContaining({ point: expect.any(Array), precision: "exact", source: "municipal", approximate: true }),
    expect.objectContaining({ point: expect.any(Array), precision: "exact", source: "municipal", approximate: true })
  ]);
});

it("acepta abreviaturas habituales de tipos de alojamiento", () => {
  expect(findMunicipalLodgings("depto Silvia")[0].name).toBe("Departamento Silvia");
  expect(findMunicipalLodgings("aparthotel Agua Escondida")[0].name).toBe("Agua Escondida");
});

it("mantiene las opciones del catálogo cuando el proveedor está caído", async () => {
  vi.stubEnv("AIRPORT_GEOCODER_URL", "");
  vi.stubEnv("AIRPORT_PHOTON_URL", "https://photon.test/api/");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  const results = await suggestAirportPlaces("esquiador", new AbortController().signal);
  expect(results).toHaveLength(2);
  expect(results.every((place) => place.source === "municipal")).toBe(true);
});

it("no oculta un error del proveedor si tampoco hay coincidencia municipal", async () => {
  vi.stubEnv("AIRPORT_GEOCODER_URL", "");
  vi.stubEnv("AIRPORT_PHOTON_URL", "https://photon.test/api/");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  await expect(suggestAirportPlaces("zzzzzzzzzz", new AbortController().signal)).rejects.toThrow();
});

it("no duplica el catálogo devuelto por la API y conserva el punto del proveedor", () => {
  const resolved = { label: "Hotel el Viejo Esquiador, Avenida San Martín 1242", source: "photon" as const, point: [-40.15, -71.34] as [number, number], approximate: false, precision: "exact" as const };
  const results = withMunicipalLodgings("esquiador", [...suggestMunicipalLodgings("esquiador"), resolved]);
  expect(results).toHaveLength(3);
  expect(results).toContainEqual(resolved);
  expect(results[0].source).toBe("municipal");
  expect("point" in results[0] && results[0].point).not.toBeNull();
});

it("descarta una búsqueda cancelada", async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await suggestAirportPlaces("esquiador", controller.signal)).toEqual([]);
});

it("no prioriza una calle homónima como si fuera un alojamiento", () => {
  const street = { label: "Las Retamas 1, San Martín de los Andes", source: "georef", precision: "interpolated" };
  expect(withMunicipalLodgings("Las Retamas 1", [street])[0].source).toBe("municipal");
});


it("reconoce el nombre comercial Turismo Patagonia sin confundirlo con Patagonia Plaza", () => {
  for (const query of ["Hotel Turismo Patagonia", "Turismo Patagonia", "Hotel Turismo Pat", "hotel turismo patagnia"]) {
    const [result] = suggestMunicipalLodgings(query);
    expect(result).toMatchObject({ lodgingId: "183", point: expect.any(Array), locationMatch: "establishment" });
    expect(result.label).toContain("Turismo,");
  }
  expect(suggestMunicipalLodgings("Hotel Turismo Patagonia, Junín de los Andes")).toEqual([]);
  expect(findMunicipalLodgings("Patagonia Plaza")[0].id).toBe("1");
});

describe("catálogo complementario", () => {
  it("no duplica ni reemplaza el padrón municipal", () => {
    const municipalIds = new Set(municipalLodgings.map(({ id }) => id));
    const ids = complementaryLodgings.map(({ id }) => id);
    expect(complementaryLodgings).toHaveLength(complementary.lodgings.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const place of complementaryLodgings) {
      expect(municipalIds.has(place.id)).toBe(false);
      expect(place.id).toMatch(/^(?:sma-\d{1,8}|nqn-[a-z0-9]+(?:-[a-z0-9]+)*)$/);
      for (const field of [place.name, place.type, place.zone, place.address, place.zoneBasis]) expect(field.trim()).not.toBe("");
      expect(new URL(place.registry.url).hostname).toBe("turismo.neuquen.gob.ar");
      if (place.id.startsWith("sma-")) {
        expect(place.municipalId).toBe(place.id.slice(4));
        expect(municipalIds.has(place.municipalId!)).toBe(false);
        expect(place.sourceUrl).toBe(`https://sanmartindelosandes.gob.ar/ver-alojamiento/?id=${place.municipalId}`);
      } else {
        expect(place.municipalId).toBeNull();
        expect(place.sourceUrl).toBe(place.registry.url);
      }
    }
  });

  it("descarta la ficha complementaria cuando el padrón la vuelve a listar", () => {
    const entries = [{ id: "sma-170", municipalId: "170" }, { id: "nqn-terra-alta", municipalId: null }];
    expect(unlistedLodgings(entries, new Set(["170"])).map(({ id }) => id)).toEqual(["nqn-terra-alta"]);
  });

  it.each(complementaryLodgings)("encuentra $name ($id) por nombre, sin tildes, con la localidad y con su zona", (place) => {
    for (const query of [place.name, normalizePlaceText(place.name), `${place.name}, San Martín de los Andes`, `${place.name}, ${place.zone}`]) {
      expect(findMunicipalLodgings(query).map((result) => result.id), query).toContain(place.id);
    }
  });

  it("distingue nombres parecidos y domicilios compartidos", () => {
    expect(findMunicipalLodgings("Hostal del Lago")[0].id).toBe("nqn-hostal-del-lago");
    expect(findMunicipalLodgings("Hostal del Esquiador")[0].id).toBe("165");
    expect(findMunicipalLodgings("Las Lengas")[0].id).toBe("sma-170");
    expect(findMunicipalLodgings("Peumayen")[0].address).toBe("Perito Moreno 1797");
    expect(findMunicipalLodgings("Antuen").map(({ id }) => id)).not.toContain("sma-106");
    expect(findMunicipalLodgings("Terra Alta, Junín de los Andes")).toEqual([]);
  });
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { matchesMunicipalAddress, municipalStreetAddress, resolveMunicipalLodging, sameMunicipalStreet } from "./lodging-address";
import { suggestProviderAirportPlaces } from "./place-suggestions";
import * as locations from "./lodging-locations";
import { verifiedLodgingLocations } from "./lodging-locations";
import { catalogueLodgings, municipalLodgings } from "./lodging-catalogue";
vi.mock("./place-suggestions", () => ({ suggestProviderAirportPlaces: vi.fn() }));
beforeEach(() => { vi.spyOn(locations, "getVerifiedLodgingLocation").mockReturnValue(null); });
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });
const hit = { label: "Hostal del Esquiador, Coronel Rohde 975, San Martín de los Andes", point: [-40.16, -71.35] as [number, number], source: "photon" as const, approximate: false, precision: "exact" as const };

it("expande abreviaturas y sólo interpreta domicilios simples", () => {
  expect(municipalStreetAddress("Cnel. Rohde 975")).toEqual({ street: "coronel rohde", number: "975" });
  expect(municipalStreetAddress("Av. San Martín Nº 1242")).toEqual({ street: "avenida san martin", number: "1242" });
  for (const address of ["Ruta 40 km 2220", "Roca 1090 Dto. 2", "Moreno 1070/1076", "Lote 12", "Rohde s/n"]) expect(municipalStreetAddress(address)).toBeNull();
});
it("exige calle, altura y localidad y admite el orden número-calle del proveedor", () => {
  const address = municipalStreetAddress("Cnel. Rohde 975")!;
  expect(matchesMunicipalAddress(hit.label, address)).toBe(true);
  expect(matchesMunicipalAddress("975, Coronel Rohde, San Martín de los Andes", address)).toBe(true);
  for (const label of ["Coronel Rohde 974, San Martín de los Andes", "San Martín 975, San Martín de los Andes", "Coronel Rohde 975, Junín de los Andes"]) expect(matchesMunicipalAddress(label, address)).toBe(false);
});
it("conserva la identidad municipal y atribuye el punto sin confirmar la entrada", async () => {
  vi.mocked(suggestProviderAirportPlaces).mockResolvedValueOnce([]).mockResolvedValueOnce([hit]);
  const result = await resolveMunicipalLodging("165", new AbortController().signal);
  expect(result).toMatchObject({ lodgingId: "165", source: "municipal", coordinateSource: "photon", point: hit.point, approximate: true });
  expect(result?.label).toContain("Hostal del Esquiador, Cnel. Rohde 975");
  expect(suggestProviderAirportPlaces).toHaveBeenCalledWith("coronel rohde 975, San Martín de los Andes", expect.any(AbortSignal));
});
/**
 * Qué se sacrificó y por qué (20-nov): antes esta tabla incluía `precision: "interpolated"` como
 * motivo de rechazo. Eso dejaba sin pin a casi todo el directorio, porque en San Martín de los Andes
 * la altura la interpola LocationIQ y sólo se aceptaba la de GeoRef. La garantía que importa no es la
 * etiqueta del proveedor sino que calle y altura coincidan con el domicilio publicado y que el punto
 * caiga dentro de la cobertura de la ciudad: eso lo siguen exigiendo `matchesMunicipalAddress` y
 * `airportSearchBounds`. Lo que queda prohibido: otro nombre, un punto fuera del área y una calle sin
 * altura. El empate entre fuentes se prueba en «rechaza coordenadas contradictorias».
 */
it.each([
  [{ ...hit, label: "Hotel del Viejo Esquiador, Avenida San Martín 1242, San Martín de los Andes" }],
  [{ ...hit, point: [-41, -71] }],
  [{ ...hit, precision: "street" }],
  [{ ...hit, label: "Hostal del Esquiador, Coronel Rohde 974, San Martín de los Andes" }]
])("no asigna puntos de otra dirección, fuera del área o sin altura (%#)", async (candidate) => {
  vi.mocked(suggestProviderAirportPlaces).mockResolvedValue([candidate] as typeof hit[]);
  expect((await resolveMunicipalLodging("165", new AbortController().signal))?.point).toBeNull();
});
it("ubica con la altura interpolada por LocationIQ cuando la dirección coincide", async () => {
  const locationIq = { ...hit, source: "locationiq" as const, precision: "interpolated" as const,
    label: "1162, Coronel Rohde, Tiro Federal, San Martín de los Andes" };
  vi.mocked(suggestProviderAirportPlaces).mockResolvedValue([]).mockResolvedValue([locationIq] as unknown as typeof hit[]);
  expect(await resolveMunicipalLodging("57", new AbortController().signal)).toMatchObject({
    point: locationIq.point, precision: "interpolated", coordinateSource: "locationiq", locationMatch: "address"
  });
});
it("prefiere la puerta del establecimiento antes que el eje de la calle", async () => {
  const calle = { ...hit, source: "locationiq" as const, precision: "interpolated" as const,
    label: "975, Coronel Rohde, San Martín de los Andes", point: [-40.1604, -71.3552] as [number, number] };
  const puerta = { ...hit, label: "Hostal del Esquiador, Coronel Rohde 975, San Martín de los Andes", point: [-40.1620, -71.3560] as [number, number] };
  vi.mocked(suggestProviderAirportPlaces).mockResolvedValue([calle, puerta] as unknown as typeof hit[]);
  expect((await resolveMunicipalLodging("165", new AbortController().signal))?.point).toEqual(puerta.point);
});
it("rechaza coordenadas contradictorias para el mismo domicilio", async () => {
  vi.mocked(suggestProviderAirportPlaces).mockResolvedValue([hit, { ...hit, point: [-40.15, -71.34] }]);
  expect((await resolveMunicipalLodging("165", new AbortController().signal))?.point).toBeNull();
});
it("mantiene la ficha si el proveedor falla", async () => {
  vi.mocked(suggestProviderAirportPlaces).mockRejectedValue(new Error("Offline"));
  expect(await resolveMunicipalLodging("165", new AbortController().signal)).toMatchObject({ lodgingId: "165", point: null, precision: "none" });
});
/**
 * Antes esta prueba exigía que un alojamiento rural **nunca** se geocodificara: la lista `urbanZones`
 * lo impedía antes de intentarlo, y dejaba afuera 97 de 269 fichas (Alrededores, Lago Lácar, 7 Lagos,
 * Lolog, Huechulafquen). Se cambió el criterio: se intenta ubicar **su propio domicilio**, con el
 * mismo control de calle y altura, y lo que sigue prohibido es mandarlo al centro por parecido de
 * nombre. Villa Pirén (Alrededores, Pirén 49) es el caso que reclamó el cliente.
 */
it("ubica un alojamiento de Alrededores en su domicilio y no en el centro", async () => {
  const suyo = { ...hit, source: "locationiq" as const, precision: "interpolated" as const,
    label: "Piren 49, San Martín de los Andes", point: [-40.1570, -71.3620] as [number, number] };
  vi.mocked(suggestProviderAirportPlaces).mockResolvedValue([]).mockResolvedValue([suyo] as unknown as typeof hit[]);
  expect((await resolveMunicipalLodging("96", new AbortController().signal))?.point).toEqual(suyo.point);

  const enElCentro = { ...hit, label: "Villa Pirén, Avenida San Martín 500, San Martín de los Andes" };
  vi.mocked(suggestProviderAirportPlaces).mockReset().mockResolvedValue([enElCentro] as unknown as typeof hit[]);
  expect((await resolveMunicipalLodging("96", new AbortController().signal))?.point).toBeNull();
});
/**
 * Las siete fichas que el cliente nombró o que quedaron sin pin en la medición de producción
 * (20-nov). Para cada una se usa la respuesta real del proveedor: `interpolated` de LocationIQ con
 * calle y altura exactas. Todas tienen que salir con punto.
 */
it.each([
  ["57", "1162, Coronel Rohde, Tiro Federal, San Martín de los Andes"],
  ["52", "Cacique Curruhuinca 730, San Martín de los Andes"],
  ["139", "1850, Los Cipreses, Cantera, San Martín de los Andes"],
  ["154", "1127, Teniente Coronel Pérez, Centro, San Martín de los Andes"],
  ["375", "46, Luis Goñi, Parque La Cascada, San Martín de los Andes"],
  ["45", "Atahualpa Yupanqui 289, Alrededores, San Martín de los Andes"],
  ["96", "Piren 49, San Martín de los Andes"]
])("ubica la ficha %s del directorio con la respuesta real del proveedor", async (id, label) => {
  const respuesta = { ...hit, source: "locationiq" as const, precision: "interpolated" as const, label };
  vi.mocked(suggestProviderAirportPlaces).mockResolvedValue([]).mockResolvedValue([respuesta] as unknown as typeof hit[]);
  expect((await resolveMunicipalLodging(id, new AbortController().signal))?.point).toEqual(hit.point);
});
it("compara la calle tolerando abreviaturas y el nombre de pila que agrega el geocoder", () => {
  expect(sameMunicipalStreet("almirante brown", "almirante brown")).toBe(true);
  expect(sameMunicipalStreet("belgrano", "manuel belgrano")).toBe(true);
  expect(sameMunicipalStreet("goñi", "luis goñi")).toBe(true);
  expect(sameMunicipalStreet("san martin", "avenida san martin")).toBe(true);
  expect(sameMunicipalStreet("rohde", "coronel rohde")).toBe(true);
  expect(sameMunicipalStreet("perito moreno", "coronel rohde")).toBe(false);
});
it("no acepta identificadores desconocidos ni una búsqueda cancelada", async () => {
  expect(await resolveMunicipalLodging("99999999", new AbortController().signal)).toBeNull();
  const controller = new AbortController(); controller.abort();
  expect((await resolveMunicipalLodging("165", controller.signal))?.point).toBeNull();
  expect(suggestProviderAirportPlaces).not.toHaveBeenCalled();
});

const rincon = { ...hit, isLodging: true as const, label: "Rincón de los Andes, Federico Graeff, San Martín de los Andes", point: [-40.1575381, -71.3606282] as [number, number] };
it("ubica Rincón de los Andes aunque el proveedor lo registre sobre otra calle del predio", async () => {
  vi.mocked(suggestProviderAirportPlaces).mockResolvedValue([rincon]);
  expect(await resolveMunicipalLodging("108", new AbortController().signal)).toMatchObject({ point: rincon.point, locationMatch: "establishment", approximate: true, label: expect.stringContaining("Juez Del Valle 611") });
});
it.each([
  { ...rincon, isLodging: undefined },
  { ...rincon, label: "Rincón de los Andes II, Federico Graeff, San Martín de los Andes" },
  { ...rincon, label: "Rincón de los Andes, Junín de los Andes" },
  { ...rincon, precision: "street" },
  { ...rincon, point: [-41, -71] }
])("no confunde nombres parecidos, otros tipos, ciudades ni puntos vagos (%#)", async (result) => {
  vi.mocked(suggestProviderAirportPlaces).mockResolvedValue([result] as typeof rincon[]);
  expect((await resolveMunicipalLodging("108", new AbortController().signal))?.point).toBeNull();
});
it("rechaza establecimientos homónimos con ubicaciones contradictorias", async () => {
  vi.mocked(suggestProviderAirportPlaces).mockResolvedValue([rincon, { ...rincon, point: [-40.15, -71.34] }]);
  expect((await resolveMunicipalLodging("108", new AbortController().signal))?.point).toBeNull();
});

it("usa una referencia verificada aun cuando el proveedor no tenga el alojamiento", async () => {
  vi.mocked(locations.getVerifiedLodgingLocation).mockRestore();
  const result = await resolveMunicipalLodging("10", new AbortController().signal);
  expect(result).toMatchObject({ lodgingId: "10", point: [-40.152507, -71.3454312], coordinateSourceUrl: "https://alcedro.wordpress.com/", approximate: true, locationMatch: "establishment" });
  expect(suggestProviderAirportPlaces).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort();
  expect((await resolveMunicipalLodging("10", controller.signal))?.point).toBeNull();
});

it("todas las referencias pertenecen a una ficha vigente y conservan su precisión", async () => {
  vi.mocked(locations.getVerifiedLodgingLocation).mockRestore();
  for (const [id, reference] of Object.entries(verifiedLodgingLocations)) {
    expect(catalogueLodgings.find((place) => place.id === id)?.name).toBe(reference.name);
    expect(reference.point[0]).toBeGreaterThan(-41);
    expect(reference.point[0]).toBeLessThan(-39);
    expect(reference.point[1]).toBeGreaterThan(-72);
    expect(reference.point[1]).toBeLessThan(-70);
    expect((await resolveMunicipalLodging(id, new AbortController().signal))?.point).toEqual(reference.point);
  }
});

it("ubica las fichas complementarias con su referencia, sin geocodificar", async () => {
  vi.mocked(locations.getVerifiedLodgingLocation).mockRestore();
  const terraAlta = await resolveMunicipalLodging("nqn-terra-alta", new AbortController().signal);
  expect(terraAlta).toMatchObject({ lodgingId: "nqn-terra-alta", source: "municipal", precision: "exact", locationMatch: "establishment" });
  expect(terraAlta?.label).toContain("Terra Alta, Las Pendientes lote 71");
  expect((await resolveMunicipalLodging("sma-170", new AbortController().signal))?.label).toContain("Las Lengas, Tte. Cnel. Pérez 1175");
  expect(suggestProviderAirportPlaces).not.toHaveBeenCalled();
  expect(await resolveMunicipalLodging("nqn-inexistente", new AbortController().signal)).toBeNull();
});

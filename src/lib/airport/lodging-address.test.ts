import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { matchesMunicipalAddress, municipalStreetAddress, resolveMunicipalLodging } from "./lodging-address";
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
it.each([
  [{ ...hit, label: "Hotel del Viejo Esquiador, Avenida San Martín 1242, San Martín de los Andes" }],
  [{ ...hit, point: [-41, -71] }],
  [{ ...hit, precision: "street" }],
  [{ ...hit, precision: "interpolated" }]
])("no asigna puntos incorrectos, vagos o contradictorios (%#)", async (candidate) => {
  vi.mocked(suggestProviderAirportPlaces).mockResolvedValue([candidate] as typeof hit[]);
  expect((await resolveMunicipalLodging("165", new AbortController().signal))?.point).toBeNull();
});
it("rechaza coordenadas contradictorias para el mismo domicilio", async () => {
  vi.mocked(suggestProviderAirportPlaces).mockResolvedValue([hit, { ...hit, point: [-40.15, -71.34] }]);
  expect((await resolveMunicipalLodging("165", new AbortController().signal))?.point).toBeNull();
});
it("mantiene la ficha si el proveedor falla", async () => {
  vi.mocked(suggestProviderAirportPlaces).mockRejectedValue(new Error("Offline"));
  expect(await resolveMunicipalLodging("165", new AbortController().signal)).toMatchObject({ lodgingId: "165", point: null, precision: "none" });
});
it("no geocodifica alojamientos rurales como si estuvieran en el centro", async () => {
  const rural = municipalLodgings.find((place) => place.type === "Alojamiento en Áreas Rurales")!;
  expect((await resolveMunicipalLodging(rural.id, new AbortController().signal))?.point).toBeNull();
  expect(suggestProviderAirportPlaces).not.toHaveBeenCalled();
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

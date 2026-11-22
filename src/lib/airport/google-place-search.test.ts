import { afterEach, expect, it, vi } from "vitest";
import { searchGoogleAirportPlaces } from "./google-place-search";
import { lodgingSearchQuery } from "./place-search-area";
import { loadGoogleLibrary } from "./google-maps";

vi.mock("./google-maps", () => ({ loadGoogleLibrary: vi.fn() }));
afterEach(() => vi.resetAllMocks());

function setup(predictions: object[] = []) {
  const autocomplete = vi.fn().mockResolvedValue({ suggestions: predictions });
  const place = { id: "hostal", displayName: "Hostal del Esquiador", formattedAddress: "Rohde 975, San Martín de los Andes", types: ["lodging"] };
  const textSearch = vi.fn().mockResolvedValue({ places: [place] });
  vi.mocked(loadGoogleLibrary).mockResolvedValue({
    AutocompleteSessionToken: class {},
    AutocompleteSuggestion: { fetchAutocompleteSuggestions: autocomplete },
    Place: { searchByText: textSearch }
  } as unknown as google.maps.PlacesLibrary);
  return { autocomplete, textSearch, place };
}

it.each(["hotel del esquiador", "hote del esquiador", "Hostal del Esquiador"])("busca el nombre distintivo de %s", (query) => {
  expect(lodgingSearchQuery(query)).toBe("esquiador");
});
it("respeta localidad y no simplifica direcciones ni búsquedas genéricas", () => {
  expect(lodgingSearchQuery("Hotel del Esquiador, Junín de los Andes")).toBe("esquiador, Junín de los Andes");
  expect(lodgingSearchQuery("Hotel 123")).toBeNull();
  expect(lodgingSearchQuery("hotel del")).toBeNull();
  expect(lodgingSearchQuery("San Martín y Belgrano")).toBeNull();
});
it("encuentra alojamientos por texto y conserva su identidad para seleccionar el punto", async () => {
  const { textSearch, place } = setup();
  const results = await searchGoogleAirportPlaces("hote del esquiador", { current: null }, new AbortController().signal);
  expect(textSearch).toHaveBeenCalledWith(expect.objectContaining({ textQuery: "esquiador, San Martín de los Andes", locationRestriction: expect.any(Object) }));
  expect(results[0].label).toContain("Hostal del Esquiador");
  expect(results[0].toPlace()).toBe(place);
});
it("complementa predicciones sin duplicar un alojamiento", async () => {
  const { place } = setup([{ placePrediction: { placeId: "hostal", text: "Hostal del Esquiador", types: ["lodging"] } }]);
  const results = await searchGoogleAirportPlaces("hotel del esquiador", { current: null }, new AbortController().signal);
  expect(results).toHaveLength(1);
  expect(results[0].toPlace()).toBe(place);
});
it("conserva autocompletado si la búsqueda por texto falla", async () => {
  const { textSearch } = setup([{ placePrediction: { placeId: "hotel", text: "Hotel", types: ["lodging"] } }]);
  textSearch.mockRejectedValue(new Error("Unavailable"));
  expect(await searchGoogleAirportPlaces("hotel del esquiador", { current: null }, new AbortController().signal)).toHaveLength(1);
});
it("no busca por texto para calles y alturas", async () => {
  const { textSearch, autocomplete } = setup();
  await searchGoogleAirportPlaces("San Martín 440", { current: null }, new AbortController().signal);
  expect(textSearch).not.toHaveBeenCalled();
  expect(autocomplete).toHaveBeenCalledWith(expect.objectContaining({ input: "San Martín 440, San Martín de los Andes" }));
});
it("descarta respuestas de búsquedas canceladas", async () => {
  const { autocomplete, textSearch } = setup();
  const controller = new AbortController();
  autocomplete.mockImplementation(async () => { controller.abort(); return { suggestions: [] }; });
  expect(await searchGoogleAirportPlaces("esquiador", { current: null }, controller.signal)).toEqual([]);
  expect(textSearch).not.toHaveBeenCalled();
});

import { loadGoogleLibrary } from "./google-maps";
import { airportSearchBounds, airportSearchLocality, lodgingSearchQuery, normalizePlaceText, splitPlaceQuery, splitStreetAddress } from "./place-search-area";

export type GoogleSuggestion = {
  source: "google";
  label: string;
  placeId: string;
  types: string[];
  toPlace: () => google.maps.places.Place;
};

export async function searchGoogleAirportPlaces(
  query: string,
  token: { current: google.maps.places.AutocompleteSessionToken | null },
  signal: AbortSignal
): Promise<GoogleSuggestion[]> {
  const { AutocompleteSessionToken, AutocompleteSuggestion, Place } = await loadGoogleLibrary("places");
  if (signal.aborted) return [];
  token.current ??= new AutocompleteSessionToken();
  const localQuery = (value: string) => splitPlaceQuery(value).context
    || normalizePlaceText(value).includes(normalizePlaceText(airportSearchLocality))
    ? value : `${value}, ${airportSearchLocality}`;
  let results: GoogleSuggestion[] = [];
  try {
    const response = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: localQuery(query), sessionToken: token.current,
      includedRegionCodes: ["ar"], locationRestriction: airportSearchBounds,
      language: "es", region: "ar"
    });
    results = response.suggestions.flatMap(({ placePrediction: prediction }) => prediction ? [{
      source: "google" as const, label: prediction.text.toString(),
      placeId: prediction.placeId, types: prediction.types, toPlace: () => prediction.toPlace()
    }] : []);
  } catch {
    token.current = null;
  }
  if (signal.aborted) return [];
  const lodgingQuery = lodgingSearchQuery(query);
  // Text Search también encuentra negocios cuyos nombres no autocompleta Google.
  // No se usa para alturas: esas mantienen la validación de domicilios existente.
  if (lodgingQuery || (!results.length && !splitStreetAddress(splitPlaceQuery(query).name))) {
    try {
      const { places } = await Place.searchByText({
        textQuery: localQuery(lodgingQuery || query),
        fields: ["id", "displayName", "formattedAddress", "types"],
        locationRestriction: airportSearchBounds, language: "es", region: "ar", maxResultCount: 8
      });
      if (signal.aborted) return [];
      results.push(...places.filter((place) => place.displayName && place.formattedAddress).map((place) => ({
        source: "google" as const, label: `${place.displayName}, ${place.formattedAddress}`,
        placeId: place.id, types: place.types ?? [], toPlace: () => place
      })));
    } catch {
      // Conserva las predicciones si Text Search está temporalmente indisponible.
    }
  }
  return [...new Map(results.map((result) => [result.placeId, result])).values()];
}

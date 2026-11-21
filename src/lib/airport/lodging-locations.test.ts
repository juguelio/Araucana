import { expect, it } from "vitest";
import { catalogueLodgings, municipalLodgings, municipalLodgingSuggestion } from "./lodging-catalogue";
import { getVerifiedLodgingLocation, verifiedLodgingLocations } from "./lodging-locations";

it.each(catalogueLodgings)("selecciona $name ($id) con su referencia y precisión, incluso sin red", (lodging) => {
  const suggestion = municipalLodgingSuggestion(lodging);
  const location = getVerifiedLodgingLocation(lodging);
  expect(suggestion.lodgingId).toBe(lodging.id);
  expect(suggestion.approximate).toBe(true);
  if (!location) {
    expect(suggestion.point).toBeNull();
    expect(suggestion.precision).toBe("none");
    return;
  }
  expect(suggestion.point).toEqual(location.point);
  expect(suggestion.precision).toBe(location.precision);
  expect(suggestion.coordinateSourceUrl).toBe(location.sourceUrl);
  expect(location.point).toHaveLength(2);
  expect(location.point.every(Number.isFinite)).toBe(true);
  expect(location.evidence.length).toBeGreaterThan(20);
  expect(new URL(location.sourceUrl).protocol).toBe("https:");
  expect(location.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it("no reutiliza la referencia cuando cambia el nombre o domicilio municipal", () => {
  const place = municipalLodgings.find((entry) => entry.id === "165")!;
  expect(getVerifiedLodgingLocation(place)).not.toBeNull();
  expect(getVerifiedLodgingLocation({ ...place, address: "Otra calle 975" })).toBeNull();
  expect(getVerifiedLodgingLocation({ ...place, name: "Otro hotel" })).toBeNull();
  expect(getVerifiedLodgingLocation({ ...place, id: "inexistente" })).toBeNull();
});

it("no transforma referencias de calle o zona en establecimientos exactos", () => {
  for (const id of ["225", "351", "354", "366"]) {
    expect(verifiedLodgingLocations[id]).toMatchObject({ precision: "street", locationMatch: "address" });
  }
  // Temporada pasó a establecimiento por el marcador con su nombre en el mismo pasaje; la altura difiere entre fuentes.
  expect(verifiedLodgingLocations["30"]).toMatchObject({ precision: "exact", locationMatch: "establishment" });
  expect(verifiedLodgingLocations["30"].evidence).toContain("la altura difiere");
  expect(verifiedLodgingLocations["190"].evidence).toContain("977");
  expect(verifiedLodgingLocations["190"].point).not.toEqual(verifiedLodgingLocations["186"].point);
  expect(verifiedLodgingLocations["343"].point[0]).toBeGreaterThan(-40);
});

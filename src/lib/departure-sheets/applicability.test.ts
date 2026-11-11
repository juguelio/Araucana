import { describe, expect, it } from "vitest";
import { parseTripLegs, planillaKindsForSpecialTrip } from "./applicability";

describe("qué planilla le toca al viaje especial", () => {
  it("pide el DUT cuando el itinerario cruza a Chile", () => {
    expect(
      planillaKindsForSpecialTrip({
        destinationSearch: "Loi Suites - Pucón",
        legs: [{ country: "AR_CL", description: "Pucón recorridos locales" }]
      })
    ).toEqual(["DUT"]);
  });

  it("pide el DUT aunque el país esté cargado como CL suelto", () => {
    expect(planillaKindsForSpecialTrip({ legs: [{ country: "CL", destination: "Pucón" }] })).toEqual(["DUT"]);
  });

  it("pide el registro de salida cuando el viaje va a otra provincia", () => {
    expect(planillaKindsForSpecialTrip({ legs: [{ country: "AR", destination: "San Carlos de Bariloche" }] })).toEqual([
      "PROVINCIA"
    ]);
  });

  it("no lleva planilla si el viaje no sale de Neuquén", () => {
    expect(
      planillaKindsForSpecialTrip({
        destinationSearch: "TRF OUT APT CPC",
        legs: [{ country: "AR", description: "Aeropuerto Chapelco" }]
      })
    ).toEqual([]);
    expect(planillaKindsForSpecialTrip({ legs: [{ country: "AR", destination: "Villa La Angostura" }] })).toEqual([]);
  });

  it("deduce Chile por el destino si el país no está cargado", () => {
    expect(planillaKindsForSpecialTrip({ destinationSearch: "Pucón" })).toEqual(["DUT"]);
  });

  it("no adivina cuando no hay datos", () => {
    expect(planillaKindsForSpecialTrip({})).toEqual([]);
    expect(planillaKindsForSpecialTrip({ destinationSearch: "Puentes de luz" })).toEqual([]);
  });

  it("ignora un itinerario que no es una lista", () => {
    expect(parseTripLegs(null)).toEqual([]);
    expect(parseTripLegs("Pucon")).toEqual([]);
    expect(parseTripLegs([{ country: "AR_CL" }])).toHaveLength(1);
  });

  it("no se confunde con tildes ni mayúsculas", () => {
    expect(planillaKindsForSpecialTrip({ destinationSearch: "PUCÓN" })).toEqual(["DUT"]);
    expect(planillaKindsForSpecialTrip({ destinationSearch: "EL BOLSÓN" })).toEqual(["PROVINCIA"]);
  });
});

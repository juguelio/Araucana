import { describe, expect, it } from "vitest";
import { planillaKindsForReservation } from "./applicability";

describe("qué planilla le toca a la reserva", () => {
  it("no lleva planilla si el viaje no sale de la provincia", () => {
    expect(planillaKindsForReservation({ to: "Villa Traful" })).toEqual([]);
    expect(planillaKindsForReservation({ to: "San Martin de los Andes" })).toEqual([]);
    expect(planillaKindsForReservation({ to: "Cerro Chapelco" })).toEqual([]);
    expect(planillaKindsForReservation({ to: "Hua Hum" })).toEqual([]);
  });

  it("pide el DUT cuando sale del país", () => {
    expect(planillaKindsForReservation({ to: "Pucón" })).toEqual(["DUT"]);
    expect(planillaKindsForReservation({ to: "Puerto Varas" })).toEqual(["DUT"]);
  });

  it("pide el registro de salida cuando sale de la provincia pero sigue en el país", () => {
    expect(planillaKindsForReservation({ to: "San Carlos de Bariloche" })).toEqual(["PROVINCIA"]);
    expect(planillaKindsForReservation({ to: "Cipolletti" })).toEqual(["PROVINCIA"]);
    expect(planillaKindsForReservation({ to: "Buenos Aires" })).toEqual(["PROVINCIA"]);
  });

  it("mira el punto de bajada cuando la ruta tiene paradas", () => {
    expect(planillaKindsForReservation({ to: "Villa Traful", dropoffStop: "Bariloche" })).toEqual(["PROVINCIA"]);
  });

  it("se fija en la ruta cuando el destino viene abreviado", () => {
    expect(planillaKindsForReservation({ to: "Termas", category: "Chile" })).toEqual(["DUT"]);
    expect(planillaKindsForReservation({ to: "Termas", slug: "cruce-a-chile-pucon" })).toEqual(["DUT"]);
  });

  it("no adivina con un destino desconocido", () => {
    expect(planillaKindsForReservation({ to: "" })).toEqual([]);
    expect(planillaKindsForReservation({})).toEqual([]);
    expect(planillaKindsForReservation({ to: "Destino nuevo sin cargar" })).toEqual([]);
  });

  it("no se confunde con tildes ni mayúsculas", () => {
    expect(planillaKindsForReservation({ to: "PUCÓN" })).toEqual(["DUT"]);
    expect(planillaKindsForReservation({ to: "San Martín de los Andes" })).toEqual([]);
    expect(planillaKindsForReservation({ to: "EL BOLSÓN" })).toEqual(["PROVINCIA"]);
  });
});

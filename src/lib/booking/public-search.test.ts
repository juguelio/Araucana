import { describe, expect, it } from "vitest";
import { airportOptionValue, airportOptions, airportSlugFromSelection, routeOptions, searchOptions } from "./public-search";

const tramos = [
  { slug: "sma-aeropuerto-chapelco", from: "San Martín de los Andes", to: "Aeropuerto Chapelco (CPC)" },
  { slug: "aeropuerto-chapelco-sma", from: "Aeropuerto Chapelco (CPC)", to: "San Martín de los Andes" }
];

describe("airportSlugFromSelection", () => {
  it("devuelve el slug del tramo elegido", () => {
    expect(airportSlugFromSelection("aeropuerto:aeropuerto-chapelco-sma")).toBe("aeropuerto-chapelco-sma");
  });

  it("devuelve null para una ruta por horario, un valor vacío o el prefijo solo", () => {
    expect(airportSlugFromSelection("San Martín de los Andes")).toBeNull();
    expect(airportSlugFromSelection("")).toBeNull();
    expect(airportSlugFromSelection(undefined)).toBeNull();
    expect(airportSlugFromSelection("aeropuerto:")).toBeNull();
  });

  it("rechaza slugs que no son un slug", () => {
    expect(airportSlugFromSelection("aeropuerto:../../admin")).toBeNull();
    expect(airportSlugFromSelection("aeropuerto:sma bariloche")).toBeNull();
  });
});

describe("airportOptions", () => {
  it("arma una opción por sentido con el par origen → destino como etiqueta", () => {
    expect(airportOptions(tramos)).toEqual([
      { value: airportOptionValue("sma-aeropuerto-chapelco"), label: "San Martín de los Andes → Aeropuerto Chapelco (CPC)" },
      { value: airportOptionValue("aeropuerto-chapelco-sma"), label: "Aeropuerto Chapelco (CPC) → San Martín de los Andes" }
    ]);
  });

  it("no repite tramos y tolera una lista vacía", () => {
    expect(airportOptions([...tramos, tramos[0]])).toHaveLength(2);
    expect(airportOptions([])).toEqual([]);
  });
});

describe("routeOptions", () => {
  it("descarta vacíos y repetidos sin cambiar el orden", () => {
    expect(routeOptions(["San Martín de los Andes", "", "Bariloche", "San Martín de los Andes", "  "])).toEqual([
      { value: "San Martín de los Andes", label: "San Martín de los Andes" },
      { value: "Bariloche", label: "Bariloche" }
    ]);
  });
});

describe("searchOptions", () => {
  it("pone los tramos de aeropuerto antes que las rutas por horario", () => {
    const options = searchOptions(["Bariloche", "San Martín de los Andes"], tramos);

    expect(options.map((option) => option.value)).toEqual([
      "aeropuerto:sma-aeropuerto-chapelco",
      "aeropuerto:aeropuerto-chapelco-sma",
      "Bariloche",
      "San Martín de los Andes"
    ]);
  });

  it("sin tramos cargados el buscador queda como hoy", () => {
    expect(searchOptions(["Bariloche"], [])).toEqual([{ value: "Bariloche", label: "Bariloche" }]);
  });
});

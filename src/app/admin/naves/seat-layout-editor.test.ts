import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SeatLayoutEditor } from "./seat-layout-editor";
import type { VehicleSeat } from "@/lib/vehicles/templates";

/**
 * #247: el editor del plano de butacas es donde se carga la capacidad de una nave, pero no tenía
 * título ni decía cuánto de eso se vende al aeropuerto. Quien buscaba «capacidad» en la ficha no
 * encontraba nada. La suite corre en node (sin DOM): se prueba el marcado que se sirve, no el clic.
 */

const seats = (cantidad: number): VehicleSeat[] =>
  Array.from({ length: cantidad }, (_, index) => ({
    number: String(index + 1).padStart(2, "0"),
    row: Math.floor(index / 4) + 1,
    column: (index % 4) + 1
  }));

const render = (cantidad: number) =>
  renderToStaticMarkup(createElement(SeatLayoutEditor, { initialSeats: seats(cantidad) }));

describe("encabezado del editor de butacas", () => {
  it("se llama «Butacas y capacidad», no «Distribucion editable»", () => {
    const html = render(24);
    expect(html).toContain("Butacas y capacidad");
    expect(html).not.toContain("Distribucion editable");
  });

  it("muestra en vivo el total y lo que vende al aeropuerto", () => {
    expect(render(24)).toContain("24 butacas · 20 para aeropuerto · 4 para equipaje");
    expect(render(19)).toContain("19 butacas · 15 para aeropuerto · 4 para equipaje");
  });

  it("el input de cantidad habla de butacas y arranca con el total del plano", () => {
    const html = render(15);
    expect(html).toContain("Cantidad de butacas");
    expect(html).toContain("aria-label=\"Cantidad de butacas\"");
    expect(html).toContain("value=\"15\"");
  });

  it("sigue enviando el plano como JSON en el campo seats", () => {
    expect(render(2)).toContain("name=\"seats\"");
  });
});

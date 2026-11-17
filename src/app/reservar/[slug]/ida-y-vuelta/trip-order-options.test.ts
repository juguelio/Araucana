import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TripOrderOptions } from "./trip-order-options";
import { OPCIONES_DE_ORDEN, type OrdenDeViaje } from "./trip-order";

function render(orden: OrdenDeViaje, aviso?: string) {
  return renderToStaticMarkup(createElement(TripOrderOptions, { orden, onElegir: () => {}, aviso }));
}

describe("control del orden del viaje (#189)", () => {
  it("muestra las dos opciones al mismo tiempo", () => {
    const html = render("ARRIVAL");
    for (const opcion of OPCIONES_DE_ORDEN) {
      expect(html).toContain(opcion.titulo);
      expect(html).toContain(opcion.ruta);
    }
    expect(html.match(/role="radio"/g) ?? []).toHaveLength(2);
  });

  it("ya no existe la flecha única que daba vuelta el orden", () => {
    const html = render("ARRIVAL");
    expect(html).not.toContain("Dar vuelta el orden del viaje");
    expect(html).not.toContain("trip-order-swap");
  });

  it("marca una sola opción como elegida", () => {
    for (const orden of ["ARRIVAL", "DEPARTURE"] as const) {
      const html = render(orden);
      expect(html.match(/aria-checked="true"/g) ?? []).toHaveLength(1);
      expect(html.match(/data-elegido="true"/g) ?? []).toHaveLength(1);
    }
  });

  it("avisa en pantalla cuando hay que volver a elegir los vuelos", () => {
    const html = render("DEPARTURE", "Dimos vuelta las fechas para que el viaje tenga sentido.");
    expect(html).toContain("Dimos vuelta las fechas");
    expect(render("DEPARTURE")).not.toContain("Dimos vuelta las fechas");
  });
});

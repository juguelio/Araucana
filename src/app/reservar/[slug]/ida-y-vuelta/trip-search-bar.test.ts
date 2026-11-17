import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TripSearchBar, type TramoDeLaBarra } from "./trip-search-bar";

/**
 * La barra es la misma para un tramo y para dos (17-nov). Lo que fija este test es lo que cambia:
 * con un solo tramo no hay orden que invertir, así que no existe el botón «Invertir» ni la pregunta
 * de confirmación, y Desde/Hacia quedan como dato del viaje (el sentido se eligió antes).
 */

const DIA = "2026-11-20";

function tramo(cambios: Partial<TramoDeLaBarra> = {}): TramoDeLaBarra {
  return {
    sentido: "ARRIVAL",
    etapa: "Ida",
    titulo: "Llegada a Chapelco",
    pregunta: "¿Qué día aterriza en Chapelco y en qué vuelo?",
    fecha: DIA,
    minimo: "",
    opciones: [],
    elegido: "",
    cargando: false,
    ...cambios
  };
}

const manejadores = { routeSlug: "aeropuerto-chapelco-sma", onFecha: () => {}, onVuelo: () => {} };

function render(props: Parameters<typeof TripSearchBar>[0]) {
  return renderToStaticMarkup(createElement(TripSearchBar, props));
}

/** Cuántas veces aparece un fragmento: sirve para contar tramos y tarjetas sin DOM. */
function veces(html: string, fragmento: string) {
  return html.split(fragmento).length - 1;
}

describe("TripSearchBar con un solo tramo", () => {
  const html = render({ ...manejadores, tramos: [tramo({ etapa: "Tu vuelo" })] });

  it("muestra un único tramo y la barra queda marcada como de un tramo", () => {
    expect(veces(html, "trip-search-leg")).toBe(1);
    expect(veces(html, 'data-tramos="1"')).toBe(1);
  });

  it("no ofrece invertir el viaje", () => {
    expect(html).not.toContain("Invertir");
    expect(html).not.toContain("¿Invertir el viaje?");
    expect(html).not.toContain("trip-search-swap");
  });

  it("muestra Desde y Hacia fijos, sin panel que abrir", () => {
    expect(veces(html, 'data-fijo="true"')).toBe(2);
    expect(html).toContain("Aeropuerto Chapelco");
    expect(html).toContain("San Martín de los Andes");
    // Un lugar fijo no es un botón: no lleva aria-expanded ni abre panel.
    expect(html).not.toContain('aria-expanded="true"');
  });

  it("conserva el día y el vuelo en el segundo recuadro", () => {
    expect(html).toContain("Tu vuelo · Llegada");
    expect(html).toContain("vie 20 nov");
  });
});

describe("TripSearchBar con ida y vuelta", () => {
  const dosTramos = [tramo(), tramo({ sentido: "DEPARTURE", etapa: "Vuelta", titulo: "Salida desde San Martín" })];
  const html = render({
    ...manejadores,
    orden: "ARRIVAL",
    tramos: dosTramos,
    confirmarCambio: false,
    onPedirOrden: () => {},
    onConfirmarCambio: () => {},
    onCancelarCambio: () => {}
  });

  it("sigue mostrando los dos tramos y el botón de invertir", () => {
    expect(veces(html, "trip-search-leg")).toBe(2);
    expect(html).toContain("Invertir: cambiar desde y hacia");
    expect(veces(html, 'data-tramos="2"')).toBe(1);
  });

  it("Desde y Hacia vuelven a ser botones que abren su panel", () => {
    expect(veces(html, 'data-fijo="true"')).toBe(0);
    expect(veces(html, 'class="trip-search-field trip-search-place"')).toBe(2);
    expect(html).toContain('aria-expanded="false"');
  });

  it("pregunta antes de invertir cuando hay vuelos elegidos", () => {
    const confirmando = render({
      ...manejadores,
      orden: "ARRIVAL",
      tramos: dosTramos,
      confirmarCambio: true,
      onPedirOrden: () => {},
      onConfirmarCambio: () => {},
      onCancelarCambio: () => {}
    });
    expect(confirmando).toContain("¿Invertir el viaje?");
    expect(confirmando).toContain("Sí, invertir");
  });
});

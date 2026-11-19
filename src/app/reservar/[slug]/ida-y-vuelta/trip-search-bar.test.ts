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
    expect(veces(html, 'data-campo="ARRIVAL"')).toBe(1);
    expect(veces(html, 'data-tramos="1"')).toBe(1);
    // Sin oferta de vuelta (el otro sentido sin tarifa), la fecha ocupa toda la fila y no hay casillero apagado.
    expect(html).not.toContain("Agregar vuelta");
    expect(html).not.toContain("trip-search-remove");
  });

  it("con oferta, la segunda fecha es la vuelta apagada que lleva al ida y vuelta", () => {
    const conVuelta = render({
      ...manejadores,
      tramos: [tramo({ etapa: "Ida" })],
      agregarVuelta: { href: "/reservar/aeropuerto-chapelco-sma/ida-y-vuelta?date=2026-11-20&sentido=ARRIVAL", detalle: "$ 25.000 más por persona" }
    });
    expect(veces(conVuelta, 'class="trip-search-dates"')).toBe(1);
    expect(veces(conVuelta, 'data-vacio="true"')).toBe(1);
    expect(conVuelta).toContain("Vuelta · Salida");
    expect(conVuelta).toContain("Agregar vuelta");
    expect(conVuelta).toContain("$ 25.000 más por persona");
    expect(conVuelta).toContain('href="/reservar/aeropuerto-chapelco-sma/ida-y-vuelta?date=2026-11-20&amp;sentido=ARRIVAL"');
    // En un tramo no hay nada que sacar.
    expect(conVuelta).not.toContain("trip-search-remove");
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
    expect(veces(html, 'class="trip-search-field trip-search-leg"')).toBe(2);
    expect(html).not.toContain("Agregar vuelta");
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

describe("TripSearchBar: sacar la vuelta", () => {
  it("la cruz va sólo en la vuelta, afuera del botón del casillero, y lleva a un tramo", () => {
    const html = render({
      ...manejadores,
      orden: "ARRIVAL",
      tramos: [tramo({ etapa: "Ida" }), tramo({ sentido: "DEPARTURE", etapa: "Vuelta", titulo: "Salida desde San Martín" })],
      onPedirOrden: () => {},
      quitarVueltaHref: "/reservar/aeropuerto-chapelco-sma?date=2026-11-20&sentido=ARRIVAL"
    });
    expect(veces(html, 'class="trip-search-remove"')).toBe(1);
    expect(html).toContain('aria-label="Sacar la vuelta y reservar un solo tramo"');
    expect(html).toContain('href="/reservar/aeropuerto-chapelco-sma?date=2026-11-20&amp;sentido=ARRIVAL"');
    expect(veces(html, 'data-con-cruz="true"')).toBe(1);
    // La cruz está después del botón de la vuelta, no adentro (un botón no puede llevar otro control).
    const vuelta = html.indexOf('data-campo="DEPARTURE"');
    const cierre = html.indexOf("</button>", vuelta);
    expect(html.indexOf("trip-search-remove")).toBeGreaterThan(cierre);
  });
});

describe("TripSearchBar: el panel dice en qué tramo se está", () => {
  it("con ida y vuelta, cada tramo lleva «Tramo N de 2» y el paso a la vuelta arranca sin anuncio", () => {
    const html = render({
      ...manejadores,
      orden: "ARRIVAL",
      tramos: [tramo({ etapa: "Ida" }), tramo({ sentido: "DEPARTURE", etapa: "Vuelta", titulo: "Salida desde San Martín" })],
      onPedirOrden: () => {}
    });
    // Sin panel abierto no hay anuncio ni casillero que late.
    expect(html).not.toContain("trip-search-handoff");
    expect(html).not.toContain("data-siguiente");
    expect(html).not.toContain('data-paso="siguiente"');
  });
});

describe("TripSearchBar: lugares de otros servicios (pantalla única de «Reservar», 19-nov)", () => {
  const extra = {
    desde: [{ nombre: "Villa Traful", detalle: "36 salidas con lugar", href: "/admin/reservas/nueva?desde=Villa%20Traful" }],
    hacia: [{ nombre: "Villa Traful", detalle: "47 salidas con lugar", href: "/admin/reservas/nueva?desde=San&hacia=Villa%20Traful" }]
  };

  it("con lugares de otros servicios, Desde y Hacia se abren aunque el sentido no se pueda cambiar acá", () => {
    const conExtra = render({ ...manejadores, tramos: [tramo({ etapa: "Ida" })], lugaresExtra: extra });
    expect(conExtra).not.toContain('data-fijo="true"');
    expect(veces(conExtra, 'data-campo="desde"')).toBe(1);
    expect(conExtra).toContain('aria-expanded="false"');
    // Sin lugares extra (la reserva web), el lugar sigue fijo.
    const sinExtra = render({ ...manejadores, tramos: [tramo({ etapa: "Ida" })] });
    expect(sinExtra).toContain('data-fijo="true"');
  });
});

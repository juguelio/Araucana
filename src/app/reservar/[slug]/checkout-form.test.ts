import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildPassengerPayload,
  filterBookableSchedules,
  filterNationalityOptions,
  formatDateTime,
  getNationalityOptions,
  validateCheckoutPassenger
} from "./checkout-form";
import { AirportCheckoutForm } from "./airport-checkout-form";
import type { PublicRouteDto, ScheduleOptionDto, SeatMapDto } from "@/lib/booking/types";

// El formulario usa el router para volver a la reserva creada; en el test no hay navegación.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const route: PublicRouteDto = {
  id: "route-1",
  slug: "sma-bariloche",
  from: "San Martin de los Andes",
  to: "Bariloche",
  via: "Camino de los 7 Lagos",
  description: "Ruta escenica",
  category: "Argentina",
  featured: true,
  durationMin: 270,
  priceCents: 1890000,
  price: 18900,
  currency: "ARS",
  bookingMode: "SEATED",
  specialType: null,
  stops: []
};

function schedule(id: string, status: string): ScheduleOptionDto {
  return {
    id,
    route,
    departureAt: new Date("2026-06-01T12:00:00.000Z"),
    arrivalAt: new Date("2026-06-01T16:30:00.000Z"),
    status,
    availableSeats: 2,
    totalSeats: 2,
    priceCents: 1890000,
    price: 18900,
    currency: "ARS"
  };
}

function seatMap(scheduleId: string): SeatMapDto {
  return {
    scheduleId,
    vehicleId: "vehicle-1",
    seats: []
  };
}

describe("checkout schedule helpers", () => {
  it("keeps only open and documentation schedules with matching seat maps", () => {
    const result = filterBookableSchedules(
      [schedule("open", "OPEN"), schedule("docs", "DOCUMENTATION"), schedule("closed", "CLOSED")],
      [seatMap("open"), seatMap("docs"), seatMap("closed")]
    );

    expect(result.schedules.map((item) => item.id)).toEqual(["open", "docs"]);
    expect(result.seatMaps.map((item) => item.scheduleId)).toEqual(["open", "docs"]);
  });

  it("formats departure times in the Salta timezone", () => {
    expect(formatDateTime("2026-06-01T12:00:00.000Z")).toMatch(/\b9:00\b/);
    expect(formatDateTime("2026-06-01T12:00:00.000Z")).not.toContain("\u00a0");
  });
});

describe("checkout passenger validation", () => {
  const validPassenger = {
    firstName: "Camila",
    lastName: "Vidal",
    email: "camila@example.com",
    phoneCountryCode: "+54",
    phone: "9 294 400 0000",
    documentType: "DNI",
    documentId: "30111222",
    nationality: ""
  };

  it("returns clear errors for each invalid passenger field", () => {
    expect(
      validateCheckoutPassenger({
        firstName: "",
        lastName: "",
        email: "camila",
        phoneCountryCode: "",
        phone: "12",
        documentType: "",
        documentId: "1",
        nationality: ""
      })
    ).toEqual({
      firstName: "Ingresa el nombre del pasajero.",
      lastName: "Ingresa el apellido del pasajero.",
      email: "Ingresa un email valido.",
      phoneCountryCode: "Selecciona el codigo de pais.",
      documentType: "Selecciona el tipo de documento.",
      documentId: "Ingresá un número de documento válido."
    });
  });

  it("rejects a short or mistyped phone and a DNI with letters", () => {
    expect(validateCheckoutPassenger({ ...validPassenger, phone: "2944-123", documentId: "30A11222" }))
      .toMatchObject({ phone: expect.any(String), documentId: expect.any(String) });
    expect(validateCheckoutPassenger({ ...validPassenger, phone: "9 2944 000000 ext" }).phone).toBeDefined();
  });

  it("acepta un DNI con puntos y exige el documento también al personal", () => {
    expect(validateCheckoutPassenger({ ...validPassenger, documentId: "30.111.222" })).toEqual({});
    // Issue #122: el documento pasó a ser obligatorio también desde el panel; el email sigue siendo
    // opcional para el personal (`optionalIdentity`).
    expect(validateCheckoutPassenger({ ...validPassenger, documentId: "", email: "" }, true)).toEqual({
      documentId: "Ingresá un DNI de 7 u 8 dígitos."
    });
  });

  it("el ida y vuelta se puede reservar sin documento", () => {
    // 17-nov: en el checkout de ida y vuelta el documento es opcional (`optionalDocument`); el resto
    // de los datos del pasajero se sigue exigiendo igual.
    expect(validateCheckoutPassenger({ ...validPassenger, documentId: "" }, false, true)).toEqual({});
    expect(validateCheckoutPassenger({ ...validPassenger, documentId: "", email: "" }, false, true)).toMatchObject({
      email: expect.any(String)
    });
    expect(validateCheckoutPassenger({ ...validPassenger, documentId: "", firstName: "" }, false, true)).toMatchObject({
      firstName: expect.any(String)
    });
    // Opcional no es «cualquier cosa»: un DNI cargado mal se marca en el campo, antes de enviar.
    expect(validateCheckoutPassenger({ ...validPassenger, documentId: "12" }, false, true)).toEqual({
      documentId: "Ingresá un DNI de 7 u 8 dígitos."
    });
  });

  it("combines the mandatory country code with the local phone number", () => {
    expect(buildPassengerPayload(validPassenger).phone).toBe("+5492944000000");
  });
});

describe("checkout nationality helpers", () => {
  it("offers a broad list of nationality countries in Spanish", () => {
    const options = getNationalityOptions();

    expect(options.length).toBeGreaterThan(190);
    expect(options).toContain("Argentina");
    expect(options).toContain("Chile");
  });

  it("filters nationality options without caring about accents or case", () => {
    expect(filterNationalityOptions("espana")).toContain("España");
  });
});

/**
 * La reserva de un solo tramo, en el orden que ve el pasajero: las tres tarjetas de
 * `AirportTripOptions` en el paso 1 y, en el paso del vuelo, la barra estilo Kiwi con **un solo
 * tramo** (día y vuelo en el mismo panel), sin el botón de invertir que sólo tiene sentido en ida y
 * vuelta.
 */
describe("checkout de un solo tramo del aeropuerto", () => {
  const dia = "2026-11-20";

  const vuelo = (id: string, direction: "ARRIVAL" | "DEPARTURE", number: string) => ({
    id,
    number,
    direction,
    airline: "AR",
    origin: "Aeroparque",
    scheduledAt: `${dia}T15:00:00.000Z`,
    estimatedAt: null,
    status: "SCHEDULED",
    available: 10,
    bookable: true,
    reason: null
  });

  const props = {
    route: { slug: "aeropuerto-chapelco-sma", priceCents: 1000000, currency: "ARS" },
    fares: {
      ARRIVAL: { priceCents: 1000000, currency: "ARS" },
      DEPARTURE: { priceCents: 1000000, currency: "ARS" }
    },
    initialDirection: "ARRIVAL" as const,
    initialDate: dia,
    initialFlights: [
      vuelo("vuelo-llegada", "ARRIVAL", "AR1656"),
      vuelo("vuelo-salida", "DEPARTURE", "AR1657")
    ],
    coverage: { enabled: false, boundary: [], exclusions: [] },
    extras: { zoneExtraCents: 0, sportsLuggageCents: 0 }
  };

  function veces(html: string, fragmento: string) {
    return html.split(fragmento).length - 1;
  }

  it("el paso 1 sigue mostrando las tres opciones de AirportTripOptions", () => {
    const html = renderToStaticMarkup(createElement(AirportCheckoutForm, props));
    // Tres tarjetas: llegada y salida como botones (aria-pressed) e ida y vuelta como link.
    expect(veces(html, 'aria-pressed="')).toBe(2);
    expect(veces(html, "wizard-option-route")).toBe(3);
    expect(html).toContain("Llegada a Chapelco");
    expect(html).toContain("Salida desde San Martín");
    expect(html).toContain("Ida y vuelta");
    expect(html).toContain("Paso 1 de 3");
    // Las tarjetas son el selector del paso 1: la barra todavía no aparece.
    expect(html).not.toContain("trip-search-leg");
  });

  it("el paso del vuelo usa la barra con un solo tramo y sin botón de invertir", () => {
    // `startAtFlights` es el camino real de la tarjeta «Llegada»/«Salida»: entra directo al vuelo.
    const html = renderToStaticMarkup(createElement(AirportCheckoutForm, { ...props, startAtFlights: true }));
    expect(html).toContain("Paso 2 de 3 · Llegada");
    expect(veces(html, "trip-search-leg")).toBe(1);
    expect(html).not.toContain("Invertir");
    // Desde/Hacia se muestran fijos: el sentido lo eligió la tarjeta del paso 1.
    expect(veces(html, 'data-fijo="true"')).toBe(2);
    // La lista suelta de vuelos del paso 2 ya no está.
    expect(html).not.toContain("flight-options");
  });
});

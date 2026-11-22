import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { emptyLeg } from "@/lib/special-trips/data";
import { previewHistory } from "@/lib/special-trips/import";
import { TripForm } from "./trip-form";

vi.mock("./actions", () => ({ saveTrip: async () => ({}) }));

it("muestra el itinerario y el contacto importados al editar, sin abrir opciones adicionales", () => {
  const description = "Traslado a Lago Puelo, con parada en El Bolsón";
  const contact = "Contacto de prueba";
  const { trips: [trip] } = previewHistory([{
    sheet: "Viajes especiales 2026", row: 3, original: ["15/12/2026", "Grupo de prueba", "12", description, contact, "450000", "120000", "", ""]
  }], "2026-11-22");

  const html = renderToStaticMarkup(createElement(TripForm, {
    vehicles: [], drivers: [],
    draft: {
      id: "importado", version: "2026-11-22T00:00:00.000Z", client: trip.client, contact: trip.contact,
      serviceDate: trip.serviceDate.toISOString().slice(0, 10), endDate: "", status: trip.status,
      passengers: trip.passengers, legs: trip.legs, assignments: [],
      currency: trip.currency, billingMode: trip.billingMode, total: String(trip.totalCents! / 100), payments: trip.payments
    }
  }));

  expect(html.split("<details")[0]).toContain(`>${description}</textarea>`);
  expect(html).toContain("Contacto del registro original");
  expect(html).toContain(`value="${contact}"`);
  expect(html).toContain('value="2026-12-15"');
  expect(html).toContain('value="120000.00"');
});

it("mantiene la descripción dentro de las opciones en un viaje con origen y destino cargados", () => {
  const html = renderToStaticMarkup(createElement(TripForm, {
    vehicles: [], drivers: [],
    draft: {
      id: "estructurado", version: null, client: "Grupo de prueba", serviceDate: "2026-12-15",
      endDate: "", status: "PENDING", assignments: [], billingMode: "UNKNOWN", currency: "ARS", total: "", payments: [],
      legs: [{ ...emptyLeg, origin: "San Martín", destination: "Lago Puelo", description: "Detalle de prueba" }]
    }
  }));

  expect(html).not.toContain("Itinerario registrado");
  expect(html.split("<details")[0]).not.toContain("Detalle de prueba");
  expect(html).toContain("Detalle de prueba");
});

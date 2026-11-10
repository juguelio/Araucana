import { describe, expect, it } from "vitest";
import {
  buildPassengerPayload,
  filterBookableSchedules,
  filterNationalityOptions,
  formatDateTime,
  getNationalityOptions,
  validateCheckoutPassenger
} from "./checkout-form";
import type { PublicRouteDto, ScheduleOptionDto, SeatMapDto } from "@/lib/booking/types";

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

  it("accepts a formatted DNI and lets staff omit it", () => {
    expect(validateCheckoutPassenger({ ...validPassenger, documentId: "30.111.222" })).toEqual({});
    expect(validateCheckoutPassenger({ ...validPassenger, documentId: "", email: "" }, true)).toEqual({});
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

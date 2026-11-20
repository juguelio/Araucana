import { describe, expect, it } from "vitest";
import { claveDeViaje, horaDelViaje, ordenarPorViaje } from "./admin-travel-order";

const alta = new Date("2026-11-10T12:00:00.000Z");

describe("orden del listado de reservas por día y hora del viaje (20-nov)", () => {
  // Datos de las rutas reales: San Martín → Villa Traful sale los sábados 10:00; la vuelta, 15:45.
  const traful = { id: "a", code: "ARC-A", createdAt: alta, schedule: { departureAt: new Date("2026-11-21T13:00:00.000Z") } };
  const vueltaTraful = { id: "b", code: "ARC-B", createdAt: alta, schedule: { departureAt: new Date("2026-11-21T18:45:00.000Z") } };
  const aeropuertoConVuelo = {
    id: "c",
    code: "ARC-C",
    createdAt: alta,
    airportDetails: { serviceDate: new Date("2026-11-20T03:00:00.000Z"), flight: { scheduledAt: new Date("2026-11-20T15:30:00.000Z") } }
  };
  const aeropuertoSinVuelo = { id: "d", code: "ARC-D", createdAt: alta, airportDetails: { serviceDate: new Date("2026-11-21T03:00:00.000Z"), flight: null } };
  const chapelco = { id: "e", code: "ARC-E", createdAt: alta, chapelcoDetails: { serviceDate: new Date("2026-11-22T00:00:00.000Z") } };

  it("la hora es la de Argentina y sólo si se conoce", () => {
    expect(horaDelViaje(traful)).toBe("10:00");
    expect(horaDelViaje(vueltaTraful)).toBe("15:45");
    expect(horaDelViaje(aeropuertoConVuelo)).toBe("12:30");
    expect(horaDelViaje(aeropuertoSinVuelo)).toBeNull();
  });

  it("la clave usa el día del viaje (Chapelco guarda el día calendario)", () => {
    expect(claveDeViaje(traful)).toBe("2026-11-21 10:00");
    expect(claveDeViaje(aeropuertoSinVuelo)).toBe("2026-11-21 00:00");
    expect(claveDeViaje(chapelco)).toBe("2026-11-22 00:00");
  });

  it("ordena por día y hora, de ida y de vuelta", () => {
    const todas = [chapelco, vueltaTraful, aeropuertoSinVuelo, traful, aeropuertoConVuelo];
    expect(ordenarPorViaje(todas, "asc").map((r) => r.code)).toEqual(["ARC-C", "ARC-D", "ARC-A", "ARC-B", "ARC-E"]);
    expect(ordenarPorViaje(todas, "desc").map((r) => r.code)).toEqual(["ARC-E", "ARC-B", "ARC-A", "ARC-D", "ARC-C"]);
  });

  it("dos reservas del mismo viaje quedan siempre en el mismo orden (por código)", () => {
    const otra = { ...traful, id: "z", code: "ARC-0" };
    expect(ordenarPorViaje([traful, otra], "asc").map((r) => r.code)).toEqual(["ARC-0", "ARC-A"]);
    expect(ordenarPorViaje([otra, traful], "desc").map((r) => r.code)).toEqual(["ARC-0", "ARC-A"]);
  });
});

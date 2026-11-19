import { describe, expect, it } from "vitest";
import { jornadasPorCombi } from "./driver-day";
import { buildServiceOrderBlocks, type ServiceOrderReservationInput, type ServiceOrderVehicle } from "./service-order";

const combi = (flight: string, numero: number, chofer: string): ServiceOrderVehicle => ({
  assignmentId: `c${numero}-${flight}`, vehicleId: `combi-${numero}`, name: `${1910 + numero}`, seats: 15, driver: chofer, driverId: `id-${chofer}`
});

function reserva(code: string, flight: { id: string; number: string; at: string; direction: string; group?: string; vehicles: ServiceOrderVehicle[] }): ServiceOrderReservationInput {
  return {
    code, totalCents: 1000, currency: "ARS", passengerCount: 2, paymentStatus: "PAID", direction: flight.direction, flightNumber: flight.number,
    pickupName: null, pickupAddress: null, pickupNotes: null, pickupLatitude: -40.157, pickupLongitude: -71.353,
    passenger: { firstName: code, lastName: "Paz", phone: "1", documentType: "DNI", documentId: "1" },
    flight: {
      id: flight.id, number: flight.number, airline: null, direction: flight.direction, scheduledAt: new Date(`2026-11-19T${flight.at}:00-03:00`),
      estimatedAt: null, pickupStartOverrideAt: flight.direction === "DEPARTURE" ? new Date("2026-11-19T13:30:00-03:00") : null,
      pickupGroupId: flight.group ?? null, vehicles: flight.vehicles
    }
  };
}

describe("jornadasPorCombi: el día IN/OUT de cada chofer", () => {
  const ja = { id: "f-ja", number: "JA3184", at: "16:13", direction: "DEPARTURE", group: "g", vehicles: [combi("ja", 3, "Escobar"), combi("ja", 4, "Lopez")] };
  const ar = { id: "f-ar", number: "AR1657", at: "16:00", direction: "DEPARTURE", group: "g", vehicles: [combi("ar", 4, "Lopez")] };
  const in1656 = { id: "f-in", number: "AR1656", at: "15:20", direction: "ARRIVAL", vehicles: [combi("in", 4, "Lopez")] };

  it("une el OUT de la recorrida con el IN que hace la misma combi, en orden", () => {
    // 16 pasajeros en una recorrida con dos combis de 15: salen las dos.
    const reservas = [
      ...Array.from({ length: 4 }, (_, i) => reserva(`J${i}`, ja)),
      ...Array.from({ length: 4 }, (_, i) => reserva(`A${i}`, ar)),
      reserva("I1", in1656)
    ];
    const jornadas = jornadasPorCombi(buildServiceOrderBlocks(reservas));
    const lopez = jornadas.find((jornada) => jornada.vehicleId === "combi-4")!;
    expect(lopez.choferes).toEqual(["Lopez"]);
    expect(lopez.choferId).toBe("id-Lopez");
    expect(lopez.tramos.map((tramo) => [tramo.direction, tramo.vuelos])).toEqual([
      ["DEPARTURE", "AR1657 + JA3184"],
      ["ARRIVAL", "AR1656"]
    ]);
    expect(lopez.sinIn).toBe(false);
    expect(lopez.tramos[1].orden).toEqual({ flight: "f-in", vehicle: null });

    const escobar = jornadas.find((jornada) => jornada.vehicleId === "combi-3")!;
    expect(escobar.tramos.map((tramo) => tramo.direction)).toEqual(["DEPARTURE"]);
    expect(escobar.sinIn).toBe(true);
    expect(escobar.tramos[0].orden.vehicle).toBeTruthy();
  });

  it("deja afuera las órdenes sin nave", () => {
    const sinNave = { ...in1656, vehicles: [] };
    expect(jornadasPorCombi(buildServiceOrderBlocks([reserva("I1", sinNave)]))).toEqual([]);
  });
});

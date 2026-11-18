import { describe, expect, it } from "vitest";
import { blockTimeLabel, buildServiceOrderBlocks, ordenesDelVuelo, type ServiceOrderReservationInput, type ServiceOrderVehicle } from "./service-order";

const nave = (assignmentId: string, vehicleId = "trafic"): ServiceOrderVehicle => ({ assignmentId, vehicleId, name: "Trafic 1", seats: 15, driver: "Rosa" });

function reserva(code: string, flight: { id: string; number: string; at: string; direction?: string; group?: string | null; vehicles?: ServiceOrderVehicle[] }, extra: Partial<ServiceOrderReservationInput> = {}): ServiceOrderReservationInput {
  const direction = flight.direction ?? "DEPARTURE";
  return {
    code, totalCents: 100000, currency: "ARS", passengerCount: 2, paymentStatus: "PENDING", direction, flightNumber: flight.number,
    pickupName: `Hotel ${code}`, pickupAddress: null, pickupNotes: null,
    passenger: { firstName: code, lastName: "Paz", phone: "1", documentType: "DNI", documentId: "1" },
    flight: {
      id: flight.id, number: flight.number, airline: "AR", direction, scheduledAt: new Date(`2026-11-20T${flight.at}:00-03:00`),
      estimatedAt: null, pickupStartOverrideAt: direction === "DEPARTURE" ? new Date("2026-11-20T11:00:00-03:00") : null,
      pickupGroupId: flight.group ?? null, vehicles: flight.vehicles ?? [nave(`asig-${flight.id}`)]
    },
    ...extra
  };
}

const ar = { id: "f-ar", number: "AR1650", at: "14:00", group: "g1" };
const ja = { id: "f-ja", number: "JA3046", at: "14:40", group: "g1" };

describe("una sola camioneta para varios vuelos: la hoja los une en una orden", () => {
  it("dos partidas coordinadas juntas con la misma nave dan una sola orden con todos los pasajeros", () => {
    const blocks = buildServiceOrderBlocks([reserva("Ana", ar), reserva("Beto", ja), reserva("Ceci", ar)]);
    expect(blocks).toHaveLength(1);
    const [orden] = blocks;
    expect(orden.flightIds).toEqual(["f-ar", "f-ja"]);
    expect(orden.flightId).toBe("f-ar");
    expect(orden.flightNumber).toBe("AR1650 + JA3046");
    // Cada pasajero lleva su vuelo, para que el chofer sepa a cuál va.
    expect(orden.passengers.map((p) => p.name).sort()).toEqual(["Ana Paz · AR1650", "Beto Paz · JA3046", "Ceci Paz · AR1650"]);
    expect(blockTimeLabel(orden, { sinRecorrida: true })).toBe("OUT AR1650 despegue 14:00 + JA3046 despegue 14:40 · Trafic 1 · Rosa");
  });

  it("si un vuelo de la vuelta está demorado, el rótulo muestra también la hora programada", () => {
    const demorado = reserva("Beto", ja);
    demorado.flight!.estimatedAt = new Date("2026-11-20T15:10:00-03:00");
    const [orden] = buildServiceOrderBlocks([reserva("Ana", ar), demorado]);
    expect(blockTimeLabel(orden, { sinRecorrida: true })).toContain("JA3046 despegue 15:10 (programado 14:40)");
    expect(ordenesDelVuelo([orden], "f-ja")).toEqual([orden]);
  });

  it("dos arribos juntados dan una sola orden que ordena por la primera llegada", () => {
    const a = { ...ar, direction: "ARRIVAL", at: "13:10" };
    const b = { ...ja, direction: "ARRIVAL", at: "13:30" };
    const [orden, ...resto] = buildServiceOrderBlocks([reserva("Beto", b), reserva("Ana", a)]);
    expect(resto).toHaveLength(0);
    expect(orden.flights.map((vuelo) => vuelo.number)).toEqual(["AR1650", "JA3046"]);
    expect(orden.operationAt).toEqual(new Date("2026-11-20T13:10:00-03:00"));
    expect(blockTimeLabel(orden)).toBe("Llega AR1650 llega 13:10 + JA3046 llega 13:30 · Trafic 1 · Rosa");
  });

  it("si el grupo usa más de una nave, cada vuelo sigue con su orden", () => {
    const otra = { ...ja, vehicles: [nave("asig-ja", "master")] };
    const blocks = buildServiceOrderBlocks([reserva("Ana", ar), reserva("Beto", otra)]);
    expect(blocks).toHaveLength(2);
    // La hoja de un vuelo trae sólo su orden: el chofer del AR no recibe a los pasajeros del JA.
    expect(ordenesDelVuelo(blocks, "f-ja").map((block) => block.passengers.map((p) => p.name))).toEqual([["Beto Paz"]]);
    expect(ordenesDelVuelo(blocks, null)).toHaveLength(2);
  });

  it("sin grupo, o con un solo vuelo del grupo en la hoja, no cambia nada", () => {
    expect(buildServiceOrderBlocks([reserva("Ana", { ...ar, group: null }), reserva("Beto", { ...ja, group: null })])).toHaveLength(2);
    const [solo] = buildServiceOrderBlocks([reserva("Ana", ar)]);
    expect(solo.flightIds).toEqual(["f-ar"]);
    expect(solo.passengers[0].name).toBe("Ana Paz");
  });
});

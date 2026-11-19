import { describe, expect, it } from "vitest";
import { blockTimeLabel, buildServiceOrderBlocks, filtrarPorNave, ordenesDelVuelo, type ServiceOrderReservationInput, type ServiceOrderVehicle } from "./service-order";

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

  it("si cada vuelo de la vuelta trae su nave, se juntan y cada nave lleva a gente de los dos vuelos", () => {
    const otra = { ...ja, vehicles: [nave("asig-ja", "master")] };
    const blocks = buildServiceOrderBlocks([reserva("Ana", ar), reserva("Beto", otra)]);
    // Entran todos en una nave: el reparto no manda la segunda nave al centro para buscar a uno solo.
    expect(blocks).toHaveLength(1);
    expect(blocks[0].flightIds).toEqual(["f-ar", "f-ja"]);
    expect(blocks[0].vehicleCount).toBe(2);
    expect(ordenesDelVuelo(blocks, "f-ja")).toEqual(blocks);
  });

  describe("dos vuelos llenos y dos trafics en la misma vuelta", () => {
    // Dos zonas bien separadas: el centro de San Martín y el camino a Quila Quina.
    const centro = (n: number) => ({ pickupLatitude: -40.157 + n * 0.0005, pickupLongitude: -71.353 + n * 0.0005 });
    const quila = (n: number) => ({ pickupLatitude: -40.18 + n * 0.0005, pickupLongitude: -71.45 + n * 0.0005 });
    const trafics = (vuelo: string): ServiceOrderVehicle[] => [
      { assignmentId: `t1-${vuelo}`, vehicleId: "trafic-1", name: "Trafic 1", seats: 8, driver: "Rosa" },
      { assignmentId: `t2-${vuelo}`, vehicleId: "trafic-2", name: "Trafic 2", seats: 8, driver: "Hugo" }
    ];
    const arLleno = { ...ar, vehicles: trafics("ar") };
    const jaLleno = { ...ja, vehicles: trafics("ja") };
    // Cada vuelo trae gente de las dos zonas, mezclada: 8 lugares por vuelo, 16 en total.
    const reservas = () => [
      reserva("A1", arLleno, centro(1)), reserva("A2", arLleno, quila(1)), reserva("A3", arLleno, centro(2)), reserva("A4", arLleno, quila(2)),
      reserva("J1", jaLleno, quila(3)), reserva("J2", jaLleno, centro(3)), reserva("J3", jaLleno, quila(4)), reserva("J4", jaLleno, centro(4))
    ];

    it("arma una orden por trafic, repartida por zona y no por vuelo", () => {
      const blocks = buildServiceOrderBlocks(reservas());
      expect(blocks).toHaveLength(2);
      expect(blocks.map((block) => block.vehicle?.name)).toEqual(["Trafic 1", "Trafic 2"]);
      const zonas = blocks.map((block) => block.passengers.map((p) => p.code).sort());
      expect(zonas).toContainEqual(["A1", "A3", "J2", "J4"]);
      expect(zonas).toContainEqual(["A2", "A4", "J1", "J3"]);
      for (const block of blocks) {
        expect(block.flightIds).toEqual(["f-ar", "f-ja"]);
        expect(block.passengers.reduce((total, p) => total + p.seats, 0)).toBe(8);
      }
      // Cada chofer recibe sólo su trafic, con los pasajeros de los dos vuelos.
      expect(filtrarPorNave(blocks, "t2-ar").map((block) => block.vehicle?.name)).toEqual(["Trafic 2"]);
    });

    it("una demora que da vuelta el orden de los vuelos no le cambia la zona ni el link a ningún chofer", () => {
      const antes = buildServiceOrderBlocks(reservas());
      const demorados = reservas().map((item) =>
        item.flight?.id === "f-ar" ? { ...item, flight: { ...item.flight, estimatedAt: new Date("2026-11-20T16:00:00-03:00") } } : item
      );
      const despues = buildServiceOrderBlocks(demorados);
      expect(despues[0].flightIds).toEqual(["f-ja", "f-ar"]);
      const porTrafic = (blocks: typeof antes) =>
        Object.fromEntries(blocks.map((block) => [block.vehicle!.vehicleId, { ref: block.vehicle!.assignmentId, codes: block.passengers.map((p) => p.code).sort() }]));
      expect(porTrafic(despues)).toEqual(porTrafic(antes));
    });

    it("la trafic elegida a mano se respeta aunque la reserva sea del otro vuelo", () => {
      // J1 (zona Quila Quina) fijada a mano en la Trafic 1 por el id de asignación de su propio vuelo.
      const fijada = reservas().map((item) => (item.code === "J1" ? { ...item, assignmentId: "t1-ja" } : item));
      const blocks = buildServiceOrderBlocks(fijada);
      const t1 = blocks.find((block) => block.vehicle?.vehicleId === "trafic-1")!;
      expect(t1.vehicle?.assignmentId).toBe("t1-ar");
      expect(t1.passengers.map((p) => p.code)).toContain("J1");
      expect(blocks.flatMap((block) => block.passengers)).toHaveLength(8);
    });
  });

  it("sin grupo, o con un solo vuelo del grupo en la hoja, no cambia nada", () => {
    expect(buildServiceOrderBlocks([reserva("Ana", { ...ar, group: null }), reserva("Beto", { ...ja, group: null })])).toHaveLength(2);
    const [solo] = buildServiceOrderBlocks([reserva("Ana", ar)]);
    expect(solo.flightIds).toEqual(["f-ar"]);
    expect(solo.passengers[0].name).toBe("Ana Paz");
  });
});

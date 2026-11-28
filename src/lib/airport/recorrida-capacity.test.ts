import { describe, expect, it } from "vitest";
import { cupoDeRecorrida } from "./recorrida-capacity";

const vuelo = (id: string, pasajeros: number) => ({
  direction: "ARRIVAL",
  pickupGroupId: "recorrida",
  reservations: [{ reservationId: `reserva-${id}`, reservation: { passengerCount: pasajeros, status: "CONFIRMED" } }],
  assignments: [] as Array<{ vehicleId: string; vehicle: { seats: unknown[] } }>
});

describe("cupo de una recorrida", () => {
  it("sin combi asignada usa el cupo provisorio de 24 y no marca faltantes", () => {
    expect(cupoDeRecorrida([vuelo("a", 1), vuelo("b", 0)])).toMatchObject({
      ocupados: 1,
      capacidad: 24,
      lugaresAsignados: 0,
      naves: 0,
      disponibles: 23,
      faltan: 0
    });
  });

  it("marca faltantes sólo cuando los pasajeros superan el cupo", () => {
    const completo = [vuelo("a", 12), vuelo("b", 12)];
    expect(cupoDeRecorrida(completo)).toMatchObject({ ocupados: 24, capacidad: 24, faltan: 0 });
    expect(cupoDeRecorrida([vuelo("a", 13), vuelo("b", 12)])).toMatchObject({ ocupados: 25, faltan: 1 });
  });
});

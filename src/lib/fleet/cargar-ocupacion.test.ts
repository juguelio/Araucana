import { expect, it, vi } from "vitest";
import { cargarOcupacionDelDia } from "./cargar-ocupacion";
import { ocupacionEnVentana } from "./ocupacion";

/**
 * #439: un vuelo con dos combis. Antes la clave de cada asignación era `vuelo:<flightId>`, así que
 * excluir «el propio vuelo» excluía las dos y el selector mostraba libres naves y choferes que ya
 * estaban en ese vuelo.
 */
const db = vi.hoisted(() => ({ vuelos: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    schedule: { findMany: async () => [] },
    specialTripAssignment: { findMany: async () => [] },
    airportVehicleAssignment: { findMany: db.vuelos },
    chapelcoVehicleDuty: { findMany: async () => [] }
  }
}));

const vuelo = { id: "f1", number: "AR1659", scheduledAt: new Date("2026-11-24T12:30:00-03:00"), estimatedAt: null, status: "SCHEDULED" };

it("un vuelo con dos combis produce dos claves distintas", async () => {
  db.vuelos.mockResolvedValue([
    { id: "a1", flightId: "f1", vehicleId: "sprinter1910", driverId: "hernan", flight: vuelo },
    { id: "a2", flightId: "f1", vehicleId: "bus465", driverId: "silvia", flight: vuelo }
  ]);

  const ocupacion = await cargarOcupacionDelDia("2026-11-24");
  const delVuelo = ocupacion.filter((o) => o.clave.startsWith("vuelo:f1"));

  expect(delVuelo).toHaveLength(2);
  expect(new Set(delVuelo.map((o) => o.clave)).size).toBe(2);
});

it("excluir una combi deja la otra ocupada (no marca libre lo que ya está en el vuelo)", async () => {
  db.vuelos.mockResolvedValue([
    { id: "a1", flightId: "f1", vehicleId: "sprinter1910", driverId: "hernan", flight: vuelo },
    { id: "a2", flightId: "f1", vehicleId: "bus465", driverId: "silvia", flight: vuelo }
  ]);

  const ocupacion = await cargarOcupacionDelDia("2026-11-24");
  const primera = ocupacion.find((o) => o.vehicleIds.includes("sprinter1910"))!;
  const tramo = { desde: primera.desde, hasta: primera.hasta };

  // Lo que hace el modal: excluye la asignación de la fila que se edita.
  const naves = ocupacionEnVentana(ocupacion, "nave", tramo, [primera.clave]);
  const choferes = ocupacionEnVentana(ocupacion, "chofer", tramo, [primera.clave]);

  expect(naves["sprinter1910"]).toBeUndefined(); // la que edito: libre
  expect(choferes["hernan"]).toBeUndefined();
  expect(naves["bus465"]).toBeDefined(); // la otra combi del vuelo: ocupada
  expect(choferes["silvia"]).toBeDefined();
});

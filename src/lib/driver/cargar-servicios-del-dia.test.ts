import { expect, it, vi } from "vitest";
import { cargarServiciosDelDia } from "./cargar-servicios-del-dia";

const airport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/prisma", () => {
  const empty = { findMany: async () => [] };
  return { prisma: { schedule: empty, specialTripAssignment: empty, chapelcoVehicleDuty: empty,
    schoolRun: empty, airportVehicleAssignment: { findMany: airport } } };
});

it("la jornada incluye la recogida del vuelo de madrugada y enlaza al día correcto de Aeropuerto", async () => {
  const id = "f1";
  const flight = { number: "AR1650", direction: "DEPARTURE", scheduledAt: new Date("2026-11-26T01:15:00-03:00"),
    estimatedAt: null, pickupStartInitialAt: null, pickupStartOverrideAt: null, status: "SCHEDULED" };
  const assignment = { id: "a", flightId: id, vehicleId: "v", driverId: "d", flight };
  airport.mockResolvedValue([assignment, { ...assignment, id: "b", flight: { ...flight, scheduledAt: new Date("2026-11-26T16:00:00-03:00") } }]);
  const services = await cargarServiciosDelDia("2026-11-25");
  expect(services).toHaveLength(1);
  expect(services[0]).toMatchObject({ clave: "vuelo:a", desde: new Date("2026-11-25T22:45:00-03:00"),
    href: "/admin/aeropuerto?date=2026-11-26#vuelo-f1" });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAirportReservation } from "@/lib/airport/booking";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { requireReservationsUser } from "@/lib/auth/service";
import type { AirportCoverage, PickupPoint } from "@/lib/airport/pickup-zone";
import { POST } from "./route";

vi.mock("@/lib/airport/booking", () => ({ createAirportReservation: vi.fn() }));
vi.mock("@/lib/airport/pickup-zone-settings", () => ({ getAirportCoverage: vi.fn() }));
vi.mock("@/lib/auth/service", () => ({ requireReservationsUser: vi.fn() }));

const coverage: AirportCoverage = {
  enabled: true,
  boundary: [[-40.17, -71.37], [-40.17, -71.30], [-40.13, -71.30], [-40.13, -71.37]],
  exclusions: [[[-40.16, -71.36], [-40.16, -71.35], [-40.15, -71.35], [-40.15, -71.36]]]
};

function reserve(pickupPoint: PickupPoint, fromAdmin = false) {
  const url = `https://araucana.test/api/v1/airport/reservations${fromAdmin ? "?source=admin" : ""}`;
  return POST(new Request(url, {
    method: "POST",
    body: JSON.stringify({
      routeSlug: "aeropuerto-chapelco-sma",
      flightNumber: "AR1656",
      direction: "ARRIVAL",
      serviceDate: "2030-01-01",
      passenger: {
        firstName: "Ana",
        lastName: "Gomez",
        email: "ana@example.com",
        phone: "+542942000000",
        documentType: "DNI",
        documentId: "30111222",
        nationality: "Argentina"
      },
      pickupPoint
    })
  }));
}

describe("cobertura del punto confirmado en el mapa de la reserva", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAirportCoverage).mockResolvedValue(coverage);
  });

  it.each([false, true])("acepta un punto dentro del perímetro (administración: %s)", async (fromAdmin) => {
    const point: PickupPoint = [-40.151, -71.342];
    const response = await reserve(point, fromAdmin);

    expect(response.status).toBe(201);
    expect(createAirportReservation).toHaveBeenCalledWith(expect.objectContaining({ pickupPoint: point }), fromAdmin);
    expect(requireReservationsUser).toHaveBeenCalledTimes(fromAdmin ? 1 : 0);
  });

  it.each<PickupPoint>([[-40.155, -71.355], [-40.18, -71.342]])("rechaza el punto [%s, %s] por cobertura", async (lat, lng) => {
    const response = await reserve([lat, lng]);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "OUTSIDE_PICKUP_ZONE" } });
    expect(createAirportReservation).not.toHaveBeenCalled();
  });
});

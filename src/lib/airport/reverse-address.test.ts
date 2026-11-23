import { afterEach, expect, it, vi } from "vitest";
import { reverseAirportAddress, nearbyStreet } from "./reverse-address";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("identifica el trazado local y conserva sin dirección un punto lejano", () => {
  expect(nearbyStreet([-40.133215, -71.300635])).toContain("Nunez");
  expect(nearbyStreet([-40.21, -71.46])).toBeNull();
});

it.each([[0, "Calle del Valle 611, San Martín de los Andes"], [0.0006, "Calle del Valle, San Martín de los Andes"]])(
  "sólo usa la altura de una referencia próxima al pin (%s)", async (delta, address) => {
    vi.stubEnv("AIRPORT_GEOCODER_URL", "https://us1.locationiq.com/v1/search");
    vi.stubEnv("AIRPORT_GEOCODER_KEY", "test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      lat: -40.16 + delta, lon: -71.35,
      address: { road: "Calle del Valle", house_number: "611", city: "San Martín de los Andes" }
    })));
    expect(await reverseAirportAddress([-40.16, -71.35], new AbortController().signal)).toBe(address);
  }
);

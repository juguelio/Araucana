import { afterEach, expect, it, vi } from "vitest";
import { lookupAirportIntersection } from "./intersection-lookup";

afterEach(() => vi.unstubAllGlobals());

it("conserva cruces distintos y descarta direcciones sin coordenadas", async () => {
  const corner = (label: string, lat: number | null, lon: number | null) => ({
    nomenclatura: label, calle_cruce_1: { id: "cruce" }, ubicacion: { lat, lon }
  });
  const fetchGeoRef = vi.fn().mockResolvedValue(Response.json({
    direcciones: [
      corner("Av. San Martín y Belgrano", -40.1565, -71.3497),
      corner("San Martín y Belgrano", -40.074, -71.3200),
      corner("Cruce sin coordenadas", null, null)
    ]
  }));
  vi.stubGlobal("fetch", fetchGeoRef);

  await expect(lookupAirportIntersection("San Martín esquina con Belgrano")).resolves.toEqual([
    { label: "Av. San Martín y Belgrano", point: [-40.1565, -71.3497] },
    { label: "San Martín y Belgrano", point: [-40.074, -71.3200] }
  ]);
  const [url] = fetchGeoRef.mock.calls[0];
  expect(url.searchParams.get("direccion")).toBe("San Martín y Belgrano");
  expect(url.searchParams.get("localidad_censal")).toBe("San Martín de los Andes");
});

it("pide dos calles antes de consultar el servicio", async () => {
  const fetchGeoRef = vi.fn();
  vi.stubGlobal("fetch", fetchGeoRef);

  await expect(lookupAirportIntersection("San Martín")).rejects.toMatchObject({ code: "INVALID_INTERSECTION" });
  expect(fetchGeoRef).not.toHaveBeenCalled();
});

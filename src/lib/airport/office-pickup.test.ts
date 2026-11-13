import { describe, expect, it } from "vitest";
import {
  airportOfficePickupSchema,
  defaultAirportOfficePickup,
  officePickupReady,
  type AirportOfficePickup
} from "./office-pickup";

/**
 * Atajo «salir desde la sucursal» (#34). Lo que se fija acá es que el botón **no** aparezca con
 * media configuración (activo sin punto, o sin dirección): el checkout no puede ofrecer un atajo
 * que después deje el traslado sin lugar.
 */

const configurado: AirportOfficePickup = {
  enabled: true,
  label: "la sucursal",
  address: "Mariano Moreno 829, San Martín de los Andes",
  point: [-40.1571, -71.3521]
};

describe("atajo de la sucursal", () => {
  it("arranca apagado para no cambiar el checkout de un día para el otro", () => {
    expect(defaultAirportOfficePickup.enabled).toBe(false);
    expect(defaultAirportOfficePickup.point).toBeNull();
    expect(officePickupReady(defaultAirportOfficePickup)).toBe(false);
  });

  it("con punto y activo, el atajo se ofrece", () => {
    expect(officePickupReady(configurado)).toBe(true);
  });

  it("activo sin punto no ofrece nada", () => {
    expect(officePickupReady({ ...configurado, point: null })).toBe(false);
  });

  it("rechaza coordenadas fuera del planeta", () => {
    expect(airportOfficePickupSchema.safeParse({ ...configurado, point: [-91, -71.35] }).success).toBe(false);
    expect(airportOfficePickupSchema.safeParse({ ...configurado, point: [-40.15, -181] }).success).toBe(false);
  });

  it("exige un nombre y una dirección para el atajo", () => {
    expect(airportOfficePickupSchema.safeParse({ ...configurado, label: "  " }).success).toBe(false);
    expect(airportOfficePickupSchema.safeParse({ ...configurado, address: "" }).success).toBe(false);
  });

  it("normaliza los espacios de lo que se carga en el panel", () => {
    const parsed = airportOfficePickupSchema.parse({ ...configurado, label: "  la sucursal  ", address: "  Roca 500 " });
    expect(parsed.label).toBe("la sucursal");
    expect(parsed.address).toBe("Roca 500");
  });
});

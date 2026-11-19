import { describe, expect, it } from "vitest";
import { canSavePickup, pickupFormFields, PICKUP_WITHOUT_POINT, type PickupAddressDraft } from "./pickup-address";

const sinPunto: PickupAddressDraft = { address: "Hostal del Esquiador", point: null, confirmed: false };
const conPunto: PickupAddressDraft = { address: "Coronel Rohde 975", point: [-40.1565, -71.3497], confirmed: true };

describe("domicilio del traslado en el panel", () => {
  it("deja guardar el alojamiento como texto, sin punto, en el aeropuerto (#268)", () => {
    expect(canSavePickup(true, sinPunto, { airport: true, outside: false })).toBe(true);
    // Sin texto no hay nada que guardar: el punto vacío no alcanza.
    expect(canSavePickup(true, { ...sinPunto, address: "  " }, { airport: true, outside: false })).toBe(false);
  });

  it("fuera del aeropuerto el punto sigue siendo obligatorio", () => {
    // El traslado de Chapelco guarda coordenadas en la base: no puede quedar sin punto.
    expect(canSavePickup(true, sinPunto, { airport: false, outside: false })).toBe(false);
    expect(canSavePickup(true, conPunto, { airport: false, outside: false })).toBe(true);
  });

  it("con punto exige confirmarlo y que esté dentro de la cobertura", () => {
    expect(canSavePickup(true, { ...conPunto, confirmed: false }, { airport: true, outside: false })).toBe(false);
    expect(canSavePickup(true, conPunto, { airport: true, outside: true })).toBe(false);
  });

  it("un domicilio que no cambió no bloquea el resto del formulario", () => {
    expect(canSavePickup(false, sinPunto, { airport: false, outside: true })).toBe(true);
  });

  it("sin punto no manda coordenadas ni la confirmación del mapa", () => {
    expect(pickupFormFields(sinPunto)).toEqual({ address: "Hostal del Esquiador" });
    expect(pickupFormFields(conPunto)).toEqual({
      address: "Coronel Rohde 975",
      latitude: "-40.1565",
      longitude: "-71.3497",
      confirmed: "on"
    });
  });

  it("el aviso dice que el domicilio va sin coordenadas", () => {
    expect(PICKUP_WITHOUT_POINT).toContain("sin coordenadas en el mapa");
  });
});

import { describe, expect, it } from "vitest";
import {
  canSavePickup, PICKUP_BLOCK_MESSAGES, pickupBlockReason, pickupFormFields, PICKUP_WITHOUT_POINT,
  type PickupAddressDraft
} from "./pickup-address";

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

  it("dice el motivo del bloqueo, que es lo que el botón repite al pie (#343)", () => {
    // Elegir una sugerencia del buscador deja `confirmed: false`: el guardado queda bloqueado por
    // un tilde que vive arriba del mapa, lejos del botón.
    expect(pickupBlockReason(true, { ...conPunto, confirmed: false }, { airport: true, outside: false }))
      .toBe("sin-confirmar");
    expect(pickupBlockReason(true, conPunto, { airport: false, outside: true })).toBe("fuera-de-zona");
    expect(pickupBlockReason(true, sinPunto, { airport: false, outside: false })).toBe("sin-punto");
    expect(pickupBlockReason(true, { ...sinPunto, address: "   " }, { airport: true, outside: false }))
      .toBe("sin-direccion");
    expect(pickupBlockReason(true, conPunto, { airport: true, outside: false })).toBe("ok");
    expect(pickupBlockReason(false, sinPunto, { airport: false, outside: true })).toBe("ok");
  });

  it("cada motivo tiene su mensaje legible y el de confirmar nombra el tilde que falta", () => {
    for (const motivo of ["sin-punto", "sin-direccion", "sin-confirmar", "fuera-de-zona"] as const) {
      expect(PICKUP_BLOCK_MESSAGES[motivo].length).toBeGreaterThan(20);
    }
    expect(PICKUP_BLOCK_MESSAGES["sin-confirmar"]).toContain("Confirmo que el mapa marca el lugar correcto");
  });
});

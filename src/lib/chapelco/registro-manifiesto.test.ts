import { expect, it } from "vitest";
import { registroAnteriorChapelco } from "./registro-manifiesto";

it("preserva los tres estados históricos sin atribuir el registro a una nave o chofer", () => {
  expect(registroAnteriorChapelco("BOARDED", 1)).toBe("Subió 1 pasajero · Registro anterior de la vuelta");
  expect(registroAnteriorChapelco("TRANSPORTED", 3)).toBe("3 pasajeros trasladados · Registro anterior de la vuelta");
  expect(registroAnteriorChapelco("NO_SHOW", 2)).toBe("Ausente · Registro anterior de la vuelta");
  expect(registroAnteriorChapelco("PENDING", 2)).toBeUndefined();
});

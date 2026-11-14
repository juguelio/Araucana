import { describe, expect, it } from "vitest";
import { reservationRowClassName } from "./row-style";

describe("fila del listado de reservas (#108)", () => {
  it("marca en gris la reserva cancelada para que se distinga sin abrirla", () => {
    expect(reservationRowClassName("CANCELLED")).toBe("reservas-row-cancelled");
  });

  it("deja las demás filas como estaban", () => {
    for (const status of ["CONFIRMED", "PENDING_PAYMENT", "DOCUMENTATION_PENDING"]) {
      expect(reservationRowClassName(status)).toBeUndefined();
    }
  });
});

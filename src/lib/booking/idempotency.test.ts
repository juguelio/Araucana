import { describe, expect, it } from "vitest";
import { claveDelTramo, nuevaClaveDeIdempotencia } from "./idempotency";
import { idempotencyKeySchema } from "@/lib/airport/validation";

/**
 * Idempotencia del alta (#139): la clave la genera el formulario y el servidor la guarda en la
 * reserva para devolver esa misma reserva si el pasajero reintenta el mismo intento.
 */

describe("clave de idempotencia", () => {
  it("cada intento genera una clave distinta y con el formato que acepta el servidor", () => {
    const primera = nuevaClaveDeIdempotencia();
    const segunda = nuevaClaveDeIdempotencia();
    expect(primera).not.toBe(segunda);
    expect(idempotencyKeySchema.safeParse(primera).success).toBe(true);
    expect(idempotencyKeySchema.safeParse(segunda).success).toBe(true);
  });

  it("el servidor acepta claves cortas y rechaza basura", () => {
    expect(idempotencyKeySchema.safeParse("intento-1").success).toBe(true);
    expect(idempotencyKeySchema.safeParse("abc").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("clave con espacios").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("x".repeat(81)).success).toBe(false);
  });

  it("en el ida y vuelta la clave del viaje se guarda con un sufijo por tramo", () => {
    expect(claveDelTramo("viaje-1", "ARRIVAL")).toBe("viaje-1:arrival");
    expect(claveDelTramo("viaje-1", "DEPARTURE")).toBe("viaje-1:departure");
    // Las dos filas del viaje no pueden compartir clave: la columna es única.
    expect(claveDelTramo("viaje-1", "ARRIVAL")).not.toBe(claveDelTramo("viaje-1", "DEPARTURE"));
  });
});

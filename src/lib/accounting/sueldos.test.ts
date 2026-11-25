import { describe, expect, it } from "vitest";
import { estadoDeSueldo, fechaPorDefecto, mesVecino, sueldosDelMes, totalesDeSueldos, type PersonaConSueldo } from "./sueldos";

const persona = (id: string, nombre: string, extra: Partial<PersonaConSueldo> = {}): PersonaConSueldo => ({
  id, nombre, rol: "DRIVER", activo: true, sueldoCents: 100_000_00, moneda: "ARS", ...extra
});

describe("estadoDeSueldo", () => {
  it("pendiente, parcial, pagado, de más y sin sueldo", () => {
    expect(estadoDeSueldo(1000, 0)).toBe("pendiente");
    expect(estadoDeSueldo(1000, 400)).toBe("parcial");
    expect(estadoDeSueldo(1000, 1000)).toBe("pagado");
    expect(estadoDeSueldo(1000, 1200)).toBe("de-mas");
    expect(estadoDeSueldo(null, 500)).toBe("sin-sueldo");
    expect(estadoDeSueldo(0, 0)).toBe("sin-sueldo");
  });
});

describe("sueldosDelMes", () => {
  const personas = [
    persona("ana", "Ana"),
    persona("beto", "Beto"),
    persona("caro", "Caro", { rol: "SECRETARY", sueldoCents: 80_000_00 }),
    persona("dani", "Dani", { sueldoCents: null }),
    persona("eli", "Eli", { activo: false }),
    persona("fede", "Fede", { activo: false }),
    persona("gabi", "Gabi", { moneda: "USD", sueldoCents: 1_000_00 })
  ];
  const pagos = [
    { userId: "ana", amountCents: 100_000_00, currency: "ARS" },
    { userId: "beto", amountCents: 30_000_00, currency: "ARS" },
    { userId: "beto", amountCents: 20_000_00, currency: "ARS" },
    { userId: "eli", amountCents: 50_000_00, currency: "ARS" },
    { userId: "gabi", amountCents: 900_000_00, currency: "ARS" }
  ];
  const base = [{ driverId: "ana", dias: 12, salidas: 30, horas: 61.5 }, { driverId: "fede", dias: 2, salidas: 3, horas: 4 }];
  const filas = sueldosDelMes(personas, pagos, base);
  const de = (id: string) => filas.find((f) => f.userId === id)!;

  it("suma los pagos del período y calcula lo que falta", () => {
    expect(de("ana")).toMatchObject({ pagadoCents: 100_000_00, pendienteCents: 0, estado: "pagado", pagos: 1 });
    expect(de("beto")).toMatchObject({ pagadoCents: 50_000_00, pendienteCents: 50_000_00, estado: "parcial", pagos: 2 });
    expect(de("caro")).toMatchObject({ pendienteCents: 80_000_00, estado: "pendiente", base: null });
    expect(de("dani")).toMatchObject({ pendienteCents: null, estado: "sin-sueldo" });
  });

  it("los choferes llevan su base de días, salidas y horas (cero si no tuvieron salidas)", () => {
    expect(de("ana").base).toEqual({ dias: 12, salidas: 30, horas: 61.5 });
    expect(de("beto").base).toEqual({ dias: 0, salidas: 0, horas: 0 });
  });

  it("las inactivas aparecen sólo si tuvieron pagos o salidas ese mes", () => {
    expect(de("eli")).toMatchObject({ activo: false, estado: "parcial" });
    expect(de("fede")).toMatchObject({ activo: false, base: { dias: 2, salidas: 3, horas: 4 } });
    const sinNada = sueldosDelMes([persona("zoe", "Zoe", { activo: false })], [], []);
    expect(sinNada).toEqual([]);
  });

  it("un pago en pesos no descuenta un sueldo en dólares", () => {
    expect(de("gabi")).toMatchObject({ moneda: "USD", pagadoCents: 0, estado: "pendiente", pagosEnOtraMoneda: [{ currency: "ARS", amountCents: 900_000_00 }] });
  });

  it("lo pendiente primero, después por nombre", () => {
    expect(filas.map((f) => f.userId)).toEqual(["caro", "fede", "gabi", "beto", "eli", "dani", "ana"]);
  });

  it("totales por moneda", () => {
    expect(totalesDeSueldos(filas)).toEqual([
      { moneda: "ARS", pactadoCents: 480_000_00, pagadoCents: 200_000_00, pendienteCents: 280_000_00, personasPendientes: 4 },
      { moneda: "USD", pactadoCents: 1_000_00, pagadoCents: 0, pendienteCents: 1_000_00, personasPendientes: 1 }
    ]);
  });
});

describe("meses y fechas", () => {
  it("mes anterior y siguiente, cruzando el año", () => {
    expect(mesVecino("2026-11", -1)).toBe("2026-10");
    expect(mesVecino("2026-12", 1)).toBe("2027-01");
    expect(mesVecino("2026-01", -1)).toBe("2025-12");
  });

  it("fecha por defecto: hoy si es el mes; si no, el último día del mes", () => {
    expect(fechaPorDefecto("2026-11", "2026-11-25")).toBe("2026-11-25");
    expect(fechaPorDefecto("2026-10", "2026-11-25")).toBe("2026-10-31");
    expect(fechaPorDefecto("2024-02", "2026-11-25")).toBe("2024-02-29");
  });
});

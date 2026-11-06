import { describe, expect, it } from "vitest";
import { diaEfectivo, diasConSalidas, tiraDeDias, type SalidaOption } from "./salida-picker-utils";

function salida(id: string, dayKey: string, from = "San Martin de los Andes", to = "Aeropuerto Chapelco (CPC)"): SalidaOption {
  return {
    id,
    from,
    to,
    dayKey,
    dayLabel: dayKey,
    timeLabel: "09:00",
    availableSeats: 24,
    status: "OPEN"
  };
}

describe("selector de salida del alta manual", () => {
  it("agrupa por día en orden y cuenta las salidas de cada día", () => {
    const dias = diasConSalidas([
      salida("c", "2026-11-08"),
      salida("a", "2026-11-07"),
      salida("b", "2026-11-07")
    ]);
    expect(dias.map((dia) => [dia.key, dia.count])).toEqual([
      ["2026-11-07", 2],
      ["2026-11-08", 1]
    ]);
  });

  it("abre en el primer día con salidas y no queda en una fecha vacía", () => {
    const dias = diasConSalidas([salida("a", "2026-11-07"), salida("b", "2026-11-20")]);
    expect(diaEfectivo(dias, "")).toBe("2026-11-07");
    // el día elegido ya no tiene salidas (cambió la ruta): cae en el primero disponible
    expect(diaEfectivo(dias, "2026-11-15")).toBe("2026-11-07");
    expect(diaEfectivo(dias, "2026-11-20")).toBe("2026-11-20");
    expect(diaEfectivo([], "2026-11-20")).toBe("");
  });

  it("la tira muestra siete días y suma adelante la fecha lejana elegida", () => {
    const base = Date.UTC(2026, 10, 6);
    const dias = diasConSalidas(
      Array.from({ length: 71 }, (_, indice) => salida(`s${indice}`, new Date(base + indice * 86400000).toISOString().slice(0, 10)))
    );
    expect(dias).toHaveLength(71);
    const tira = tiraDeDias(dias, dias[0].key);
    expect(tira).toHaveLength(7);
    expect(tira[0].key).toBe(dias[0].key);

    const lejano = tiraDeDias(dias, dias[40].key);
    expect(lejano).toHaveLength(8);
    expect(lejano[0].key).toBe(dias[40].key);
  });
});

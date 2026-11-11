import { describe, expect, it } from "vitest";
import { diaEfectivo, diaKey, diasConSalidas, etiquetasDeSalida, tiraDeDias } from "./schedule-days";

describe("días con salidas", () => {
  it("agrupa en hora argentina: una salida de las 23:30 no cae en el día siguiente", () => {
    // 2026-11-15T02:30Z = 14-nov 23:30 en Salta (UTC-3).
    expect(diaKey("2026-11-15T02:30:00Z")).toBe("2026-11-14");
    expect(diaKey("2026-11-14T13:00:00Z")).toBe("2026-11-14");
  });

  it("etiqueta el día en castellano y la hora sin AM/PM", () => {
    const etiquetas = etiquetasDeSalida("2026-11-14T13:00:00Z");
    expect(etiquetas).toMatchObject({ dayKey: "2026-11-14", timeLabel: "10:00" });
    expect(etiquetas.dayLabel).toContain("14");
    expect(etiquetas.dayLabel).not.toContain(".");
  });

  it("cuenta las salidas de cada día y las ordena por fecha", () => {
    const salidas = [
      { dayKey: "2026-11-21", dayLabel: "sáb 21 nov" },
      { dayKey: "2026-11-14", dayLabel: "sáb 14 nov" },
      { dayKey: "2026-11-14", dayLabel: "sáb 14 nov" }
    ];

    expect(diasConSalidas(salidas)).toEqual([
      { key: "2026-11-14", label: "sáb 14 nov", count: 2 },
      { key: "2026-11-21", label: "sáb 21 nov", count: 1 }
    ]);
  });

  it("sin salidas no hay días: la pantalla muestra el aviso, no una tira vacía", () => {
    expect(diasConSalidas([])).toEqual([]);
    expect(diaEfectivo([], "2026-11-14")).toBe("");
  });

  it("si el día elegido se quedó sin lugares, cae en el primero disponible", () => {
    const dias = diasConSalidas([{ dayKey: "2026-11-21", dayLabel: "sáb 21 nov" }]);
    expect(diaEfectivo(dias, "2026-11-14")).toBe("2026-11-21");
    expect(diaEfectivo(dias, "2026-11-21")).toBe("2026-11-21");
  });

  it("la tira del panel corta en siete y adelanta la fecha lejana elegida", () => {
    const dias = Array.from({ length: 10 }, (_, indice) => ({
      key: `2026-12-${String(indice + 1).padStart(2, "0")}`,
      label: `día ${indice + 1}`,
      count: 1
    }));

    expect(tiraDeDias(dias, "2026-12-02")).toHaveLength(7);
    expect(tiraDeDias(dias, "2026-12-09")[0].key).toBe("2026-12-09");
    expect(tiraDeDias(dias, "2026-12-09")).toHaveLength(8);
  });
});

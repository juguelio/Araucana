import { describe, expect, it } from "vitest";
import { claveDia, diasConSalidas, fechaDeClave, etiquetaDia, horaDia, tiraDeDias } from "./dias";

/** 12:00 en Salta (UTC-3) del día indicado. */
function salta(dia: number, mes: number, hora = 12, minuto = 0) {
  return new Date(Date.UTC(2026, mes - 1, dia, hora + 3, minuto));
}

describe("días con salidas del buscador público", () => {
  it("agrupa por día, cuenta las salidas y ordena", () => {
    const dias = diasConSalidas([salta(21, 11), salta(14, 11), salta(14, 11, 16), salta(28, 11)]);

    expect(dias.map((dia) => dia.key)).toEqual(["2026-11-14", "2026-11-21", "2026-11-28"]);
    expect(dias.map((dia) => dia.count)).toEqual([2, 1, 1]);
    expect(dias[0].label).toBe("sáb, 14 nov");
  });

  it("devuelve vacío si no hay salidas", () => {
    expect(diasConSalidas([])).toEqual([]);
  });

  it("la tira muestra los primeros ocho días", () => {
    const salidas = Array.from({ length: 12 }, (_, indice) => salta(1 + indice, 12));
    const tira = tiraDeDias(diasConSalidas(salidas), "", 8);

    expect(tira).toHaveLength(8);
    expect(tira[0].key).toBe("2026-12-01");
    expect(tira[7].key).toBe("2026-12-08");
  });

  it("si la fecha elegida quedó afuera de la ventana, se agrega adelante", () => {
    const salidas = Array.from({ length: 12 }, (_, indice) => salta(1 + indice, 12));
    const tira = tiraDeDias(diasConSalidas(salidas), "2026-12-11", 8);

    expect(tira).toHaveLength(9);
    expect(tira[0].key).toBe("2026-12-11");
    expect(tira[1].key).toBe("2026-12-01");
  });

  it("si la fecha elegida ya está en la ventana, no se duplica", () => {
    const salidas = Array.from({ length: 12 }, (_, indice) => salta(1 + indice, 12));
    const tira = tiraDeDias(diasConSalidas(salidas), "2026-12-03", 8);

    expect(tira).toHaveLength(8);
    expect(tira.filter((dia) => dia.key === "2026-12-03")).toHaveLength(1);
  });

  it("usa la zona de Salta: 23:30 del día 20 en UTC ya es el 21", () => {
    const tarde = new Date("2026-11-21T02:30:00Z");

    expect(claveDia(tarde)).toBe("2026-11-20");
    expect(etiquetaDia(tarde)).toBe("vie, 20 nov");
    expect(horaDia(tarde)).toBe("23:30");
  });

  it("arma la etiqueta de una fecha sin salidas desde su clave", () => {
    const fecha = fechaDeClave("2026-11-10");

    expect(claveDia(fecha)).toBe("2026-11-10");
    expect(etiquetaDia(fecha)).toBe("mar, 10 nov");
  });
});

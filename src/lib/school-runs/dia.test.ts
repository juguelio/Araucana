import { describe, expect, it } from "vitest";
import {
  agruparPorTurno, choquesDelDia, estadoDelServicio, leerFiltroDelDia, leerTurno, nombreCorto, ocupacionParaServicio, solapeDeTurnos,
  type ServicioDelDia
} from "./dia";

const s = (id: string, shift: string, driverId: string | null, vehicleId: string | null, extra: Partial<ServicioDelDia> = {}): ServicioDelDia => ({
  id, routeName: `Ruta ${id}`, shift, driverId, vehicleId, review: null, ...extra
});

describe("leerTurno", () => {
  it("entiende las horas como las escribe la planilla", () => {
    expect(leerTurno("07:30")).toMatchObject({ clave: "07:30", minutos: 450 });
    expect(leerTurno("7.30")).toMatchObject({ clave: "07:30" });
    expect(leerTurno("7:30 hs")).toMatchObject({ clave: "07:30" });
    expect(leerTurno("13 hs")).toMatchObject({ clave: "13:00", minutos: 780 });
    expect(leerTurno("7h05").clave).toBe("07:05");
  });

  it("entiende los turnos con nombre y los ubica donde empiezan", () => {
    expect(leerTurno("Mañana")).toMatchObject({ etiqueta: "Mañana", minutos: null });
    expect(leerTurno("full day").etiqueta).toBe("Jornada completa");
    expect(leerTurno("Jornada completa").clave).toBe(leerTurno("FULL DAY").clave);
    expect(leerTurno("Jornada completa").orden).toBeLessThan(leerTurno("00:00").orden);
    expect(leerTurno("Mañana").orden).toBeLessThan(leerTurno("05:00").orden);
    expect(leerTurno("12:59").orden).toBeLessThan(leerTurno("Tarde").orden);
    expect(leerTurno("Tarde").orden).toBeLessThan(leerTurno("13:00").orden);
  });

  it("lo que no reconoce queda con su texto, y «Sin horario» al final", () => {
    expect(leerTurno("Según vuelo")).toMatchObject({ etiqueta: "Según vuelo", orden: 15_000 });
    expect(leerTurno("Sin horario")).toMatchObject({ clave: "", orden: 20_000 });
    expect(leerTurno("")).toMatchObject({ etiqueta: "Sin horario" });
    expect(leerTurno("25:00").minutos).toBeNull();
  });
});

describe("solapeDeTurnos", () => {
  it("mismo horario es seguro; horas distintas no se marcan", () => {
    expect(solapeDeTurnos(leerTurno("07:30"), leerTurno("7.30"))).toBe("seguro");
    expect(solapeDeTurnos(leerTurno("07:30"), leerTurno("08:00"))).toBeNull();
  });

  it("un turno con nombre cubre las horas que le tocan", () => {
    expect(solapeDeTurnos(leerTurno("Jornada completa"), leerTurno("18:00"))).toBe("posible");
    expect(solapeDeTurnos(leerTurno("Mañana"), leerTurno("07:30"))).toBe("posible");
    expect(solapeDeTurnos(leerTurno("Mañana"), leerTurno("15:00"))).toBeNull();
    expect(solapeDeTurnos(leerTurno("Mañana"), leerTurno("Tarde"))).toBeNull();
    expect(solapeDeTurnos(leerTurno("Jornada completa"), leerTurno("Tarde"))).toBe("posible");
  });

  it("sin horario no choca con nada", () => {
    expect(solapeDeTurnos(leerTurno("Sin horario"), leerTurno("Sin horario"))).toBeNull();
    expect(solapeDeTurnos(leerTurno(""), leerTurno("Jornada completa"))).toBeNull();
  });
});

describe("choques y estado de cada servicio", () => {
  const dia = [
    s("a", "07:30", "ana", "153"),
    s("b", "7:30", "ana", "196"),
    s("c", "Jornada completa", "luis", "153"),
    s("d", "08:00", "ana", "200"),
    s("e", "07:30", null, "300", { review: "Confirmar horario" }),
    s("f", "Sin horario", "ana", "153")
  ];
  const choques = choquesDelDia(dia);

  it("el mismo chofer en el mismo horario choca en los dos servicios", () => {
    expect(choques.get("a")).toContainEqual({ recurso: "chofer", seguro: true, conId: "b", detalle: "07:30 · Ruta b" });
    expect(choques.get("b")).toContainEqual(expect.objectContaining({ recurso: "chofer", conId: "a", seguro: true }));
  });

  it("la misma nave en la jornada completa y a las 07:30 es un posible cruce", () => {
    expect(choques.get("a")).toContainEqual({ recurso: "nave", seguro: false, conId: "c", detalle: "Jornada completa · Ruta c" });
    expect(choques.get("c")?.map((choque) => choque.conId)).toEqual(["a"]);
  });

  it("horas distintas y sin horario no chocan", () => {
    expect(choques.get("d")).toBeUndefined();
    expect(choques.get("f")).toBeUndefined();
  });

  it("estado: falta > choque > revisar > listo", () => {
    expect(estadoDelServicio(dia[4], choques.get("e"))).toBe("falta");
    expect(estadoDelServicio(dia[0], choques.get("a"))).toBe("choque");
    expect(estadoDelServicio(dia[2], choques.get("c"))).toBe("revisar"); // sólo un posible cruce
    expect(estadoDelServicio(s("x", "09:00", "l", "1", { review: "  ver  " }))).toBe("revisar");
    expect(estadoDelServicio(dia[3], choques.get("d"))).toBe("listo");
  });
});

describe("agrupar, filtrar y ocupación para el selector", () => {
  it("agrupa por horario en el orden del día", () => {
    const grupos = agruparPorTurno([s("2", "Jornada completa", null, null), s("1", "08:00", null, null), s("3", "7:30", null, null), s("4", "07:30", null, null), s("5", "Sin horario", null, null), s("6", "Tarde", null, null), s("7", "Según vuelo", null, null), s("8", "Mañana", null, null)]);
    expect(grupos.map((g) => g.turno.etiqueta)).toEqual(["Jornada completa", "Mañana", "07:30", "08:00", "Tarde", "Según vuelo", "Sin horario"]);
    expect(grupos[2].servicios.map((x) => x.id)).toEqual(["3", "4"]);
  });

  it("un filtro desconocido cae en «todos»", () => {
    expect(leerFiltroDelDia("x")).toBe("todos");
    expect(leerFiltroDelDia("falta")).toBe("falta");
  });

  it("marca ocupadas las naves y choferes de otro servicio del mismo horario, sin pisar un cruce más grave", () => {
    const dia = [s("a", "07:30", "ana", "153"), s("b", "07:30", "luis", "196"), s("c", "Mañana", "eva", "200"), s("d", "09:00", "ana", "400")];
    const { naves, choferes } = ocupacionParaServicio(dia[0], dia, {
      naves: { "200": { estado: "ocupada", detalle: "Servicio público 07:00" } },
      choferes: {}
    });
    expect(choferes.luis).toEqual({ estado: "ocupada", detalle: "Concesiones 07:30 · Ruta b" });
    expect(choferes.eva).toEqual({ estado: "posible", detalle: "Concesiones Mañana · Ruta c" });
    expect(naves["200"].detalle).toBe("Servicio público 07:00"); // lo más grave queda
    expect(choferes.ana).toBeUndefined(); // ella misma a otra hora no cuenta
    expect(naves["153"]).toBeUndefined();
  });

  it("nombre corto para los chips", () => {
    expect(nombreCorto("Ana María Pérez")).toBe("Ana P.");
    expect(nombreCorto("Luis")).toBe("Luis");
  });
});

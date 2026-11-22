import { describe, expect, it } from "vitest";
import {
  cadenaDeDias, cantidadDias, diaDelViaje, esDeVariosDias, estadoDelDia, etiquetaRango, etiquetaRangoLarga, leerRango,
  motivoParaNoUnir, navesQueNoCubren, ocupacionDelViaje, ultimoDia, vigenteEn, whereNoTerminado, whereSolapa, whereVigenteEn
} from "./rango";
import { dateOnly } from "./data";

const d = (iso: string) => new Date(iso + "T00:00:00Z");
const hoy = d("2026-11-20");
// Collipulli: salió el 19 y vuelve el lunes 23 (el ejemplo de Kike).
const collipulli = { serviceDate: d("2026-11-19"), endDate: d("2026-11-23") };

describe("viajes especiales de varios días", () => {
  it("un viaje sin vuelta, o con la vuelta el mismo día, es de un día", () => {
    expect(cantidadDias({ serviceDate: hoy })).toBe(1);
    expect(cantidadDias({ serviceDate: hoy, endDate: hoy })).toBe(1);
    expect(esDeVariosDias({ serviceDate: hoy, endDate: null })).toBe(false);
    expect(ultimoDia({ serviceDate: hoy, endDate: d("2026-11-18") })).toEqual(hoy);
    expect(cantidadDias(collipulli)).toBe(5);
  });

  it("ocupa cada día entre la salida y la vuelta, y dice qué día es", () => {
    expect(vigenteEn(collipulli, d("2026-11-18"))).toBe(false);
    expect(vigenteEn(collipulli, hoy)).toBe(true);
    expect(vigenteEn(collipulli, d("2026-11-24"))).toBe(false);
    expect(diaDelViaje(collipulli, hoy)).toEqual({ numero: 2, total: 5, primero: false, ultimo: false });
    expect(estadoDelDia(collipulli, d("2026-11-19"))).toBe("Sale · día 1 de 5");
    expect(estadoDelDia(collipulli, hoy)).toBe("En viaje · día 2 de 5");
    expect(estadoDelDia(collipulli, d("2026-11-23"))).toBe("Vuelve · día 5 de 5");
    expect(estadoDelDia({ serviceDate: hoy }, hoy)).toBeNull();
  });

  it("lee «sale el» y «vuelve el» del formulario", () => {
    expect(leerRango("2026-11-20", "", dateOnly)).toEqual({ serviceDate: hoy, endDate: null });
    expect(leerRango("2026-11-20", "2026-11-20", dateOnly)).toEqual({ serviceDate: hoy, endDate: null });
    expect(leerRango("2026-11-20", "2026-11-26", dateOnly)).toEqual({ serviceDate: hoy, endDate: d("2026-11-26") });
    expect(leerRango("2026-11-20", "2026-11-19", dateOnly)).toEqual({ error: "El viaje no puede volver antes del día en que sale." });
    expect(leerRango("2026-11-20", "2027-11-26", dateOnly)).toHaveProperty("error");
    expect(leerRango("", "2026-11-26", dateOnly)).toHaveProperty("error");
    expect(leerRango("2026-11-20", "26/11", dateOnly)).toHaveProperty("error");
  });

  it("arma los filtros por día, por período y por viajes sin terminar", () => {
    expect(whereVigenteEn(hoy)).toEqual({ serviceDate: { lte: hoy }, OR: [{ serviceDate: hoy }, { endDate: { gte: hoy } }] });
    expect(whereSolapa(hoy, d("2026-11-27"))).toEqual({ serviceDate: { lt: d("2026-11-27") }, OR: [{ serviceDate: { gte: hoy } }, { endDate: { gte: hoy } }] });
    expect(whereNoTerminado(hoy)).toEqual({ OR: [{ serviceDate: { gte: hoy } }, { endDate: { gte: hoy } }] });
  });

  it("escribe el rango corto y largo", () => {
    expect(etiquetaRango(collipulli, hoy)).toBe("jue 19 → lun 23 nov");
    expect(etiquetaRango({ serviceDate: d("2026-11-30"), endDate: d("2026-12-02") }, hoy)).toBe("lun 30 nov → mié 2 dic");
    expect(etiquetaRango({ serviceDate: d("2026-12-30"), endDate: d("2027-01-02") }, hoy)).toBe("mié 30 dic → sáb 2 ene 2027");
    expect(etiquetaRango({ serviceDate: hoy }, hoy)).toBe("vie 20 nov");
    expect(etiquetaRangoLarga(collipulli)).toBe("Del jueves, 19 de noviembre al lunes, 23 de noviembre");
    expect(etiquetaRangoLarga({ serviceDate: hoy })).toBe("viernes, 20 de noviembre");
  });

  it("propone la nave ocupada el bloque entero y avisa si una nave no cubre todos los días", () => {
    expect(ocupacionDelViaje("2026-11-19", "2026-11-23")).toEqual({ start: "2026-11-19T08:00", end: "2026-11-23T20:00" });
    expect(ocupacionDelViaje("2026-11-20", "")).toEqual({ start: "2026-11-20T08:00", end: "2026-11-20T20:00" });
    expect(ocupacionDelViaje("", "")).toEqual({ start: "", end: "" });
    const naves = [
      { vehicleId: "a", start: "2026-11-19T07:00", end: "2026-11-23T21:00" },
      { vehicleId: "b", start: "2026-11-19T07:00", end: "2026-11-19T21:00" },
      { vehicleId: "", start: "", end: "" }
    ];
    expect(navesQueNoCubren(naves, "2026-11-19", "2026-11-23").map((n) => n.vehicleId)).toEqual(["b"]);
    expect(navesQueNoCubren(naves, "2026-11-19", "")).toEqual([]);
  });

  it("encuentra el mismo viaje cargado un renglón por día", () => {
    const t = (id: string, fecha: string, extra: Partial<{ client: string; destinationSearch: string; status: string; endDate: Date }> = {}) =>
      ({ id, client: "Distrito", destinationSearch: "Collipulli (Chile)", serviceDate: d(fecha), endDate: null as Date | null, status: "PENDING", ...extra });
    const dias = [t("1", "2026-11-19"), t("2", "2026-11-20"), t("3", "2026-11-21"), t("4", "2026-11-23"), t("x", "2026-11-20", { destinationSearch: "Otro" })];
    expect(cadenaDeDias(dias[1], dias).map((v) => v.id)).toEqual(["1", "2", "3"]);
    expect(cadenaDeDias(dias[3], dias)).toEqual([]);
    expect(cadenaDeDias(t("5", "2026-11-22", { client: " distrito " }), dias).map((v) => v.id)).toEqual(["1", "2", "3", "5", "4"]);
    expect(cadenaDeDias(dias[1], [...dias, t("c", "2026-11-22", { status: "CANCELLED" })]).map((v) => v.id)).toEqual(["1", "2", "3"]);
    // Un viaje ya unido (19 al 21) se encadena con el que sale el 22.
    const unido = t("u", "2026-11-19", { endDate: d("2026-11-21") });
    expect(cadenaDeDias(unido, [unido, t("6", "2026-11-22")]).map((v) => v.id)).toEqual(["u", "6"]);
    // Dos renglones el mismo día no son una cadena.
    expect(cadenaDeDias(t("7", "2026-12-01"), [t("8", "2026-12-01")])).toEqual([]);
  });

  it("sólo une si los días siguientes no tienen nada propio", () => {
    const vacio = { totalCents: null, payments: [], assignments: 0, planillas: 0, client: "x" };
    expect(motivoParaNoUnir([vacio, { ...vacio, totalCents: 0 }])).toBeNull();
    expect(motivoParaNoUnir([vacio, { ...vacio, totalCents: 1500000 }])).toMatch(/importe/);
    expect(motivoParaNoUnir([{ ...vacio, payments: [{ amount: "1" }] }])).toMatch(/cobros/);
    expect(motivoParaNoUnir([{ ...vacio, assignments: 1 }])).toMatch(/naves/);
    expect(motivoParaNoUnir([{ ...vacio, planillas: 2 }])).toMatch(/planillas/);
  });
});

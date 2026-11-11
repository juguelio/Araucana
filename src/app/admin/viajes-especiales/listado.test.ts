import { describe, expect, it } from "vitest";
import { agruparPorMes, condicionVista, etiquetaFecha, etiquetaGrupo, etiquetaRelativa, etiquetaMes, mesesConViajes, rangoMes, tonoFila, vistaDe } from "./listado";

const dia = (iso: string) => new Date(iso + "T00:00:00Z");
const hoy = dia("2026-11-10");

describe("listado de viajes especiales", () => {
  it("cae a «próximos» con cualquier vista desconocida", () => {
    expect(vistaDe("")).toBe("proximos");
    expect(vistaDe("hack")).toBe("proximos");
    expect(vistaDe("sinNave")).toBe("sinNave");
  });

  it("las vistas que miran al futuro ordenan ascendente y las de historial descendente", () => {
    expect(condicionVista("proximos", hoy)).toEqual({ where: { serviceDate: { gte: hoy }, status: { not: "CANCELLED" } }, orden: "asc" });
    expect(condicionVista("semana", hoy).where).toEqual({ serviceDate: { gte: hoy, lt: dia("2026-11-17") } });
    expect(condicionVista("hoy", hoy).where).toEqual({ serviceDate: hoy });
    expect(condicionVista("sinNave", hoy).where).toEqual({ status: "CONFIRMED", serviceDate: { gte: hoy }, assignments: { none: {} } });
    expect(condicionVista("realizados", hoy).orden).toBe("desc");
    expect(condicionVista("todos", hoy)).toEqual({ where: {}, orden: "desc" });
  });

  it("formatea las fechas en castellano y suma el año sólo cuando no es el actual", () => {
    expect(etiquetaFecha(dia("2026-11-14"), hoy)).toBe("sáb 14 nov");
    expect(etiquetaFecha(dia("2027-03-18"), hoy)).toBe("jue 18 mar 2027");
    expect(etiquetaRelativa(hoy, hoy)).toBe("Hoy");
    expect(etiquetaRelativa(dia("2026-11-11"), hoy)).toBe("Mañana");
    expect(etiquetaRelativa(dia("2026-11-09"), hoy)).toBe("Ayer");
    expect(etiquetaRelativa(dia("2026-11-20"), hoy)).toBe("");
    expect(etiquetaGrupo(dia("2027-01-01"))).toBe("enero de 2027");
    expect(etiquetaMes("2026-11")).toBe("nov 2026");
  });

  it("cuenta los viajes por mes en orden cronológico y arma el rango del mes", () => {
    // Llega agrupado por la base: dos viajes el 14-nov, uno el 21-nov y uno el 1-dic.
    const meses = mesesConViajes([
      { serviceDate: dia("2026-12-01"), count: 1 },
      { serviceDate: dia("2026-11-14"), count: 2 },
      { serviceDate: dia("2027-01-03"), count: 1 }
    ]);
    expect(meses.map((m) => [m.clave, m.count])).toEqual([["2026-11", 2], ["2026-12", 1], ["2027-01", 1]]);
    expect(mesesConViajes([])).toEqual([]);
    expect(rangoMes("2026-11")).toEqual({ gte: dia("2026-11-01"), lt: dia("2026-12-01") });
    expect(rangoMes("2026-12")).toEqual({ gte: dia("2026-12-01"), lt: dia("2027-01-01") });
    expect(rangoMes("2026-13")).toBeNull();
    expect(rangoMes("x")).toBeNull();
  });

  it("marca lo que necesita acción: pendientes, confirmados sin nave y pendientes vencidos", () => {
    expect(tonoFila({ status: "PENDING", serviceDate: dia("2026-11-20") }, false, hoy)).toEqual({ tono: "atencion", label: "Pendiente" });
    expect(tonoFila({ status: "PENDING", serviceDate: dia("2026-11-01") }, false, hoy)).toEqual({ tono: "grave", label: "Pendiente vencido" });
    expect(tonoFila({ status: "CONFIRMED", serviceDate: dia("2026-11-20") }, false, hoy)).toEqual({ tono: "atencion", label: "Confirmado · sin nave" });
    expect(tonoFila({ status: "CONFIRMED", serviceDate: dia("2026-11-20") }, true, hoy)).toEqual({ tono: "curso", label: "Confirmado" });
    expect(tonoFila({ status: "CONFIRMED", serviceDate: dia("2026-10-20") }, false, hoy)).toEqual({ tono: "curso", label: "Confirmado" });
    expect(tonoFila({ status: "COMPLETED", serviceDate: dia("2026-10-20") }, false, hoy)).toEqual({ tono: "ok", label: "Realizado" });
    expect(tonoFila({ status: "CANCELLED", serviceDate: dia("2026-12-20") }, false, hoy)).toEqual({ tono: "normal", label: "Cancelado" });
  });

  it("agrupa por mes respetando el orden de llegada", () => {
    const grupos = agruparPorMes([{ serviceDate: dia("2026-11-10"), id: 1 }, { serviceDate: dia("2026-11-28"), id: 2 }, { serviceDate: dia("2026-12-02"), id: 3 }]);
    expect(grupos.map((g) => [g.clave, g.items.map((i) => i.id)])).toEqual([["2026-11", [1, 2]], ["2026-12", [3]]]);
  });
});

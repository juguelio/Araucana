import { describe, expect, it } from "vitest";
import {
  complianceLevel,
  complianceLabel,
  diasHasta,
  formatoFecha,
  peorVencimiento,
  resumenVencimientos,
  vencimientosDe,
  DIAS_ALERTA
} from "./compliance";

const hoy = new Date(2026, 10, 4); // 4-nov-2026, hora local

describe("vencimientos de la flota", () => {
  it("cuenta los días por fecha calendario, no por horas", () => {
    expect(diasHasta(new Date(2026, 10, 4, 23, 0), new Date(2026, 10, 4, 1, 0))).toBe(0);
    expect(diasHasta(new Date(2026, 10, 25), hoy)).toBe(21);
    expect(diasHasta(new Date(2025, 1, 28), hoy)).toBeLessThan(0);
    expect(diasHasta(null)).toBeNull();
  });

  it("clasifica vencido / próximo / al día contra el umbral de 90 días", () => {
    expect(complianceLevel(new Date(2026, 10, 1), hoy)).toBe("vencido");
    expect(complianceLevel(new Date(2026, 10, 4), hoy)).toBe("proximo"); // vence hoy
    expect(complianceLevel(new Date(2026, 10, 25), hoy)).toBe("proximo");
    expect(complianceLevel(new Date(2027, 5, 12), hoy)).toBe("ok");
    expect(DIAS_ALERTA).toBe(90);
  });

  it("lo escribe como lo lee la operación", () => {
    expect(complianceLabel(new Date(2026, 10, 1), hoy)).toBe("Vencido hace 3 días");
    expect(complianceLabel(new Date(2026, 10, 4), hoy)).toBe("Vence hoy");
    expect(complianceLabel(new Date(2026, 10, 25), hoy)).toBe("Vence en 21 días");
    expect(complianceLabel(new Date(2026, 10, 5), hoy)).toBe("Vence en 1 día");
    expect(complianceLabel(new Date(2027, 5, 12), hoy)).toBe("Al día");
    expect(complianceLabel(null, hoy)).toBe("Sin dato");
  });

  it("formatea la fecha en dd/mm/aaaa", () => {
    expect(formatoFecha(new Date(2026, 11, 17))).toBe("17/12/2026");
    expect(formatoFecha(new Date(2027, 0, 4))).toBe("04/01/2027");
    expect(formatoFecha(null)).toBe("—");
  });

  it("ordena los tres papeles y marca el más urgente", () => {
    const unidad = {
      technicalInspectionDueAt: new Date(2026, 11, 17),
      rtoDueAt: null,
      policyDueAt: new Date(2026, 10, 22)
    };
    const filas = vencimientosDe(unidad, hoy);
    expect(filas.map((f) => f.tipo)).toEqual(["Técnica", "RTO", "Póliza"]);
    expect(filas[1].level).toBeNull();
    const peor = peorVencimiento(unidad, hoy);
    expect(peor?.tipo).toBe("Póliza");
    expect(peor?.dias).toBe(18);
  });

  it("sin ningún vencimiento cargado no inventa un estado", () => {
    expect(peorVencimiento({}, hoy)).toBeNull();
  });

  it("resume cuántos papeles están vencidos y cuántos por vencer", () => {
    const resumen = resumenVencimientos(
      [
        { technicalInspectionDueAt: new Date(2025, 1, 28), policyDueAt: new Date(2026, 10, 22) },
        { technicalInspectionDueAt: new Date(2027, 2, 17), policyDueAt: new Date(2027, 0, 4) }
      ],
      hoy
    );
    expect(resumen).toEqual({ vencidos: 1, proximos: 2 });
  });
});

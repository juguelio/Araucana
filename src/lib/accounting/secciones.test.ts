import { describe, expect, it } from "vitest";
import { codigoCorto, lugarCorto, rutaCorta, seccionDeContabilidad } from "./secciones";

describe("seccionDeContabilidad", () => {
  it("por defecto, el resumen", () => {
    expect(seccionDeContabilidad({})).toBe("resumen");
    expect(seccionDeContabilidad({ month: "2026-11" })).toBe("resumen");
  });

  it("la que pide la URL, si existe", () => {
    expect(seccionDeContabilidad({ seccion: "sueldos" })).toBe("sueldos");
    expect(seccionDeContabilidad({ seccion: "egresos", qIngresos: "x" })).toBe("egresos");
    expect(seccionDeContabilidad({ seccion: "cualquiera" })).toBe("resumen");
  });

  it("los enlaces viejos abren la sección de su tabla", () => {
    expect(seccionDeContabilidad({ month: "2026-11", gasto: "combustible" })).toBe("egresos");
    expect(seccionDeContabilidad({ page: "2" })).toBe("egresos");
    expect(seccionDeContabilidad({ pageSueldos: "2" })).toBe("sueldos");
    expect(seccionDeContabilidad({ estadoSueldo: "pendiente" })).toBe("sueldos");
    expect(seccionDeContabilidad({ vista: "semana", semana: "2026-11-23" })).toBe("ingresos");
    expect(seccionDeContabilidad({ driverId: "d1" })).toBe("ingresos");
  });
});

describe("códigos y rutas cortas", () => {
  it("acorta el hash del código, deja los cortos", () => {
    expect(codigoCorto("ARC-2611-8765E2ECE39A6A8712F1546B8CE7FFB0")).toBe("ARC-2611-8765E2");
    expect(codigoCorto("ARC-DEMO12")).toBe("ARC-DEMO12");
    expect(codigoCorto("SINGUIONES1234567890")).toBe("SINGUIONES1234567890");
  });

  it("San Martín de los Andes pasa a San Martín y el aeropuerto se abrevia", () => {
    expect(lugarCorto("San Martín de los Andes")).toBe("San Martín");
    expect(lugarCorto("Junín de los Andes ")).toBe("Junín");
    expect(lugarCorto("Aeropuerto Chapelco")).toBe("Aerop. Chapelco");
    expect(rutaCorta("San Martín de los Andes", "Villa Traful")).toBe("San Martín → Villa Traful");
  });
});

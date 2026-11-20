import { describe, expect, it } from "vitest";
import { alertasDeNave, coincideBusqueda, entraEnPestana, estadoDeNave, leerPestanaDeFlota, papelEnPalabras, type NaveDelTablero } from "./estado-en-flota";

const hoy = new Date(2026, 10, 20, 9, 0);
const enDias = (dias: number) => new Date(2026, 10, 20 + dias, 12, 0);

const sprinter: NaveDelTablero = {
  isActive: true,
  kind: "CAMIONETA",
  asientos: 19,
  danios: [],
  serviciosHoy: 0,
  technicalInspectionDueAt: enDias(200),
  rtoDueAt: enDias(150),
  policyDueAt: enDias(120)
};

describe("estadoDeNave: ¿puede salir? (tablero del 20-nov)", () => {
  it("sin nada pendiente ni servicios hoy está disponible", () => {
    expect(estadoDeNave(sprinter)).toMatchObject({ clave: "disponible", etiqueta: "Disponible", tono: "ok" });
  });

  it("con servicios hoy dice cuántos", () => {
    expect(estadoDeNave({ ...sprinter, serviciosHoy: 3 })).toMatchObject({ clave: "en-servicio", etiqueta: "Hoy: 3 servicios" });
    expect(estadoDeNave({ ...sprinter, serviciosHoy: 1 }).etiqueta).toBe("Hoy: 1 servicio");
  });

  it("un daño en reparación la saca de servicio aunque tenga salidas", () => {
    expect(estadoDeNave({ ...sprinter, serviciosHoy: 2, danios: [{ status: "EN_REPARACION", severity: "MODERADO" }] }).clave).toBe("en-reparacion");
  });

  it("un daño grave sin reparar manda sobre todo lo demás", () => {
    const nave = { ...sprinter, danios: [{ status: "EN_REPARACION", severity: "LEVE" }, { status: "PENDIENTE", severity: "GRAVE" }] };
    expect(estadoDeNave(nave)).toMatchObject({ clave: "danio-grave", tono: "grave" });
  });

  it("los daños reparados no cuentan", () => {
    expect(estadoDeNave({ ...sprinter, danios: [{ status: "REPARADO", severity: "GRAVE" }] }).clave).toBe("disponible");
  });

  it("inactiva y utilitario no se asignan", () => {
    expect(estadoDeNave({ ...sprinter, isActive: false }).clave).toBe("inactiva");
    expect(estadoDeNave({ ...sprinter, kind: "UTILITARIO" }).clave).toBe("uso-interno");
  });
});

describe("alertasDeNave: una sola cosa para resolver", () => {
  it("con papeles lejos y capacidad cargada no hay alerta", () => {
    expect(alertasDeNave(sprinter, hoy)).toEqual({ principal: null, otras: 0 });
  });

  it("un papel vencido es la alerta principal, en palabras", () => {
    const { principal, otras } = alertasDeNave({ ...sprinter, technicalInspectionDueAt: enDias(-3), asientos: 0 }, hoy);
    expect(principal).toEqual({ etiqueta: "Técnica vencida hace 3 días", tono: "grave" });
    expect(otras).toBe(1); // la capacidad sin cargar queda contada
  });

  it("un papel que vence en 30 días o menos avisa; a 31 todavía no", () => {
    expect(alertasDeNave({ ...sprinter, policyDueAt: enDias(12) }, hoy).principal).toEqual({ etiqueta: "Póliza vence en 12 días", tono: "atencion" });
    expect(alertasDeNave({ ...sprinter, policyDueAt: enDias(31) }, hoy).principal).toBeNull();
  });

  it("sin fechas de papeles lo dice (no «al día»)", () => {
    const sinFechas = { ...sprinter, technicalInspectionDueAt: null, rtoDueAt: null, policyDueAt: null };
    expect(alertasDeNave(sinFechas, hoy).principal).toEqual({ etiqueta: "Sin fechas de papeles", tono: "normal" });
  });

  it("los daños pendientes no graves se cuentan; el grave ya es el estado", () => {
    const nave = { ...sprinter, danios: [{ status: "PENDIENTE", severity: "LEVE" }, { status: "PENDIENTE", severity: "GRAVE" }] };
    expect(alertasDeNave(nave, hoy).principal?.etiqueta).toBe("1 daño pendiente");
  });

  it("un utilitario no pide capacidad, y una inactiva no alerta", () => {
    expect(alertasDeNave({ ...sprinter, kind: "UTILITARIO", asientos: 0 }, hoy).principal).toBeNull();
    expect(alertasDeNave({ ...sprinter, isActive: false, technicalInspectionDueAt: enDias(-90) }, hoy).principal).toBeNull();
  });

  it("papelEnPalabras: hoy, un día, varios", () => {
    expect(papelEnPalabras("RTO", 0)).toBe("RTO vence hoy");
    expect(papelEnPalabras("RTO", 1)).toBe("RTO vence en 1 día");
    expect(papelEnPalabras("Póliza", -1)).toBe("Póliza vencida hace 1 día");
  });
});

describe("pestañas y búsqueda del tablero", () => {
  const disponible = estadoDeNave(sprinter);
  const enTaller = estadoDeNave({ ...sprinter, danios: [{ status: "EN_REPARACION", severity: "MODERADO" }] });

  it("cada pestaña junta lo suyo", () => {
    expect(entraEnPestana("activas", { isActive: true }, disponible, null)).toBe(true);
    expect(entraEnPestana("alertas", { isActive: true }, disponible, null)).toBe(false);
    expect(entraEnPestana("alertas", { isActive: true }, disponible, { etiqueta: "x", tono: "atencion" })).toBe(true);
    expect(entraEnPestana("alertas", { isActive: true }, disponible, { etiqueta: "Sin fechas de papeles", tono: "normal" })).toBe(false);
    expect(entraEnPestana("taller", { isActive: true }, enTaller, null)).toBe(true);
    expect(entraEnPestana("publico", { isActive: true, publicTransport: true }, disponible, null)).toBe(true);
    expect(entraEnPestana("inactivas", { isActive: false }, disponible, null)).toBe(true);
    expect(entraEnPestana("activas", { isActive: false }, disponible, null)).toBe(false);
  });

  it("una vista desconocida cae en «activas»", () => {
    expect(leerPestanaDeFlota("cualquiera")).toBe("activas");
    expect(leerPestanaDeFlota("taller")).toBe("taller");
  });

  it("busca por interno, patente (con o sin espacios) y modelo, sin tildes", () => {
    const nave = { internalNumber: "1913", licensePlate: "AA 191 KK", name: "Sprinter 1913", brand: "Mercedes-Benz", model: "Sprinter 515" };
    expect(coincideBusqueda(nave, "1913")).toBe(true);
    expect(coincideBusqueda(nave, "aa191kk")).toBe(true);
    expect(coincideBusqueda(nave, "mercedes sprinter")).toBe(false);
    expect(coincideBusqueda(nave, "sprinter 515")).toBe(true);
    expect(coincideBusqueda({ ...nave, model: "Tránsit" }, "transit")).toBe(true);
    expect(coincideBusqueda(nave, "Iveco")).toBe(false);
  });
});

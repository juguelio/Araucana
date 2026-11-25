import { describe, expect, it } from "vitest";
import { permiteUbicacion } from "./gps-asignado";
import { diferenciasDeEmbarque, resumenDeMarcas, ultimasMarcas, type Marca } from "./marcas";
import { firmarServicio, leerComprobante } from "./comprobante";
import type { ServicioApp } from "./jornada-app-types";

const fecha = "2026-11-25";
const ahora = new Date(fecha + "T14:00:00Z");
const servicio: ServicioApp = {
  id: "s1", tipo: "Servicio Público", fecha, salida: fecha + "T13:40:00Z", fin: fecha + "T15:00:00Z",
  nave: { id: "v1", nombre: "Combi", interno: null, patente: null }, titulo: "Salida", origen: "SMA",
  paradas: [], indicaciones: [], filas: [{ id: "f", nombre: "Ana", cantidad: 3, telefono: null, detalle: "" }], compartida: true
};
function marca(data: Partial<Marca>): Marca {
  return { id: "m1", driverId: "d", servicioId: "s1", fecha, vehicleId: "v1", tipo: "embarque", filaId: "f",
    at: ahora, receivedAt: ahora, estado: "guardada", cantidad: 2, prevista: 3, motivo: null,
    servicio: "Salida", nave: "Combi", fila: "Ana", ...data };
}
describe("registro de la hoja del chofer", () => {
  it("conserva la corrección más reciente, aunque llegue primero, y detecta exceso entre naves", () => {
    const correccion = marca({ id: "m2", cantidad: 1, at: new Date(+ahora + 5), receivedAt: new Date(+ahora + 8) });
    const anterior = marca({ receivedAt: new Date(+ahora + 20) });
    const otra = marca({ id: "m3", vehicleId: "v2", cantidad: 3 });
    const revision = marca({ id: "m4", estado: "revision", cantidad: 0 });
    const vigentes = ultimasMarcas([correccion, anterior, otra, revision]);
    expect(vigentes).toHaveLength(3);
    expect(vigentes).not.toContain(anterior);
    expect(diferenciasDeEmbarque(vigentes).size).toBe(1);
    expect(resumenDeMarcas(vigentes)).toContain("Marcas para revisar · 1");
    expect(resumenDeMarcas([])).toBe("Sin marcas informadas");
    expect(diferenciasDeEmbarque(ultimasMarcas([correccion, marca({ ...otra, cantidad: 2 })])).size).toBe(0);
  });

  it("liga el comprobante a la hoja, la nave, sus filas y la identidad", () => {
    const secret = process.env.AUTH_JWT_SECRET;
    try {
      process.env.AUTH_JWT_SECRET = "test-local-de-comprobantes-para-chofer";
      const token = firmarServicio("chofer", servicio);
      expect(leerComprobante(token, "chofer")).toMatchObject({ servicioId: "s1", vehicleId: "v1", filas: [{ id: "f", cantidad: 3 }] });
      expect(leerComprobante(token, "otro")).toBeNull();
      expect(leerComprobante("x" + token, "chofer")).toBeNull();
    } finally {
      if (secret === undefined) delete process.env.AUTH_JWT_SECRET;
      else process.env.AUTH_JWT_SECRET = secret;
    }
  });

  it("autoriza GPS exclusivamente durante el intervalo y pausa al superponerse distintas naves", () => {
    const superpuesta = { ...servicio, id: "s2", nave: { ...servicio.nave!, id: "v2" } };
    expect(permiteUbicacion([servicio], "v1", "s1", false, ahora)).toBe(true);
    expect(permiteUbicacion([servicio], "v1", undefined, false, ahora)).toBe(true);
    expect(permiteUbicacion([servicio], "v1", "s2", false, ahora)).toBe(false);
    expect(permiteUbicacion([servicio, superpuesta], "v1", "s1", false, ahora)).toBe(false);
    expect(permiteUbicacion([servicio], "v1", "s1", false, new Date(servicio.fin!))).toBe(false);
  });
  it("sólo permite el modo manual para una hoja de hoy sin intervalo completo y con nave", () => {
    const manual = { ...servicio, id: "manual", fin: null };
    expect(permiteUbicacion([manual], "v1", "manual", true, ahora)).toBe(true);
    expect(permiteUbicacion([manual], "v1", "manual", false, ahora)).toBe(false);
    expect(permiteUbicacion([manual], "v1", "manual", true, new Date(fecha + "T13:00:00Z"))).toBe(false);
    expect(permiteUbicacion([{ ...manual, fecha: "2026-11-26" }], "v1", "manual", true, ahora)).toBe(false);
    expect(permiteUbicacion([{ ...manual, nave: null }], "v1", "manual", true, ahora)).toBe(false);
  });
});

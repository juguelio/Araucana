import { describe, expect, it } from "vitest";
import { mensajeDeRefresco } from "./sync-summary";
import type { SyncSummary } from "./sync";

const resumen = (p: Partial<SyncSummary> = {}): SyncSummary => ({
  corridas: 6,
  creados: 1,
  actualizados: 2,
  eventos: 0,
  proyectados: 10,
  desdeTablero: 1,
  limpiados: 0,
  proyectadosLimpiados: 0,
  jetSmartUnificados: 0,
  repetidosConReservas: [],
  errores: [],
  ...p
});

describe("mensajeDeRefresco", () => {
  it("sin novedades informa sólo el resumen", () => {
    expect(mensajeDeRefresco(resumen())).toBe(
      "Vuelos actualizados: 1 nuevos, 2 revisados (1 desde el tablero del aeropuerto), 0 imprevisto(s)."
    );
  });

  it("informa los JetSMART unificados", () => {
    expect(mensajeDeRefresco(resumen({ jetSmartUnificados: 2 }))).toContain("2 vuelo(s) de JetSMART repetidos se unificaron.");
  });

  it("con un proveedor caído NO esconde los duplicados que hay que resolver a mano", () => {
    const mensaje = mensajeDeRefresco(
      resumen({ errores: ["Falta la clave de AirLabs"], repetidosConReservas: ["JA3184 DEPARTURE 2026-11-14 (2 filas con reservas)"] })
    );
    expect(mensaje).toContain("No se pudo traer los vuelos (Falta la clave de AirLabs)");
    expect(mensaje).toContain("Quedan repetidos con reservas en las dos filas, revisalos a mano");
    expect(mensaje).toContain("JA3184 DEPARTURE 2026-11-14");
    expect(mensaje.indexOf("repetidos con reservas")).toBeLessThan(mensaje.indexOf("No se pudo traer"));
  });

  it("junta unificación, duplicados protegidos y modo degradado", () => {
    const mensaje = mensajeDeRefresco(
      resumen({ jetSmartUnificados: 3, errores: ["tablero ARRIVAL: timeout"], repetidosConReservas: ["JA3181 ARRIVAL 2026-11-13"] })
    );
    expect(mensaje).toContain("3 vuelo(s) de JetSMART repetidos se unificaron.");
    expect(mensaje).toContain("JA3181 ARRIVAL 2026-11-13");
    expect(mensaje).toContain("tablero ARRIVAL: timeout");
  });
});

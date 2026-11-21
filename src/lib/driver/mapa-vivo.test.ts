import { describe, expect, it } from "vitest";
import type { NaveEnVivo } from "./en-vivo";
import { asignarColores, horaSenal, puedeAnimar, unidadesActuales } from "./mapa-vivo";
const ahora = Date.parse("2026-11-20T20:00:00Z");
const nave: NaveEnVivo = { vehicleId: "v1", driverId: "d1", driverName: "Juan", vehicleName: "Unidad",
  internalNumber: "08", licensePlate: null, latitude: -40.15, longitude: -71.35,
  recordedAt: new Date(ahora).toISOString(), minutosDesdeLaSenal: 0, estado: "en-movimiento",
  speedKmh: 30, heading: null, accuracy: 8, isStopped: false, stoppedDurationSeconds: 0 };
const nueva = { ...nave, latitude: -40.149, recordedAt: new Date(ahora + 30_000).toISOString() };
describe("mapa vivo", () => {
  it("envejece aun sin respuestas del servidor", () => {
    expect(unidadesActuales([nave], ahora + 11 * 60_000, 10)[0].estado).toBe("sin-senal");
    expect(unidadesActuales([nave], ahora + 10 * 60_000, 10)[0].estado).toBe("en-movimiento");
  });
  it("una unidad conserva el reporte más reciente, no el último del array", () => {
    const datos = [nueva, { ...nave, driverId: "viejo" }];
    expect(unidadesActuales(datos, ahora + 30_000, 10)).toHaveLength(1);
    expect(unidadesActuales(datos, ahora + 30_000, 10)[0].driverId).toBe("d1");
  });
  it("no dibuja coordenadas o fechas inválidas", () => {
    expect(unidadesActuales([{ ...nave, latitude: NaN }, { ...nave, recordedAt: "?" }, { ...nave, longitude: 190 }], ahora, 10)).toEqual([]);
  });
  it("anima sólo movimiento plausible entre dos reportes", () => expect(puedeAnimar(nave, nueva, false)).toBe(true));
  it("no vuelve a animar el mismo reporte ni uno anterior", () => {
    expect(puedeAnimar(nueva, nueva, false)).toBe(false);
    expect(puedeAnimar(nueva, nave, false)).toBe(false);
  });
  it("no anima sin señal, detención, relevo ni movimiento reducido", () => {
    for (const cambio of [{ estado: "sin-senal" as const }, { estado: "detenida" as const }, { driverId: "d2" }, { vehicleId: "v2" }]) {
      expect(puedeAnimar(nave, { ...nueva, ...cambio }, false)).toBe(false);
    }
    expect(puedeAnimar(nave, nueva, true)).toBe(false);
  });
  it("no anima saltos ni intervalos sin cobertura", () => {
    expect(puedeAnimar(nave, { ...nueva, latitude: -39 }, false)).toBe(false);
    expect(puedeAnimar(nave, { ...nueva, recordedAt: new Date(ahora + 180_000).toISOString() }, false)).toBe(false);
  });
  it("hora de señal real no depende del reloj de render", () => expect(horaSenal(nave.recordedAt)).toContain("17:00"));
  it("dos choferes nunca comparten color, aunque el hash los juntara", () => {
    const colores = asignarColores(["cmwlhziiz0000jgos0zv8ltwg", "cmwlhzije0001jgos4rcdz3lu"]);
    expect(new Set(colores.values()).size).toBe(2);
  });
  it("para el mismo conjunto de choferes el reparto es el mismo", () => {
    const a = asignarColores(["x", "y", "z"]);
    const b = asignarColores(["z", "x", "y"]);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });
  it("con más choferes que colores, reparte toda la paleta antes de repetir", () => {
    const colores = asignarColores(Array.from({ length: 8 }, (_, i) => `chofer-${i}`));
    expect(new Set(colores.values()).size).toBe(8);
  });
});

import { describe, expect, it } from "vitest";
import type { NaveEnVivo } from "./en-vivo";
import { datosDelPlan, seguimiento, type PlanMapa } from "./plan-mapa";

const ahora = Date.parse("2026-11-25T13:00:00Z");
const plan: PlanMapa = {
  id: "salida", titulo: "SMA → Traful", salida: ahora - 60000, fin: ahora + 60000, detalle: "Ruta 40",
  unidades: [{ id: "v", nombre: "Interno 26", chofer: "Ana" }],
  tramos: [{ vial: true, puntos: [[-40, -71], [-40, -71.1]] }], completo: true
};
const nave: NaveEnVivo = {
  vehicleId: "v", vehicleName: "Combi", internalNumber: "26", licensePlate: null, driverId: "d", driverName: "Ana",
  latitude: -40, longitude: -71.05, recordedAt: new Date(ahora).toISOString(), minutosDesdeLaSenal: 0,
  estado: "en-movimiento", accuracy: 12, speedKmh: 60, heading: null, isStopped: false, stoppedDurationSeconds: 0
};
const lejos = { ...nave, latitude: -40.02 };

describe("seguimiento de la salida asignada", () => {
  it("muestra el horario argentino y la tripulación", () => {
    expect(datosDelPlan(plan)).toEqual(["SMA → Traful", "Salida 09:59 · Ruta 40", "Interno 26 · Ana"]);
  });
  it("compara con el segmento de carretera entre dos vértices", () => {
    expect(seguimiento(nave, [plan], ahora).texto).toContain("En recorrido");
    expect(seguimiento(lejos, [plan], ahora).alerta).toBe(true);
  });
  it("descarta antiguas, imprecisas, fuera del horario y asignaciones superpuestas", () => {
    expect(seguimiento({ ...lejos, estado: "sin-senal" }, [plan], ahora).alerta).toBe(false);
    expect(seguimiento({ ...lejos, recordedAt: new Date(ahora - 90000).toISOString() }, [plan], ahora).alerta).toBe(false);
    expect(seguimiento({ ...lejos, accuracy: 800 }, [plan], ahora).alerta).toBe(false);
    expect(seguimiento(lejos, [plan, { ...plan, id: "otra" }], ahora).alerta).toBe(false);
    expect(seguimiento(lejos, [plan], plan.fin!).alerta).toBe(false);
    expect(seguimiento({ ...lejos, vehicleId: "otra" }, [plan], ahora).alerta).toBe(false);
  });
  it("respeta el margen del teléfono y el espacio para circular entre paradas", () => {
    expect(seguimiento({ ...nave, latitude: -40.005, accuracy: 120 }, [plan], ahora).alerta).toBe(false);
    const orientativo = { ...plan, tramos: [{ ...plan.tramos[0], vial: false }] };
    expect(seguimiento(lejos, [orientativo], ahora).texto).toContain("Zona de paradas");
    expect(seguimiento(lejos, [{ ...plan, completo: false }], ahora).alerta).toBe(false);
  });
});

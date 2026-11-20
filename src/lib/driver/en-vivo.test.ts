import { describe, expect, it } from "vitest";
import {
  VENTANA_SENAL_MINUTOS,
  armarFlotaEnVivo,
  estadoDeNaveEnVivo,
  minutosDesdeLaSenal,
  type UbicacionCruda
} from "./en-vivo";

const AHORA = new Date("2026-11-20T21:30:00.000Z");

function ubicacion(overrides: Partial<UbicacionCruda> = {}): UbicacionCruda {
  return {
    driverId: "chofer-1",
    vehicleId: "nave-1",
    latitude: -40.1579,
    longitude: -71.3534,
    accuracy: 12,
    heading: 180,
    speed: 8.4,
    reportedSpeedKmh: 30.24,
    inferredSpeedKmh: 28.1,
    isStopped: false,
    stoppedDurationSeconds: 0,
    recordedAt: new Date(AHORA.getTime() - 60_000),
    driver: { name: "Quique" },
    vehicle: { name: "Sprinter 1", internalNumber: "14", licensePlate: "AF123BC" },
    ...overrides
  };
}

describe("mapa en vivo de la flota", () => {
  it("una posición reciente y en movimiento cuenta como viva", () => {
    const flota = armarFlotaEnVivo([ubicacion()], [], AHORA);

    expect(flota.naves).toHaveLength(1);
    expect(flota.naves[0].estado).toBe("en-movimiento");
    expect(flota.naves[0].minutosDesdeLaSenal).toBe(1);
    expect(flota.ventanaMinutos).toBe(VENTANA_SENAL_MINUTOS);
    expect(flota.actualizadoEn).toBe(AHORA.toISOString());
  });

  it("una nave detenida con señal viva se muestra detenida, no sin señal", () => {
    expect(estadoDeNaveEnVivo({ minutos: 2, isStopped: true })).toBe("detenida");
  });

  it("justo en el límite de la ventana todavía tiene señal", () => {
    const flota = armarFlotaEnVivo([ubicacion({ recordedAt: new Date(AHORA.getTime() - VENTANA_SENAL_MINUTOS * 60_000) })], [], AHORA);

    expect(flota.naves[0].minutosDesdeLaSenal).toBe(VENTANA_SENAL_MINUTOS);
    expect(flota.naves[0].estado).toBe("en-movimiento");
  });

  it("pasada la ventana la nave queda en el mapa como «sin señal» con su última posición", () => {
    const flota = armarFlotaEnVivo(
      [ubicacion({ recordedAt: new Date(AHORA.getTime() - 42 * 60_000), isStopped: true })],
      [],
      AHORA
    );

    expect(flota.naves).toHaveLength(1);
    expect(flota.naves[0].estado).toBe("sin-senal");
    expect(flota.naves[0].minutosDesdeLaSenal).toBe(42);
    expect(flota.naves[0].latitude).toBe(-40.1579);
  });

  it("ordena primero las que reportan y deja las sin señal al final", () => {
    const flota = armarFlotaEnVivo(
      [
        ubicacion({ vehicleId: "nave-vieja", recordedAt: new Date(AHORA.getTime() - 90 * 60_000), vehicle: { name: "Sprinter 1", internalNumber: "9", licensePlate: null } }),
        ubicacion({ vehicleId: "nave-2", driverId: "chofer-2", vehicle: { name: "Sprinter 2", internalNumber: "3", licensePlate: null } }),
        ubicacion({ vehicleId: "nave-3", driverId: "chofer-3", isStopped: true, vehicle: { name: "Sprinter 3", internalNumber: "7", licensePlate: null } })
      ],
      [],
      AHORA
    );

    expect(flota.naves.map((nave) => nave.internalNumber)).toEqual(["3", "7", "9"]);
    expect(flota.naves.map((nave) => nave.estado)).toEqual(["en-movimiento", "detenida", "sin-senal"]);
  });

  it("un chofer activo que nunca mandó posición figura como sin ubicación, y el que sí mandó no", () => {
    const flota = armarFlotaEnVivo(
      [ubicacion({ driverId: "chofer-1" })],
      [
        { id: "chofer-1", name: "Quique" },
        { id: "chofer-2", name: "  " },
        { id: "chofer-3", name: "Ana" }
      ],
      AHORA
    );

    expect(flota.sinUbicacion).toEqual([
      { driverId: "chofer-2", driverName: null },
      { driverId: "chofer-3", driverName: "Ana" }
    ]);
  });

  it("la velocidad sale de la telemetría y cae al dato inferido si el teléfono no la reporta", () => {
    const [reportada] = armarFlotaEnVivo([ubicacion()], [], AHORA).naves;
    const [inferida] = armarFlotaEnVivo([ubicacion({ reportedSpeedKmh: null })], [], AHORA).naves;
    const [sinDato] = armarFlotaEnVivo(
      [ubicacion({ reportedSpeedKmh: null, inferredSpeedKmh: null, speed: null })],
      [],
      AHORA
    ).naves;

    expect(reportada.speedKmh).toBe(30.2);
    expect(inferida.speedKmh).toBe(28.1);
    expect(sinDato.speedKmh).toBeNull();
  });

  it("los minutos nunca son negativos si el teléfono manda una hora adelantada", () => {
    expect(minutosDesdeLaSenal(new Date(AHORA.getTime() + 5 * 60_000), AHORA)).toBe(0);
  });
});

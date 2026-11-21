import { describe, expect, it } from "vitest";
import {
  alertasDeJornadas,
  armarJornadas,
  fechaLocal,
  minutosAHoras,
  rangoDelDia,
  resumirDia,
  type MuestraDeJornada
} from "./jornada";

const BASE = Date.UTC(2026, 10, 20, 12, 0, 0); // 2026-11-20 12:00 UTC = 09:00 en Argentina

function muestra(extra: Partial<MuestraDeJornada> & { minutos: number }): MuestraDeJornada {
  const { minutos, ...resto } = extra;
  return {
    driverId: "chofer-1",
    driverName: "Juan Muñoz",
    vehicleId: "veh-1",
    vehicleName: "Sprinter",
    internalNumber: "AR-08",
    latitude: -40.157,
    longitude: -71.31,
    recordedAt: new Date(BASE + minutos * 60_000),
    isStopped: false,
    stoppedDurationSeconds: 0,
    reportedSpeedKmh: 40,
    inferredSpeedKmh: 40,
    ...resto
  };
}

describe("armarJornadas", () => {
  it("suma kilómetros entre reportes separados y descarta el temblor del GPS quieto", () => {
    const jornada = armarJornadas([
      muestra({ minutos: 0, latitude: -40.157, longitude: -71.31 }),
      // 10 m: ruido, no suma
      muestra({ minutos: 1, latitude: -40.15709, longitude: -71.31 }),
      // ~1,1 km al sur
      muestra({ minutos: 3, latitude: -40.167, longitude: -71.31 })
    ]);

    expect(jornada).toHaveLength(1);
    expect(jornada[0].km).toBeGreaterThan(1);
    expect(jornada[0].km).toBeLessThan(1.3);
  });

  it("no suma un salto imposible (GPS perdido) al kilometraje facturable", () => {
    const jornada = armarJornadas([
      muestra({ minutos: 0 }),
      muestra({ minutos: 1, latitude: -40.257, longitude: -71.45 }) // ~15 km en 1 minuto
    ]);

    expect(jornada[0].km).toBe(0);
  });

  it("separa el tiempo en movimiento del detenido y arma las paradas de 5 minutos o más", () => {
    const jornada = armarJornadas([
      muestra({ minutos: 0 }),
      muestra({ minutos: 10, latitude: -40.16, longitude: -71.31 }),
      // parada de 30 minutos en el centro
      muestra({ minutos: 20, latitude: -40.16002, longitude: -71.31, isStopped: true, reportedSpeedKmh: 0 }),
      muestra({ minutos: 30, latitude: -40.16002, longitude: -71.31, isStopped: true, reportedSpeedKmh: 0 }),
      muestra({ minutos: 50, latitude: -40.16002, longitude: -71.31, isStopped: true, reportedSpeedKmh: 0 }),
      muestra({ minutos: 60, latitude: -40.17, longitude: -71.31 })
    ]);

    expect(jornada[0].minutosEnMovimiento).toBe(20);
    expect(jornada[0].minutosDetenido).toBe(40);
    expect(jornada[0].paradas).toHaveLength(1);
    expect(jornada[0].paradas[0].minutos).toBe(30);
  });

  it("no cuenta como parada un reporte único detenido", () => {
    const jornada = armarJornadas([
      muestra({ minutos: 0 }),
      muestra({ minutos: 5, latitude: -40.16, longitude: -71.31 }),
      muestra({ minutos: 6, latitude: -40.16001, longitude: -71.31, isStopped: true }),
      muestra({ minutos: 20, latitude: -40.17, longitude: -71.31 })
    ]);

    expect(jornada[0].paradas).toHaveLength(0);
  });

  it("agrupa por chofer y unidad: dos choferes en la misma nave son dos jornadas", () => {
    const jornadas = armarJornadas([
      muestra({ minutos: 0 }),
      muestra({ minutos: 5, latitude: -40.16 }),
      muestra({ minutos: 0, driverId: "chofer-2", driverName: "María Quiroga", latitude: -40.15 })
    ]);

    expect(jornadas).toHaveLength(2);
    expect(jornadas.map((j) => j.driverName)).toEqual(["Juan Muñoz", "María Quiroga"]);
  });

  it("ignora velocidades imposibles al buscar la máxima y guarda cuándo y dónde ocurrió", () => {
    const jornada = armarJornadas([
      muestra({ minutos: 0, reportedSpeedKmh: 55 }),
      muestra({ minutos: 1, reportedSpeedKmh: 999 }),
      muestra({ minutos: 2, latitude: -40.162, longitude: -71.318, reportedSpeedKmh: 70 })
    ]);

    expect(jornada[0].velocidadMaximaKmh).toBe(70);
    expect(jornada[0].velocidadMaximaPunto).toEqual([-40.162, -71.318]);
    expect(jornada[0].velocidadMaximaEn).toBe(new Date(BASE + 2 * 60_000).toISOString());
  });

  it("cuenta los cortes de señal del día sin sumarlos como movimiento", () => {
    const jornada = armarJornadas([
      muestra({ minutos: 0 }),
      muestra({ minutos: 40, latitude: -40.16 }), // hueco de 40 min
      muestra({ minutos: 50, latitude: -40.17 })
    ]);

    expect(jornada[0].huecos).toBe(1);
    expect(jornada[0].minutosEnMovimiento).toBe(10);
  });
});

describe("alertasDeJornadas", () => {
  const ahora = new Date(BASE + 120 * 60_000);

  it("avisa cuando la unidad dejó de reportar hoy y formatea en horas y minutos con coordenadas", () => {
    const jornadas = armarJornadas([muestra({ minutos: 0 }), muestra({ minutos: 10, latitude: -40.16, longitude: -71.32 })]);
    const alertas = alertasDeJornadas(jornadas, { ahora });

    expect(alertas[0].tipo).toBe("sin-senal");
    expect(alertas[0].texto).toContain("09:10");
    expect(alertas[0].texto).toContain("1 h 50 min");
    expect(alertas[0].latitude).toBe(-40.16);
    expect(alertas[0].longitude).toBe(-71.32);
  });

  it("no emite alerta de sin-señal relativa a ahora cuando se consulta un día pasado (esHoy=false)", () => {
    const jornadas = armarJornadas([muestra({ minutos: 0 }), muestra({ minutos: 10, latitude: -40.16 })]);
    const alertas = alertasDeJornadas(jornadas, { ahora, esHoy: false });

    expect(alertas.filter((a) => a.tipo === "sin-senal")).toHaveLength(0);
  });

  it("marca exceso con la hora exacta, coordenadas y el límite aplicado a la vista", () => {
    const jornadas = armarJornadas([
      muestra({ minutos: 100, latitude: -40.165, longitude: -71.325, reportedSpeedKmh: 95 }),
      muestra({ minutos: 110, latitude: -40.16, reportedSpeedKmh: 65 })
    ]);
    const alertas = alertasDeJornadas(jornadas, { ahora, limiteVelocidadKmh: 80 });

    const exceso = alertas.find((a) => a.tipo === "exceso-de-velocidad");
    expect(exceso?.texto).toContain("95 km/h");
    expect(exceso?.texto).toContain("10:40");
    expect(exceso?.texto).toContain("límite 80");
    expect(exceso?.latitude).toBe(-40.165);
    expect(exceso?.longitude).toBe(-71.325);
  });

  it("no alerta una unidad que viene reportando bien y dentro del límite", () => {
    const jornadas = armarJornadas([
      muestra({ minutos: 110, reportedSpeedKmh: 45 }),
      muestra({ minutos: 118, latitude: -40.16, reportedSpeedKmh: 45 })
    ]);

    expect(alertasDeJornadas(jornadas, { ahora })).toHaveLength(0);
  });
});

describe("resumirDia", () => {
  it("suma los totales de todas las unidades", () => {
    const resumen = resumirDia([
      muestra({ minutos: 0 }),
      muestra({ minutos: 10, latitude: -40.17 }),
      muestra({ minutos: 0, driverId: "chofer-2", vehicleId: "veh-2", latitude: -40.15 }),
      muestra({ minutos: 10, driverId: "chofer-2", vehicleId: "veh-2", latitude: -40.16 })
    ]);

    expect(resumen.totales.unidades).toBe(2);
    expect(resumen.totales.km).toBeGreaterThan(2);
    expect(resumen.totales.muestras).toBe(4);
  });
});

describe("rangoDelDia", () => {
  it("arma el día calendario argentino en UTC (empieza a las 03:00 UTC)", () => {
    const rango = rangoDelDia("2026-11-20");
    expect(rango?.desde.toISOString()).toBe("2026-11-20T03:00:00.000Z");
    expect(rango?.hasta.toISOString()).toBe("2026-11-21T03:00:00.000Z");
  });

  it("devuelve null con una fecha que no es YYYY-MM-DD", () => {
    expect(rangoDelDia("20/11/2026")).toBeNull();
    expect(rangoDelDia("2026-13-01")).toBeNull();
  });

  it("fechaLocal devuelve el día argentino, no el UTC", () => {
    // 2026-11-21 01:00 UTC = 2026-11-20 22:00 en Argentina
    expect(fechaLocal(new Date(Date.UTC(2026, 10, 21, 1, 0, 0)))).toBe("2026-11-20");
  });
});

describe("minutosAHoras", () => {
  it("escribe los minutos como los lee una persona", () => {
    expect(minutosAHoras(0)).toBe("0 min");
    expect(minutosAHoras(45)).toBe("45 min");
    expect(minutosAHoras(60)).toBe("1 h");
    expect(minutosAHoras(95)).toBe("1 h 35 min");
  });
});

describe("huecos entre servicios", () => {
  it("no cuenta como detenida la espera larga entre dos servicios", () => {
    const jornada = armarJornadas([
      muestra({ minutos: 0, isStopped: true }),
      // 5 horas después, la unidad sigue en la base: es el rato entre servicios, no una parada.
      muestra({ minutos: 300, isStopped: true })
    ]);

    expect(jornada[0].minutosDetenido).toBe(0);
    expect(jornada[0].huecos).toBe(0);
  });

  it("sí cuenta como corte un hueco de 20 minutos en medio del servicio", () => {
    const jornada = armarJornadas([
      muestra({ minutos: 0 }),
      muestra({ minutos: 20, latitude: -40.16 }),
      muestra({ minutos: 30, latitude: -40.17 })
    ]);

    expect(jornada[0].huecos).toBe(1);
  });
});

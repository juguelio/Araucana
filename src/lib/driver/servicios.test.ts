import { describe, expect, it } from "vitest";
import type { FlotaEnVivo } from "./en-vivo";
import { AVISO_PREVIO_MINUTOS, evaluarServicio, evaluarServiciosDelDia, serviciosQuePidenAtencion, type ServicioDelDia } from "./servicios";

const AHORA = new Date("2026-11-20T11:00:00.000Z"); // 08:00 en Argentina

function enMinutos(minutos: number) {
  return new Date(AHORA.getTime() + minutos * 60_000);
}

function flotaCon(naves: Array<Partial<FlotaEnVivo["naves"][number]> & { vehicleId: string }>): FlotaEnVivo {
  return {
    actualizadoEn: AHORA.toISOString(),
    ventanaMinutos: 10,
    naves: naves.map((nave) => ({
      vehicleId: nave.vehicleId,
      vehicleName: nave.vehicleName ?? "Sprinter",
      internalNumber: nave.internalNumber ?? "AR-08",
      licensePlate: null,
      driverId: nave.driverId ?? "chofer-1",
      driverName: nave.driverName ?? "Juan Muñoz",
      latitude: -40.157,
      longitude: -71.31,
      recordedAt: enMinutos(-(nave.minutosDesdeLaSenal ?? 1)).toISOString(),
      minutosDesdeLaSenal: nave.minutosDesdeLaSenal ?? 1,
      estado: nave.estado ?? "en-movimiento",
      speedKmh: nave.speedKmh ?? 30,
      heading: 90,
      accuracy: 6,
      isStopped: nave.estado === "detenida",
      stoppedDurationSeconds: 0
    })),
    sinUbicacion: []
  };
}

function servicio(extra: Partial<ServicioDelDia> = {}): ServicioDelDia {
  return {
    id: "srv-1",
    area: "AEROPUERTO",
    at: enMinutos(60),
    titulo: "Aeropuerto · AR 1234",
    detalle: null,
    unidades: [
      { vehicleId: "veh-08", vehicleName: "Araucana 08", internalNumber: "AR-08", driverId: "chofer-1", driverName: "Juan Muñoz" }
    ],
    pasajeros: 4,
    href: "/admin/salidas-del-dia#srv-1",
    ...extra
  };
}

describe("evaluarServicio", () => {
  it("marca listo cuando la unidad asignada se está moviendo", () => {
    const evaluado = evaluarServicio(servicio(), flotaCon([{ vehicleId: "veh-08", estado: "en-movimiento" }]), { ahora: AHORA });
    expect(evaluado.nivel).toBe("listo");
    expect(evaluado.motivo).toContain("en movimiento");
    expect(evaluado.minutosParaSalir).toBe(60);
  });

  it("marca en-curso cuando el servicio ya arrancó pero sigue dentro de su ventana y la unidad reporta", () => {
    const evaluado = evaluarServicio(
      servicio({ at: enMinutos(-20), endsAt: enMinutos(40) }),
      flotaCon([{ vehicleId: "veh-08", estado: "en-movimiento", speedKmh: 45 }]),
      { ahora: AHORA }
    );
    expect(evaluado.enCurso).toBe(true);
    expect(evaluado.nivel).toBe("en-curso");
    expect(evaluado.motivo).toContain("45 km/h");
  });

  it("marca en-riesgo cuando el servicio está en curso y la unidad perdió señal", () => {
    const evaluado = evaluarServicio(
      servicio({ at: enMinutos(-20), endsAt: enMinutos(40) }),
      flotaCon([{ vehicleId: "veh-08", estado: "sin-senal", minutosDesdeLaSenal: 35 }]),
      { ahora: AHORA }
    );
    expect(evaluado.enCurso).toBe(true);
    expect(evaluado.nivel).toBe("en-riesgo");
    expect(evaluado.motivo).toContain("en servicio");
  });

  it("marca riesgo cuando falta poco y la unidad dejó de reportar", () => {
    const evaluado = evaluarServicio(
      servicio(),
      flotaCon([{ vehicleId: "veh-08", estado: "sin-senal", minutosDesdeLaSenal: 42 }]),
      { ahora: AHORA }
    );
    expect(evaluado.nivel).toBe("en-riesgo");
    expect(evaluado.motivo).toBe("sin señal hace 42 min");
  });

  it("baja a atención cuando la señal es vieja pero el servicio todavía está lejos", () => {
    const evaluado = evaluarServicio(
      servicio({ at: enMinutos(AVISO_PREVIO_MINUTOS + 300) }),
      flotaCon([{ vehicleId: "veh-08", estado: "sin-senal", minutosDesdeLaSenal: 12 }]),
      { ahora: AHORA }
    );
    expect(evaluado.nivel).toBe("atencion");
  });

  it("marca riesgo cuando la unidad no tiene posición y el servicio está cerca", () => {
    const evaluado = evaluarServicio(servicio(), flotaCon([]), { ahora: AHORA });
    expect(evaluado.nivel).toBe("en-riesgo");
    expect(evaluado.motivo).toContain("sin posición");
  });

  it("marca sin-unidad cuando el servicio está cerca y no hay nada asignado", () => {
    const evaluado = evaluarServicio(servicio({ unidades: [] }), flotaCon([]), { ahora: AHORA });
    expect(evaluado.nivel).toBe("sin-unidad");
    expect(evaluado.motivo).toBe("falta asignar nave");
  });

  it("no alarma por un servicio sin unidad que es a la tarde", () => {
    const evaluado = evaluarServicio(servicio({ unidades: [], at: enMinutos(480) }), flotaCon([]), { ahora: AHORA });
    expect(evaluado.nivel).toBe("futuro");
  });

  it("un servicio que ya pasó su ventana de llegada no compite por la atención", () => {
    const evaluado = evaluarServicio(servicio({ at: enMinutos(-120) }), flotaCon([]), { ahora: AHORA });
    expect(evaluado.nivel).toBe("pasado");
  });

  it("con dos unidades alcanza que una esté en movimiento para no frenar el servicio", () => {
    const evaluado = evaluarServicio(
      servicio({
        unidades: [
          { vehicleId: "veh-08", vehicleName: "A", internalNumber: "AR-08", driverId: null, driverName: null },
          { vehicleId: "veh-12", vehicleName: "B", internalNumber: "AR-12", driverId: null, driverName: null }
        ]
      }),
      flotaCon([
        { vehicleId: "veh-08", estado: "detenida", minutosDesdeLaSenal: 40 },
        { vehicleId: "veh-12", estado: "en-movimiento" }
      ]),
      { ahora: AHORA }
    );
    expect(evaluado.nivel).toBe("listo");
  });
});

describe("evaluarServiciosDelDia", () => {
  it("ordena primero lo que hay que resolver y cuenta los totales", () => {
    const resumen = evaluarServiciosDelDia(
      [
        servicio({ id: "listo", at: enMinutos(50) }),
        servicio({ id: "sin-unidad", unidades: [], at: enMinutos(20) }),
        servicio({
          id: "riesgo",
          at: enMinutos(30),
          unidades: [{ vehicleId: "veh-12", vehicleName: "B", internalNumber: "AR-12", driverId: null, driverName: null }]
        })
      ],
      flotaCon([
        { vehicleId: "veh-08", estado: "en-movimiento" },
        { vehicleId: "veh-12", estado: "sin-senal", minutosDesdeLaSenal: 55 }
      ]),
      { ahora: AHORA }
    );

    expect(resumen.evaluados.map((evaluado) => evaluado.id)).toEqual(["sin-unidad", "riesgo", "listo"]);
    expect(resumen.sinUnidad).toBe(1);
    expect(resumen.enRiesgo).toBe(2);
    expect(resumen.listos).toBe(1);
    expect(serviciosQuePidenAtencion(resumen).map((evaluado) => evaluado.id)).toEqual(["sin-unidad", "riesgo"]);
  });
});

describe("unidad sin posición con el servicio lejos", () => {
  it("no la marca como atención hasta que el servicio se acerca", () => {
    const evaluado = evaluarServicio(servicio({ at: enMinutos(AVISO_PREVIO_MINUTOS + 240) }), flotaCon([]), { ahora: AHORA });
    expect(evaluado.nivel).toBe("futuro");
    expect(evaluado.motivo).toBe("todavía sin posición");
  });
});

import { describe, expect, it } from "vitest";
import type { FlotaEnVivo } from "./en-vivo";
import { cierreDelTraslado } from "./servicios-consulta";
import { AVISO_PREVIO_MINUTOS, detectarChoquesDeUnidades, evaluarServicio, evaluarServiciosDelDia, serviciosQuePidenAtencion, type ServicioDelDia } from "./servicios";

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

describe("detectarChoquesDeUnidades", () => {
  const base = (id: string, at: Date, endsAt: Date, vehicleId = "veh-24"): ServicioDelDia => ({
    id,
    area: "RUTA",
    at,
    endsAt,
    titulo: `${id} · San Martín de los Andes → Villa La Angostura`,
    detalle: null,
    unidades: [{ vehicleId, vehicleName: "Araucana 24", internalNumber: "24", driverId: null, driverName: null }],
    pasajeros: 0,
    href: `/admin/rutas/r/${id}`
  });

  it("marca las dos salidas cuando la misma nave se pisa en el horario", () => {
    const a = base("salida-1", enMinutos(60), enMinutos(150));
    const b = base("salida-2", enMinutos(90), enMinutos(180));
    const choques = detectarChoquesDeUnidades([a, b], AHORA);
    expect(choques.get("salida-1")?.map((c) => c.servicioId)).toEqual(["salida-2"]);
    expect(choques.get("salida-2")?.map((c) => c.servicioId)).toEqual(["salida-1"]);
    expect(choques.get("salida-1")?.[0].unidad).toBe("Interno 24");
  });

  it("no marca nada si una sale cuando la otra ya llegó", () => {
    const a = base("salida-1", enMinutos(0), enMinutos(60));
    const b = base("salida-2", enMinutos(60), enMinutos(120));
    expect(detectarChoquesDeUnidades([a, b], AHORA).size).toBe(0);
  });

  it("no cuenta los choques de salidas que ya terminaron", () => {
    const a = base("salida-1", enMinutos(-300), enMinutos(-240));
    const b = base("salida-2", enMinutos(-250), enMinutos(-200));
    expect(detectarChoquesDeUnidades([a, b], AHORA).size).toBe(0);
  });

  it("usa 90 minutos de ventana cuando la salida no dice cuándo termina", () => {
    const a: ServicioDelDia = { ...base("salida-1", enMinutos(10), enMinutos(10)), endsAt: null };
    const b = base("salida-2", enMinutos(80), enMinutos(120));
    expect(detectarChoquesDeUnidades([a, b], AHORA).get("salida-1")).toHaveLength(1);
  });
});

describe("evaluarServiciosDelDia con choques", () => {
  it("la misma nave en dos salidas a la vez no queda «listo»: queda en riesgo y lo dice", () => {
    const flota = flotaCon([{ vehicleId: "veh-24", internalNumber: "24" }]);
    const servicioDe = (id: string, minutos: number): ServicioDelDia => ({
      id, area: "RUTA", at: enMinutos(minutos), endsAt: enMinutos(minutos + 90),
      titulo: `${id} · Villa Traful → San Martín de los Andes`, detalle: null,
      unidades: [{ vehicleId: "veh-24", vehicleName: "Araucana 24", internalNumber: "24", driverId: "chofer-1", driverName: "Juan Muñoz" }],
      pasajeros: 0, href: "/admin/rutas/r"
    });
    const resumen = evaluarServiciosDelDia([servicioDe("salida-1", 60), servicioDe("salida-2", 70)], flota, { ahora: AHORA });
    const primero = resumen.evaluados.find((s) => s.id === "salida-1")!;
    expect(primero.nivel).toBe("en-riesgo");
    expect(primero.motivo).toContain("misma nave en 2 servicios");
    expect(primero.choques).toHaveLength(1);
    expect(resumen.enRiesgo).toBe(2);
  });
});

describe("cierreDelTraslado", () => {
  it("una partida cierra a los 90 minutos del pickup, no cuando despega el avión", () => {
    const pickup = new Date("2026-11-21T21:35:00.000Z");   // 18:35 en Argentina
    const despegue = new Date("2026-11-21T23:30:00.000Z"); // 20:30
    expect(cierreDelTraslado(pickup, "DEPARTURE", despegue).toISOString()).toBe("2026-11-21T23:05:00.000Z");
  });

  it("si el avión sale antes de los 90 minutos, la unidad queda libre al despegue", () => {
    const pickup = new Date("2026-11-21T21:35:00.000Z");
    const despegue = new Date("2026-11-21T22:20:00.000Z");
    expect(cierreDelTraslado(pickup, "DEPARTURE", despegue).toISOString()).toBe("2026-11-21T22:20:00.000Z");
  });

  it("un arribo se extiende 90 minutos por el reparto en los hoteles", () => {
    const pickup = new Date("2026-11-21T21:35:00.000Z");
    const despegue = new Date("2026-11-21T21:00:00.000Z");
    expect(cierreDelTraslado(pickup, "ARRIVAL", despegue).toISOString()).toBe("2026-11-21T23:05:00.000Z");
  });
});

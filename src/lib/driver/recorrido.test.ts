import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acotarHoras, cargarRecorridos, cargarRecorridosResultado, construirRecorridos,
  depurarPuntos, distanciaMetros, metrosDeRecorrido, MAX_MUESTRAS_RECORRIDO,
  MAX_PUNTOS_RECORRIDO, type MuestraCruda
} from "./recorrido";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { driverLocationSample: { findMany } } }));
const BASE: [number, number] = [-40.1579, -71.3534];
const AHORA = new Date("2026-11-20T20:00:00Z");

function muestra(metros: number, minutos: number, extra: Partial<MuestraCruda> = {}): MuestraCruda {
  return {
    driverId: "d1", vehicleId: "v1", latitude: BASE[0] + metros / 111_320,
    longitude: BASE[1], recordedAt: new Date(Date.UTC(2026, 10, 20, 12, minutos)),
    driver: { name: " Juan " }, vehicle: { name: "Unidad 1", internalNumber: "AR-01" }, ...extra
  };
}

beforeEach(() => { findMany.mockReset(); findMany.mockResolvedValue([]); });

describe("geometría y depuración", () => {
  it("mide distancia haversine y suma redondeada", () => {
    expect(distanciaMetros(BASE, BASE)).toBe(0);
    expect(distanciaMetros(BASE, [BASE[0] + 0.001, BASE[1]])).toBeCloseTo(111.195, 2);
    expect(metrosDeRecorrido(depurarPuntos([muestra(0, 0), muestra(1000, 1), muestra(2000, 2)]))).toBeCloseTo(1998, 0);
    expect(metrosDeRecorrido([])).toBe(0);
  });
  it("filtra ruido intermedio pero conserva la última señal aunque se mueva menos de 25 m", () => {
    const filas = [muestra(0, 0), muestra(5, 1), muestra(8, 2), muestra(200, 3), muestra(205, 4)];
    const puntos = depurarPuntos(filas);
    expect(puntos).toHaveLength(3);
    expect(puntos.at(-1)).toEqual({ punto: [filas[4].latitude, filas[4].longitude], at: filas[4].recordedAt.toISOString() });
  });
  it("conserva los extremos quietos y ordena sin mutar la entrada", () => {
    const filas = [muestra(0, 3), muestra(0, 0), muestra(0, 1)];
    const antes = [...filas];
    const puntos = depurarPuntos(filas);
    expect(puntos.map(p => p.at)).toEqual([filas[1].recordedAt.toISOString(), filas[0].recordedAt.toISOString()]);
    expect(filas).toEqual(antes);
  });
  it("recorta uniformemente sin perder salida ni llegada", () => {
    const filas = Array.from({ length: 1000 }, (_, i) => muestra(i * 50, i));
    const puntos = depurarPuntos(filas, { maxPuntos: 50 });
    expect(puntos).toHaveLength(50);
    expect(puntos[0].at).toBe(filas[0].recordedAt.toISOString());
    expect(puntos.at(-1)!.at).toBe(filas.at(-1)!.recordedAt.toISOString());
    expect(depurarPuntos(filas)).toHaveLength(MAX_PUNTOS_RECORRIDO);
  });
  it.each([0, 1, -1, NaN, Infinity, 2.9])("normaliza maxPuntos=%s sin puntos indefinidos", maxPuntos => {
    const puntos = depurarPuntos([muestra(0, 0), muestra(100, 1), muestra(200, 2)], { maxPuntos });
    expect(puntos.length).toBeGreaterThanOrEqual(2);
    expect(puntos.at(-1)!.at).toBe(muestra(200, 2).recordedAt.toISOString());
  });
  it("ignora coordenadas y fechas inválidas sin serializar NaN", () => {
    const filas = [muestra(0, 0), muestra(0, 1, { latitude: NaN }), muestra(0, 2, { longitude: Infinity }),
      muestra(0, 3, { latitude: 91 }), muestra(0, 4, { longitude: -181 }), muestra(0, 5, { recordedAt: new Date(NaN) }), muestra(100, 6)];
    expect(depurarPuntos(filas)).toHaveLength(2);
  });
});

describe("segmentos continuos", () => {
  it("separa vehículos incluso cuando el chofer vuelve al anterior", () => {
    const filas = [muestra(0, 0), muestra(100, 1), muestra(1000, 2, { vehicleId: "v2" }),
      muestra(1100, 3, { vehicleId: "v2" }), muestra(2000, 4), muestra(2100, 5)];
    const recorridos = construirRecorridos(filas);
    expect(recorridos).toHaveLength(3);
    expect(recorridos.map(r => r.vehicleId).sort()).toEqual(["v1", "v1", "v2"]);
    expect(recorridos.every(r => r.muestras === 2 && r.metros < 101)).toBe(true);
    expect(new Set(recorridos.map(r => r.id)).size).toBe(3);
    expect(construirRecorridos([...filas].reverse())).toEqual(recorridos);
  });
  it("no mezcla choferes y usa los metadatos del último reporte del segmento", () => {
    const recorridos = construirRecorridos([muestra(0, 0), muestra(100, 1),
      muestra(0, 0, { driverId: "d2" }), muestra(200, 1, { driverId: "d2", driver: { name: " María " } })]);
    expect(recorridos.map(r => [r.driverId, r.driverName])).toEqual([["d2", "María"], ["d1", "Juan"]]);
  });
  it("corta huecos mayores a 10 minutos, pero no a 10 exactos", () => {
    const recorridos = construirRecorridos([muestra(0, 0), muestra(100, 10), muestra(200, 21), muestra(300, 22)]);
    expect(recorridos).toHaveLength(2);
    expect(recorridos.every(r => r.muestras === 2)).toBe(true);
  });
  it("corta saltos de GPS por encima de 180 km/h sin sumar el salto", () => {
    const recorridos = construirRecorridos([muestra(0, 0), muestra(100, 1), muestra(100_000, 2), muestra(100_100, 3)]);
    expect(recorridos).toHaveLength(2);
    expect(recorridos.every(r => r.metros < 101)).toBe(true);
  });
  it("mantiene una velocidad plausible por debajo del umbral", () => {
    expect(construirRecorridos([muestra(0, 0), muestra(2900, 1)])).toHaveLength(1);
  });
  it("un salto aislado no conecta sus dos lados y conserva los puntos sueltos", () => {
    const recorridos = construirRecorridos([muestra(0, 0), muestra(100, 1), muestra(100_000, 2), muestra(200, 3), muestra(300, 4)]);
    expect(recorridos).toHaveLength(3);
    expect(recorridos.reduce((n, r) => n + r.muestras, 0)).toBe(5);
    expect(recorridos.reduce((n, r) => n + r.metros, 0)).toBeLessThan(201);
  });
  it("separa ubicaciones contradictorias con timestamp idéntico", () => {
    const recorridos = construirRecorridos([muestra(0, 0), muestra(1000, 0)]);
    expect(recorridos).toHaveLength(2);
    expect(recorridos.every(r => r.metros === 0)).toBe(true);
    expect(construirRecorridos([muestra(1000, 0), muestra(0, 0)])).toEqual(recorridos);
  });
  it("descarta datos inválidos y corta en vez de unir a través de ellos", () => {
    const recorridos = construirRecorridos([muestra(0, 0), muestra(0, 1, { latitude: NaN }), muestra(100, 2),
      muestra(0, 3, { recordedAt: new Date(NaN) }), muestra(0, 4, { driverId: "" })]);
    expect(recorridos).toHaveLength(2);
    expect(recorridos.every(r => r.metros === 0 && r.muestras === 1)).toBe(true);
    expect(() => JSON.stringify(recorridos)).not.toThrow();
  });
  it("calcula metros antes del recorte visual en un recorrido de ida y vuelta", () => {
    const filas = [muestra(0, 0), muestra(1000, 1), muestra(0, 2), muestra(1000, 3), muestra(0, 4)];
    const [completo] = construirRecorridos(filas);
    const [recortado] = construirRecorridos(filas, { maxPuntos: 2 });
    expect(recortado.puntos).toHaveLength(2);
    expect(recortado.metros).toBe(completo.metros);
    expect(recortado.metros).toBeGreaterThan(3900);
    expect(recortado.id).toBe(completo.id);
  });
  it("mantiene el id al agregar reportes al mismo segmento", () => {
    const filas = [muestra(0, 0), muestra(100, 1)];
    expect(construirRecorridos(filas)[0].id).toBe(construirRecorridos([...filas, muestra(200, 2)])[0].id);
  });
});

describe("ventana y consulta acotadas", () => {
  it.each([[undefined, 8], [null, 8], ["", 8], ["  ", 8], ["no", 8], [NaN, 8], [Infinity, 8], [-Infinity, 8],
    [0, 1], [-2, 1], [1.6, 2], ["24", 24], [1000, 24]])("normaliza %s a %s", (entrada, salida) => {
    expect(acotarHoras(entrada)).toBe(salida);
  });
  it("pide últimos datos con desempate y límite + centinela, sin fechas futuras", async () => {
    const resultado = await cargarRecorridosResultado(1000, AHORA);
    expect(resultado).toEqual({ recorridos: [], horas: 24, truncado: false });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { recordedAt: { gte: new Date("2026-11-19T20:00:00Z"), lte: AHORA } },
      take: MAX_MUESTRAS_RECORRIDO + 1,
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }]
    }));
  });
  it("señala truncado y excluye el centinela más viejo del recorrido", async () => {
    const reciente = muestra(100, 2);
    const centinela = muestra(0, 1, { driverId: "viejo" });
    findMany.mockResolvedValue([...Array.from({ length: MAX_MUESTRAS_RECORRIDO }, () => reciente), centinela]);
    const resultado = await cargarRecorridosResultado(NaN, AHORA);
    expect(resultado.horas).toBe(8);
    expect(resultado.truncado).toBe(true);
    expect(resultado.recorridos).toHaveLength(1);
    expect(resultado.recorridos[0].muestras).toBe(MAX_MUESTRAS_RECORRIDO);
    expect(resultado.recorridos[0].driverId).toBe("d1");
  });
  it("no señala truncado exactamente en el límite", async () => {
    findMany.mockResolvedValue(Array.from({ length: MAX_MUESTRAS_RECORRIDO }, () => muestra(0, 0)));
    expect((await cargarRecorridosResultado(8, AHORA)).truncado).toBe(false);
  });
  it("conserva la firma array del cargador de la página", async () => {
    findMany.mockResolvedValue([muestra(100, 1), muestra(0, 0)]);
    expect(await cargarRecorridos(8, AHORA)).toEqual(construirRecorridos([muestra(0, 0), muestra(100, 1)]));
  });
});

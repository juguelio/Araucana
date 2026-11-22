import { describe, expect, it } from "vitest";
import type { SalidaOption } from "./salida-picker-utils";
import { destinosDesde, origenes, precioDelTramo, primerDia, rutaEntre, salidasDelTramo, serviciosDeRutas, tiraConServicio, totalDelViaje, unificarLugares, viajeInicial, vueltasPosibles } from "./viaje-utils";

function salida(id: string, from: string, to: string, dayKey: string, timeLabel: string, extra: Partial<SalidaOption> = {}): SalidaOption {
  return { id, from, to, dayKey, dayLabel: dayKey, timeLabel, availableSeats: 10, status: "OPEN", priceCents: 3000000, currency: "ARS", ...extra };
}

const SMA = "San Martín de los Andes";
const salidas = [
  salida("i1", SMA, "Villa Traful", "2026-11-19", "08:00", { stopFares: [{ name: "Confluencia", priceCents: 1500000 }] }),
  salida("i2", SMA, "Villa Traful", "2026-11-20", "08:00"),
  salida("h1", SMA, "Hua Hum", "2026-11-19", "10:30", { priceCents: 1800000 }),
  salida("v0", "Villa Traful", SMA, "2026-11-19", "07:00"),
  salida("v1", "Villa Traful", SMA, "2026-11-19", "16:30"),
  salida("v2", "Villa Traful", SMA, "2026-11-21", "16:30")
];

describe("viaje de Nueva reserva (template, 18-nov)", () => {
  it("ofrece primero el origen y el destino con más salidas, en su primer día", () => {
    expect(origenes(salidas)[0]).toEqual({ nombre: SMA, salidas: 3 });
    expect(destinosDesde(salidas, SMA).map((lugar) => lugar.nombre)).toEqual(["Villa Traful", "Hua Hum"]);
    expect(viajeInicial(salidas)).toEqual({ origen: SMA, destino: "Villa Traful", dia: "2026-11-19" });
  });

  it("abre desde San Martín aunque otra ruta tenga muchas más salidas (Villa Traful, 258)", () => {
    // La operación real tiene 258 salidas de Villa Traful: así el «Desde» arrancaba en Villa Traful.
    const muchasDeVillaTraful = [
      ...salidas,
      ...Array.from({ length: 258 }, (_, i) =>
        salida(`vt${i}`, "Villa Traful", SMA, `2026-12-${String((i % 28) + 1).padStart(2, "0")}`, "16:30")
      )
    ];
    expect(origenes(muchasDeVillaTraful)[0].nombre).toBe("Villa Traful");
    expect(viajeInicial(muchasDeVillaTraful).origen).toBe(SMA);
  });

  it("si San Martín no tiene salidas, abre con el origen que haya", () => {
    const soloHuaHum = [salida("h2", "Hua Hum", SMA, "2026-11-19", "17:00")];
    expect(viajeInicial(soloHuaHum).origen).toBe("Hua Hum");
  });

  it("la tira de días muestra sólo los días con servicio", () => {
    // Servicio martes, sábados y domingos: los días de la semana sin salidas no aparecen.
    const conServicio = ["2027-01-02", "2027-01-03", "2027-01-05", "2027-01-09", "2027-01-10"];
    const tira = tiraConServicio(conServicio, "2027-01-02");
    expect(tira.dias).toEqual(conServicio);
    expect([tira.hayAntes, tira.hayDespues]).toEqual([false, false]);
  });

  it("la tira avanza de siete en siete días con servicio, no de siete días de calendario", () => {
    const dias = Array.from({ length: 12 }, (_, i) => `2027-02-${String(i + 1).padStart(2, "0")}`);
    const primera = tiraConServicio(dias, dias[0]);
    expect(primera.dias).toHaveLength(7);
    expect([primera.base, primera.hayAntes, primera.hayDespues]).toEqual([0, false, true]);

    const segunda = tiraConServicio(dias, dias[7]);
    expect(segunda.base).toBe(7);
    expect([segunda.hayAntes, segunda.hayDespues]).toEqual([true, false]);
    expect(segunda.dias[0]).toBe(dias[7]);
  });

  it("si se pide una fecha posterior a la última, la tira muestra el final", () => {
    const dias = ["2027-01-02", "2027-01-03"];
    expect(tiraConServicio(dias, "2027-03-01").dias).toEqual(dias);
    expect(tiraConServicio([], "2027-01-02")).toEqual({ dias: [], base: 0, hayAntes: false, hayDespues: false });
  });

  it("encuentra salidas para dos paradas y propone la vuelta con las paradas invertidas", () => {
    const horarios = salidas.map((salida) => ({ ...salida, bookingMode: "SEATED" }));
    expect(origenes(horarios)).toContainEqual({ nombre: "Río Hermoso", salidas: 5 });
    expect(destinosDesde(horarios, "Río Hermoso").map((lugar) => lugar.nombre)).toContain("Falkner");
    const [ida] = salidasDelTramo(horarios, "Río Hermoso", "Falkner");
    const [vuelta] = vueltasPosibles(horarios, "Río Hermoso", "Falkner", ida);
    expect(ida).toMatchObject({ id: "i1", boardingStop: "Río Hermoso", dropoffStop: "Falkner", priceCents: 600000 });
    expect(vuelta).toMatchObject({ id: "v1", boardingStop: "Falkner", dropoffStop: "Río Hermoso", priceCents: 600000 });
  });

  it("la vuelta es la ruta inversa y sólo las salidas posteriores a la ida", () => {
    const ida = salidasDelTramo(salidas, SMA, "Villa Traful")[0];
    expect(vueltasPosibles(salidas, SMA, "Villa Traful").map((s) => s.id)).toEqual(["v0", "v1", "v2"]);
    // La de las 07:00 del mismo día sale antes que la ida de las 08:00: no sirve.
    expect(vueltasPosibles(salidas, SMA, "Villa Traful", ida).map((s) => s.id)).toEqual(["v1", "v2"]);
    expect(vueltasPosibles(salidas, SMA, "Hua Hum")).toEqual([]);
  });

  it("el primer día con salidas desde un mínimo", () => {
    const vueltas = vueltasPosibles(salidas, SMA, "Villa Traful");
    expect(primerDia(vueltas, "2026-11-20")).toBe("2026-11-21");
    expect(primerDia(vueltas, "2026-12-01")).toBe("");
  });

  it("el precio sale de la parada donde baja, y el total suma los dos tramos con los menores", () => {
    const [ida] = salidas;
    const vuelta = salidas[4];
    expect(precioDelTramo(ida, "")).toBe(3000000);
    expect(precioDelTramo(ida, "Confluencia")).toBe(1500000);
    // 2 adultos + 1 menor de media tarifa + 1 menor de 4 sin cargo, ida a Confluencia y vuelta entera.
    expect(totalDelViaje([{ salida: ida, parada: "Confluencia" }, { salida: vuelta, parada: "" }], { lugares: 4, media: 1, sinCargo: 1 }))
      .toBe((1500000 * 2 + 750000) + (3000000 * 2 + 1500000));
  });
});

describe("todas las rutas y un nombre por lugar (19-nov: «te están faltando rutas»)", () => {
  // Las rutas del repo (prisma/demo-routes.ts) escriben «San Martin» sin tilde.
  const rutas = [
    { id: "r1", from: "San Martin de los Andes", to: "Villa Traful" },
    { id: "r2", from: "Villa Traful", to: "San Martin de los Andes" },
    { id: "r3", from: "Villa La Angostura", to: "Villa Traful" },
    { id: "r4", from: "Villa Traful", to: "Villa La Angostura" },
    { id: "r5", from: "San Martin de los Andes", to: "Hua Hum" }
  ];

  it("con o sin tilde es el mismo lugar, y se muestra con tilde", () => {
    const { salidas: unificadas, rutas: rutasUnificadas } = unificarLugares(salidas, rutas);
    expect(new Set(unificadas.map((s) => s.from)).has("San Martin de los Andes")).toBe(false);
    expect(rutasUnificadas[0].from).toBe(SMA);
    // La vuelta escrita sin tilde se reconoce como la inversa de la ida con tilde.
    expect(vueltasPosibles(unificadas, SMA, "Villa Traful").length).toBeGreaterThan(0);
  });

  it("las rutas sin salidas cargadas aparecen igual, al final y con 0", () => {
    const { salidas: unificadas, rutas: rutasUnificadas } = unificarLugares(salidas, rutas);
    expect(origenes(unificadas, rutasUnificadas).map((l) => [l.nombre, l.salidas])).toEqual([
      [SMA, 3], ["Villa Traful", 3], ["Villa La Angostura", 0]
    ]);
    expect(destinosDesde(unificadas, "Villa Traful", rutasUnificadas).map((l) => [l.nombre, l.salidas])).toEqual([
      [SMA, 3], ["Villa La Angostura", 0]
    ]);
    expect(destinosDesde(unificadas, SMA, rutasUnificadas).map((l) => l.nombre)).toEqual(["Villa Traful", "Hua Hum"]);
    expect(rutaEntre(rutasUnificadas, "Villa La Angostura", "Villa Traful")?.id).toBe("r3");
  });
});

describe("«¿Qué reservás?»: los servicios de la pantalla única (19-nov)", () => {
  const rutas = [
    { id: "r1", from: "San Martin de los Andes", to: "Villa Traful" },
    { id: "r2", from: "Villa Traful", to: "San Martin de los Andes" },
    { id: "r3", from: "Villa La Angostura", to: "Villa Traful" },
    { id: "r4", from: "Villa Traful", to: "Villa La Angostura" },
    { id: "r5", from: "San Martin de los Andes", to: "Hua Hum" },
    { id: "r6", from: "Hua Hum", to: "San Martin de los Andes" }
  ];
  const lista = [
    salida("a", SMA, "Villa Traful", "2026-11-21", "10:00"), salida("b", SMA, "Villa Traful", "2026-11-22", "10:00"),
    salida("c", "Villa Traful", SMA, "2026-11-21", "17:30"),
    salida("d", "Villa La Angostura", "Villa Traful", "2026-11-21", "11:00")
  ];

  it("uno por recorrido (la ida y su vuelta juntas), los de más salidas primero, nombrados sin San Martín", () => {
    const { salidas: s, rutas: r } = unificarLugares(lista, rutas);
    expect(serviciosDeRutas(s, r).map((x) => [x.clave, x.titulo, x.detalle, x.origen, x.destino, x.salidas])).toEqual([
      ["villa-traful", "Villa Traful", `desde ${SMA}`, SMA, "Villa Traful", 3],
      ["villa-la-angostura", "Villa La Angostura", "⇄ Villa Traful", "Villa La Angostura", "Villa Traful", 1],
      ["hua-hum", "Hua Hum", `desde ${SMA}`, SMA, "Hua Hum", 0]
    ]);
  });

  it("el servicio elegido arranca el viaje en ese recorrido", () => {
    expect(viajeInicial(lista, { origen: "Villa La Angostura", destino: "Villa Traful" }))
      .toEqual({ origen: "Villa La Angostura", destino: "Villa Traful", dia: "2026-11-21" });
  });
});

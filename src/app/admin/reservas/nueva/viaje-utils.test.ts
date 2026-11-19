import { describe, expect, it } from "vitest";
import type { SalidaOption } from "./salida-picker-utils";
import { destinosDesde, origenes, precioDelTramo, primerDia, rutaEntre, salidasDelTramo, totalDelViaje, unificarLugares, viajeInicial, vueltasPosibles } from "./viaje-utils";

function salida(id: string, from: string, to: string, dayKey: string, timeLabel: string, extra: Partial<SalidaOption> = {}): SalidaOption {
  return { id, from, to, dayKey, dayLabel: dayKey, timeLabel, availableSeats: 10, status: "OPEN", priceCents: 3000000, currency: "ARS", ...extra };
}

const SMA = "San Martín de los Andes";
const salidas = [
  salida("i1", SMA, "Villa Traful", "2026-11-19", "08:00", { stopFares: [{ name: "Confluencia", priceCents: 1500000 }] }),
  salida("i2", SMA, "Villa Traful", "2026-11-20", "08:00"),
  salida("j1", SMA, "Junín de los Andes", "2026-11-19", "09:30", { priceCents: 1200000 }),
  salida("v0", "Villa Traful", SMA, "2026-11-19", "07:00"),
  salida("v1", "Villa Traful", SMA, "2026-11-19", "16:30"),
  salida("v2", "Villa Traful", SMA, "2026-11-21", "16:30")
];

describe("viaje de Nueva reserva (template, 18-nov)", () => {
  it("ofrece primero el origen y el destino con más salidas, en su primer día", () => {
    expect(origenes(salidas)[0]).toEqual({ nombre: SMA, salidas: 3 });
    expect(destinosDesde(salidas, SMA).map((lugar) => lugar.nombre)).toEqual(["Villa Traful", "Junín de los Andes"]);
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
    const soloJunin = [salida("j1", "Junín de los Andes", SMA, "2026-11-19", "09:30")];
    expect(viajeInicial(soloJunin).origen).toBe("Junín de los Andes");
  });

  it("la vuelta es la ruta inversa y sólo las salidas posteriores a la ida", () => {
    const ida = salidasDelTramo(salidas, SMA, "Villa Traful")[0];
    expect(vueltasPosibles(salidas, SMA, "Villa Traful").map((s) => s.id)).toEqual(["v0", "v1", "v2"]);
    // La de las 07:00 del mismo día sale antes que la ida de las 08:00: no sirve.
    expect(vueltasPosibles(salidas, SMA, "Villa Traful", ida).map((s) => s.id)).toEqual(["v1", "v2"]);
    expect(vueltasPosibles(salidas, SMA, "Junín de los Andes")).toEqual([]);
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
    expect(destinosDesde(unificadas, SMA, rutasUnificadas).map((l) => l.nombre)).toEqual(["Villa Traful", "Junín de los Andes", "Hua Hum"]);
    expect(rutaEntre(rutasUnificadas, "Villa La Angostura", "Villa Traful")?.id).toBe("r3");
  });
});

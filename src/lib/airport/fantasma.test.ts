import { expect, it } from "vitest";
import { estadoLegible, reservasFantasmaDelDia, reservasFantasmaPorVuelo } from "./fantasma";
import { esProyeccion, vuelosParaElTablero } from "./flight-board";

const ar1657 = { id: "f-ar1657", number: "AR1657", direction: "DEPARTURE", hora: "21:15", reservas: ["r1", "r2"] };
const ja3182 = { id: "f-ja3182", number: "JA3182", direction: "ARRIVAL", hora: "09:05", reservas: ["r3"] };

const detalle = [
  { id: "r1", code: "ARC-1", shortCode: "84R6YKCY", status: "PENDING_PAYMENT", passengerCount: 1, pasajero: "Paula D'Amico" },
  { id: "r2", code: "ARC-2", shortCode: "BZBK9893", status: "CONFIRMED", passengerCount: 2, pasajero: "Paula D'Amico" },
  { id: "r3", code: "ARC-3", shortCode: "5L63FPPZ", status: "PENDING_PAYMENT", passengerCount: 1, pasajero: "Pablo Freire" }
];

it("lista cada reserva fantasma con su código corto, su pasajero y el vuelo proyectado", () => {
  const filas = reservasFantasmaDelDia([ar1657, ja3182], detalle);
  expect(filas.map((f) => `${f.shortCode}|${f.pasajero}|${f.vuelo}|${f.sentido}|${f.hora}|${f.estado}`)).toEqual([
    // Ordenado por hora del vuelo: primero el arribo de las 09:05, después la salida de las 21:15.
    "5L63FPPZ|Pablo Freire|JA3182|ARRIVAL|09:05|Pago pendiente",
    "84R6YKCY|Paula D'Amico|AR1657|DEPARTURE|21:15|Pago pendiente",
    "BZBK9893|Paula D'Amico|AR1657|DEPARTURE|21:15|Confirmada"
  ]);
  // El `code` es la capability que abre la reserva: es el que usa el link a la edición.
  expect(filas[0].code).toBe("ARC-3");
  expect(filas[0].passengerCount).toBe(1);
});

it("una reserva que ya no existe no aparece y no rompe la lista", () => {
  const filas = reservasFantasmaDelDia([ar1657], detalle.filter((r) => r.id !== "r2"));
  expect(filas.map((f) => f.shortCode)).toEqual(["84R6YKCY"]);
});

it("sin vuelos fantasma no hay filas", () => {
  expect(reservasFantasmaDelDia([], detalle)).toEqual([]);
  expect(reservasFantasmaDelDia([{ ...ar1657, reservas: [] }], detalle)).toEqual([]);
});

it("agrupa por vuelo para dibujar un encabezado por vuelo", () => {
  const grupos = reservasFantasmaPorVuelo(reservasFantasmaDelDia([ar1657, ja3182], detalle));
  expect(grupos.map((g) => `${g.vuelo}/${g.filas.length}`)).toEqual(["JA3182/1", "AR1657/2"]);
  expect(grupos[1].sentido).toBe("DEPARTURE");
});

it("un estado nuevo se muestra crudo en vez de perderse", () => {
  expect(estadoLegible("PENDING_PAYMENT")).toBe("Pago pendiente");
  expect(estadoLegible("ESTADO_QUE_NO_EXISTE")).toBe("ESTADO_QUE_NO_EXISTE");
});

/**
 * El criterio del aviso no es `Flight.status` (corrección del 21-nov): todos los vuelos del día pueden
 * estar SCHEDULED o EN_ROUTE y aun así ser una proyección. Lo que decide es `source = "ESTIMADO"` con
 * `lastCheckedAt` en null.
 */
it("el fantasma se decide por source ESTIMADO sin verificar, no por el status del vuelo", () => {
  const proyecto = { source: "ESTIMADO", lastCheckedAt: null };
  expect(esProyeccion(proyecto)).toBe(true);
  expect(esProyeccion({ source: "ESTIMADO", lastCheckedAt: new Date("2026-11-21T13:46:00Z") })).toBe(false);
  expect(esProyeccion({ source: "API", lastCheckedAt: null })).toBe(false);

  const verificado = { source: "API", lastCheckedAt: new Date("2026-11-21T13:46:00Z") };
  expect(vuelosParaElTablero([verificado, proyecto])).toMatchObject({ fantasma: [proyecto] });
  // Día sin ningún vuelo confirmado (los futuros): las proyecciones son la grilla y no hay fantasma.
  expect(vuelosParaElTablero([proyecto]).fantasma).toEqual([]);
});

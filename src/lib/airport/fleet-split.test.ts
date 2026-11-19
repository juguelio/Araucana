import { describe, expect, it } from "vitest";
import { repartirPorZonas, type ParadaARepartir } from "./fleet-split";
import { largoDelRecorrido, ordenarPorRecorrido } from "./route-order";

const en = (code: string, seats: number, latitude: number, longitude: number): ParadaARepartir => ({ code, seats, pickup: { latitude, longitude } });

// Centro de San Martín de los Andes y Quila Quina, dos zonas en direcciones distintas desde el aeropuerto.
const centro = (code: string, n: number, seats = 2) => en(code, seats, -40.157 + n * 0.0004, -71.353 + n * 0.0004);
const quila = (code: string, n: number, seats = 2) => en(code, seats, -40.18 + n * 0.0004, -71.45 + n * 0.0004);

const largoDe = (paradas: ParadaARepartir[], codigos: string[]) => {
  const puntos = paradas.filter((parada) => codigos.includes(parada.code)).map((parada) => parada.pickup);
  return largoDelRecorrido(ordenarPorRecorrido(puntos, (punto) => punto));
};

describe("repartirPorZonas", () => {
  it("con dos naves llenas, cada una se queda con una zona", () => {
    // Intercaladas a propósito: el orden de llegada no tiene que decidir el reparto.
    const paradas = [centro("C1", 1), quila("Q1", 1), centro("C2", 2), quila("Q2", 2), centro("C3", 3), quila("Q3", 3)];
    const { porNave, sobrantes } = repartirPorZonas(paradas, [{ id: "t1", libres: 6, fijas: [] }, { id: "t2", libres: 6, fijas: [] }]);
    expect(sobrantes).toEqual([]);
    expect(porNave.map((codigos) => [...codigos].sort())).toEqual(expect.arrayContaining([["C1", "C2", "C3"], ["Q1", "Q2", "Q3"]]));
  });

  it("no pasa la capacidad de ninguna nave ni parte una reserva", () => {
    const paradas = [centro("C1", 1, 3), centro("C2", 2, 3), quila("Q1", 1, 3), quila("Q2", 2, 1)];
    const { porNave, sobrantes } = repartirPorZonas(paradas, [{ id: "t1", libres: 4, fijas: [] }, { id: "t2", libres: 4, fijas: [] }]);
    const lugares = porNave.map((codigos) => codigos.reduce((total, code) => total + paradas.find((p) => p.code === code)!.seats, 0));
    expect(Math.max(...lugares)).toBeLessThanOrEqual(4);
    // 10 lugares en 8: queda afuera una reserva entera, la mínima posible.
    expect(sobrantes).toHaveLength(1);
    expect([...porNave.flat(), ...sobrantes].sort()).toEqual(["C1", "C2", "Q1", "Q2"]);
  });

  it("nunca hace un recorrido total más largo que cortar la recorrida única al llenarse cada nave", () => {
    const paradas = [quila("Q1", 1), centro("C1", 1), quila("Q2", 2), centro("C2", 2), centro("C3", 3), quila("Q3", 3), centro("C4", 4)];
    const { porNave } = repartirPorZonas(paradas, [{ id: "t1", libres: 8, fijas: [] }, { id: "t2", libres: 6, fijas: [] }]);
    const orden = ordenarPorRecorrido(paradas, (parada) => parada.pickup).map((parada) => parada.code);
    const corte = [orden.slice(0, 4), orden.slice(4)];
    const total = (naves: string[][]) => naves.reduce((suma, codigos) => suma + largoDe(paradas, codigos), 0);
    expect(total(porNave)).toBeLessThanOrEqual(total(corte));
  });

  it("los pasajeros fijados a mano llevan a su nave hacia su zona", () => {
    const paradas = [centro("C1", 1), quila("Q1", 1)];
    const { porNave } = repartirPorZonas(paradas, [
      { id: "t1", libres: 2, fijas: [quila("fija", 5).pickup] },
      { id: "t2", libres: 2, fijas: [centro("fija", 5).pickup] }
    ]);
    expect(porNave).toEqual([["Q1"], ["C1"]]);
  });

  it("da siempre lo mismo para la misma entrada", () => {
    const paradas = [centro("C1", 1), quila("Q1", 1), centro("C2", 2), quila("Q2", 2)];
    const naves = [{ id: "t1", libres: 4, fijas: [] }, { id: "t2", libres: 4, fijas: [] }];
    expect(repartirPorZonas([...paradas].reverse(), naves)).toEqual(repartirPorZonas(paradas, naves));
  });
});

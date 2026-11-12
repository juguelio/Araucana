import { describe, expect, it } from "vitest";
import { separarVuelosDelSelector } from "./flight-selector";

type V = { id: string; direction: "ARRIVAL" | "DEPARTURE"; bookable: boolean; reason: string | null };

const vuelos: V[] = [
  { id: "a1-llego", direction: "ARRIVAL", bookable: false, reason: "El vuelo ya llegó." },
  { id: "a2", direction: "ARRIVAL", bookable: true, reason: null },
  { id: "d1-salio", direction: "DEPARTURE", bookable: false, reason: "El vuelo ya salió." },
  { id: "a3-lleno", direction: "ARRIVAL", bookable: false, reason: "Sin lugares disponibles para ese vuelo." },
  { id: "d2", direction: "DEPARTURE", bookable: true, reason: null },
  { id: "a4", direction: "ARRIVAL", bookable: true, reason: null }
];

describe("separarVuelosDelSelector", () => {
  it("no mezcla reservables con no reservables y respeta el orden del día", () => {
    const { reservables, noReservables } = separarVuelosDelSelector(vuelos, "ARRIVAL");
    expect(reservables.map((v) => v.id)).toEqual(["a2", "a4"]);
    expect(noReservables.map((v) => v.id)).toEqual(["a1-llego", "a3-lleno"]);
  });

  it("los no reservables siguen disponibles con su motivo", () => {
    const { noReservables } = separarVuelosDelSelector(vuelos, "ARRIVAL");
    expect(noReservables.every((v) => v.reason)).toBe(true);
  });

  it("filtra por el sentido elegido", () => {
    const { reservables, noReservables } = separarVuelosDelSelector(vuelos, "DEPARTURE");
    expect(reservables.map((v) => v.id)).toEqual(["d2"]);
    expect(noReservables.map((v) => v.id)).toEqual(["d1-salio"]);
  });

  it("un día sin vuelos reservables deja la lista principal vacía", () => {
    const pasados = vuelos.filter((v) => !v.bookable);
    const { reservables, noReservables } = separarVuelosDelSelector(pasados, "ARRIVAL");
    expect(reservables).toEqual([]);
    expect(noReservables).toHaveLength(2);
  });
});

import { describe, expect, test } from "vitest";
import {
  addSeatAtPosition,
  getSeatCanvasSize,
  moveSeatToPosition,
  removeSeatAtIndex,
  resizeSeatLayout,
  updateSeatNumber
} from "./seat-layout";

describe("seat layout editing", () => {
  test("moves a seat into an empty row and column", () => {
    expect(
      moveSeatToPosition(
        [
          { number: "01", row: 1, column: 1 },
          { number: "02", row: 1, column: 2 }
        ],
        0,
        2,
        4
      )
    ).toEqual([
      { number: "01", row: 2, column: 4 },
      { number: "02", row: 1, column: 2 }
    ]);
  });

  test("swaps positions when dropping over another seat", () => {
    expect(
      moveSeatToPosition(
        [
          { number: "01", row: 1, column: 1 },
          { number: "02", row: 1, column: 2 }
        ],
        0,
        1,
        2
      )
    ).toEqual([
      { number: "01", row: 1, column: 2 },
      { number: "02", row: 1, column: 1 }
    ]);
  });

  test("updates a seat number inline", () => {
    expect(updateSeatNumber([{ number: "01", row: 1, column: 1 }], 0, " 12 ")).toEqual([
      { number: "12", row: 1, column: 1 }
    ]);
  });

  test("removes a seat without leaving an empty layout", () => {
    expect(removeSeatAtIndex([{ number: "01", row: 1, column: 1 }], 0)).toEqual([{ number: "01", row: 1, column: 1 }]);
    expect(
      removeSeatAtIndex(
        [
          { number: "01", row: 1, column: 1 },
          { number: "02", row: 1, column: 2 }
        ],
        0
      )
    ).toEqual([{ number: "02", row: 1, column: 2 }]);
  });

  test("keeps extra drop space to the right and below the current layout", () => {
    expect(getSeatCanvasSize([{ number: "01", row: 1, column: 1 }])).toEqual({
      rows: 2,
      columns: 5
    });

    expect(getSeatCanvasSize([{ number: "01", row: 2, column: 5 }])).toEqual({
      rows: 3,
      columns: 6
    });
  });

  test("creates a new seat directly at an empty grid position", () => {
    expect(addSeatAtPosition([{ number: "01", row: 1, column: 1 }], 1, 3)).toEqual([
      { number: "01", row: 1, column: 1 },
      { number: "02", row: 1, column: 3 }
    ]);
  });

  test("does not create a duplicate seat when the grid position is occupied", () => {
    expect(addSeatAtPosition([{ number: "01", row: 1, column: 1 }], 1, 1)).toEqual([
      { number: "01", row: 1, column: 1 }
    ]);
  });

  describe("resizeSeatLayout", () => {
    const tres = [
      { number: "01", row: 1, column: 1 },
      { number: "02", row: 1, column: 2 },
      { number: "03", row: 2, column: 1 }
    ];

    test("agranda numerando a continuación y en las columnas que ya usa el plano", () => {
      expect(resizeSeatLayout(tres, 5)).toEqual([
        ...tres,
        { number: "04", row: 2, column: 2 },
        { number: "05", row: 3, column: 1 }
      ]);
    });

    test("achica quitando los últimos por posición", () => {
      expect(resizeSeatLayout(tres, 2)).toEqual([
        { number: "01", row: 1, column: 1 },
        { number: "02", row: 1, column: 2 }
      ]);
    });

    test("no cambia nada si la cantidad es la misma", () => {
      expect(resizeSeatLayout(tres, 3)).toBe(tres);
    });

    test("nunca deja la nave sin asientos", () => {
      expect(resizeSeatLayout(tres, 0)).toHaveLength(1);
      expect(resizeSeatLayout(tres, -4)).toHaveLength(1);
      expect(resizeSeatLayout(tres, Number.NaN)).toBe(tres);
    });

    test("no muta el arreglo original", () => {
      const copia = [...tres];
      resizeSeatLayout(tres, 6);
      resizeSeatLayout(tres, 1);
      expect(tres).toEqual(copia);
    });

    test("una nave de 19 puede quedar en 21 sin huecos repetidos", () => {
      const diecinueve = Array.from({ length: 19 }, (_, index) => ({
        number: String(index + 1).padStart(2, "0"),
        row: Math.floor(index / 4) + 1,
        column: (index % 4) + 1
      }));
      const veintiuno = resizeSeatLayout(diecinueve, 21);
      const posiciones = new Set(veintiuno.map((seat) => `${seat.row}-${seat.column}`));
      expect(veintiuno).toHaveLength(21);
      expect(posiciones.size).toBe(21);
      expect(veintiuno.at(-1)?.number).toBe("21");
    });
  });
});

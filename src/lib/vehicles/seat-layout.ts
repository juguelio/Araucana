import type { VehicleSeat } from "./templates";

const fallbackSeat: VehicleSeat = {
  number: "01",
  row: 1,
  column: 1
};

const minimumCanvasColumns = 5;

function positionMatches(seat: VehicleSeat, row: number, column: number) {
  return seat.row === row && seat.column === column;
}

function nextSeatNumber(seats: VehicleSeat[]) {
  const max = seats.reduce((currentMax, seat) => Math.max(currentMax, Number(seat.number) || 0), 0);
  return String(max + 1).padStart(2, "0");
}

export function moveSeatToPosition(seats: VehicleSeat[], fromIndex: number, row: number, column: number): VehicleSeat[] {
  const movingSeat = seats[fromIndex];

  if (!movingSeat || row < 1 || column < 1) {
    return seats;
  }

  const targetIndex = seats.findIndex((seat, seatIndex) => seatIndex !== fromIndex && positionMatches(seat, row, column));

  return seats.map((seat, seatIndex) => {
    if (seatIndex === fromIndex) {
      return {
        ...seat,
        row,
        column
      };
    }

    if (seatIndex === targetIndex) {
      return {
        ...seat,
        row: movingSeat.row,
        column: movingSeat.column
      };
    }

    return seat;
  });
}

export function updateSeatNumber(seats: VehicleSeat[], index: number, number: string): VehicleSeat[] {
  return seats.map((seat, seatIndex) => (seatIndex === index ? { ...seat, number: number.trim() } : seat));
}

export function removeSeatAtIndex(seats: VehicleSeat[], index: number): VehicleSeat[] {
  const nextSeats = seats.filter((_, seatIndex) => seatIndex !== index);
  return nextSeats.length ? nextSeats : [fallbackSeat];
}

export function getSeatCanvasSize(seats: VehicleSeat[]) {
  const maxRow = seats.reduce((max, seat) => Math.max(max, seat.row), 1);
  const maxColumn = seats.reduce((max, seat) => Math.max(max, seat.column), 1);

  return {
    rows: maxRow + 1,
    columns: Math.max(minimumCanvasColumns, maxColumn + 1)
  };
}

export function addSeatAtPosition(seats: VehicleSeat[], row: number, column: number): VehicleSeat[] {
  if (row < 1 || column < 1 || seats.some((seat) => positionMatches(seat, row, column))) {
    return seats;
  }

  return [
    ...seats,
    {
      number: nextSeatNumber(seats),
      row,
      column
    }
  ];
}

/** Columnas que ya usa el plano: los asientos nuevos van en esas, para no deformar el dibujo. */
function usedColumns(seats: VehicleSeat[]): number[] {
  const columns = [...new Set(seats.map((seat) => seat.column))].sort((a, b) => a - b);
  return columns.length ? columns : [1];
}

/** Primera posición libre del plano, recorriendo fila por fila las columnas que ya se usan. */
function nextFreePosition(seats: VehicleSeat[]): { row: number; column: number } {
  const columns = usedColumns(seats);
  let row = 1;

  for (;;) {
    for (const column of columns) {
      if (!seats.some((seat) => positionMatches(seat, row, column))) {
        return { row, column };
      }
    }

    row += 1;
  }
}

/**
 * Deja el plano con exactamente `target` asientos.
 *
 * La capacidad no es una columna: es la cantidad de filas de `Seat`. Antes el único camino era
 * agregar y quitar de a uno en el dibujo, y el campo «Capacidad» del formulario era de sólo lectura
 * (y mostraba la capacidad de la plantilla, no la real).
 *
 * Al agrandar, los asientos nuevos se numeran a continuación y ocupan los huecos del plano. Al
 * achicar se van los últimos por posición; el servidor rechaza el guardado si alguno tiene reservas.
 */
export function resizeSeatLayout(seats: VehicleSeat[], target: number): VehicleSeat[] {
  const total = Number.isFinite(target) ? Math.floor(target) : seats.length;
  const wanted = Math.max(1, total);

  if (wanted === seats.length) {
    return seats;
  }

  if (wanted < seats.length) {
    const ordered = [...seats].sort((a, b) => a.row - b.row || a.column - b.column || a.number.localeCompare(b.number));
    return ordered.slice(0, wanted);
  }

  const next = [...seats];

  while (next.length < wanted) {
    const position = nextFreePosition(next);
    next.push({ number: nextSeatNumber(next), ...position });
  }

  return next;
}

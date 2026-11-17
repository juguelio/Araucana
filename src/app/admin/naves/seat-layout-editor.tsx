"use client";

import { useMemo, useState } from "react";
import {
  addSeatAtPosition,
  getSeatCanvasSize,
  moveSeatToPosition,
  removeSeatAtIndex,
  resizeSeatLayout,
  updateSeatNumber
} from "@/lib/vehicles/seat-layout";
import { toggleLayoutMarker, type VehicleLayoutMarker } from "@/lib/vehicles/layout-markers";
import { type VehicleSeat } from "@/lib/vehicles/templates";

type SeatLayoutEditorProps = {
  initialSeats: VehicleSeat[];
  initialLayoutMarkers?: VehicleLayoutMarker[];
};

const blankSeat: VehicleSeat = {
  number: "01",
  row: 1,
  column: 1
};

function seatsToJson(seats: VehicleSeat[]) {
  return JSON.stringify(seats);
}

function markersToJson(markers: VehicleLayoutMarker[]) {
  return JSON.stringify(markers);
}

function markerMatches(marker: VehicleLayoutMarker, type: VehicleLayoutMarker["type"], row: number, column: number) {
  return marker.type === type && marker.row === row && marker.column === column;
}

export function SeatLayoutEditor({ initialSeats, initialLayoutMarkers = [] }: SeatLayoutEditorProps) {
  const [seats, setSeats] = useState<VehicleSeat[]>(initialSeats.length ? initialSeats : [blankSeat]);
  const [draggedSeatIndex, setDraggedSeatIndex] = useState<number | null>(null);
  const [activeEmptyCell, setActiveEmptyCell] = useState<string | null>(null);
  const [layoutMarkers, setLayoutMarkers] = useState<VehicleLayoutMarker[]>(initialLayoutMarkers);
  // Mientras se escribe la cantidad, el input manda; si no, muestra el total real del plano.
  const [capacityDraft, setCapacityDraft] = useState<string | null>(null);
  const serializedSeats = useMemo(() => seatsToJson(seats), [seats]);
  const serializedLayoutMarkers = useMemo(() => markersToJson(layoutMarkers), [layoutMarkers]);
  const { rows, columns } = getSeatCanvasSize(seats);

  function applyCapacity() {
    if (capacityDraft === null) {
      return;
    }

    const target = Number(capacityDraft);

    if (!Number.isFinite(target) || target < 1) {
      setCapacityDraft(null);
      return;
    }

    setSeats((currentSeats) => resizeSeatLayout(currentSeats, target));
    setCapacityDraft(null);
  }

  function updateSeat(index: number, value: string) {
    setSeats((currentSeats) => updateSeatNumber(currentSeats, index, value));
  }

  function removeSeat(index: number) {
    setSeats((currentSeats) => removeSeatAtIndex(currentSeats, index));
  }

  function moveSeat(row: number, column: number) {
    if (draggedSeatIndex === null) {
      return;
    }

    setSeats((currentSeats) => moveSeatToPosition(currentSeats, draggedSeatIndex, row, column));
    setLayoutMarkers((currentMarkers) =>
      currentMarkers.filter((marker) => !markerMatches(marker, "AISLE", row, column))
    );
    setDraggedSeatIndex(null);
    setActiveEmptyCell(null);
  }

  function createSeat(row: number, column: number) {
    setSeats((currentSeats) => addSeatAtPosition(currentSeats, row, column));
    setLayoutMarkers((currentMarkers) =>
      currentMarkers.filter((marker) => !markerMatches(marker, "AISLE", row, column))
    );
    setActiveEmptyCell(null);
  }

  function markAisle(row: number, column: number) {
    setLayoutMarkers((currentMarkers) => toggleLayoutMarker(currentMarkers, { type: "AISLE", row, column }));
    setActiveEmptyCell(null);
  }

  function toggleDoor(row: number, side: "left" | "right") {
    setLayoutMarkers((currentMarkers) =>
      toggleLayoutMarker(currentMarkers, { type: "DOOR", row, column: side === "left" ? 0 : -1 })
    );
    setActiveEmptyCell(null);
  }

  function autoNumber() {
    setSeats((currentSeats) =>
      [...currentSeats]
        .sort((a, b) => a.row - b.row || a.column - b.column)
        .map((seat, index) => ({
          ...seat,
          number: String(index + 1).padStart(2, "0")
        }))
    );
  }

  return (
    <div className="seat-layout-editor span-2">
      <input type="hidden" name="seats" value={serializedSeats} />
      <input type="hidden" name="layoutMarkers" value={serializedLayoutMarkers} />
      <div className="seat-layout-head">
        <div>
          <span>Distribucion editable</span>
          <strong>{seats.length} asientos</strong>
        </div>
        <div className="table-actions">
          <label className="seat-capacity-field">
            Cantidad de asientos
            <input
              aria-label="Cantidad de asientos"
              inputMode="numeric"
              max={60}
              min={1}
              type="number"
              value={capacityDraft ?? String(seats.length)}
              onBlur={applyCapacity}
              onChange={(event) => setCapacityDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyCapacity();
                }
              }}
            />
          </label>
          <button className="ghost-button" type="button" onClick={autoNumber}>
            Autonumerar
          </button>
        </div>
      </div>
      <div className="vehicle-layout-grid">
        <div className="vehicle-door-rail left" aria-label="Puertas lado izquierdo">
          {Array.from({ length: rows }, (_, index) => {
            const row = index + 1;
            const hasDoor = layoutMarkers.some((marker) => markerMatches(marker, "DOOR", row, 0));

            return (
              <button
                aria-label={`${hasDoor ? "Quitar" : "Agregar"} puerta en fila ${row}`}
                className={`vehicle-door-cell ${hasDoor ? "active" : ""}`}
                key={`door-${row}`}
                type="button"
                onClick={() => toggleDoor(row, "left")}
              >
                {hasDoor ? "Puerta" : "+"}
              </button>
            );
          })}
        </div>
        <div
          className="vehicle-seat-map"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(68px, 1fr))` }}
        >
          {Array.from({ length: rows * columns }, (_, index) => {
            const row = Math.floor(index / columns) + 1;
            const column = (index % columns) + 1;
            const seatIndex = seats.findIndex((item) => item.row === row && item.column === column);
            const seat = seatIndex >= 0 ? seats[seatIndex] : null;
            const cellKey = `${row}-${column}`;
            const isActiveEmptyCell = activeEmptyCell === cellKey;
            const isMarkedAisle = layoutMarkers.some((marker) => markerMatches(marker, "AISLE", row, column));
            const hasSeatBefore = seats.some((item) => item.row === row && item.column < column);
            const hasSeatAfter = seats.some((item) => item.row === row && item.column > column);

            return seat ? (
              <div
                className="vehicle-seat-chip"
                draggable
                key={`${row}-${column}`}
                onDragEnd={() => setDraggedSeatIndex(null)}
                onDragOver={(event) => event.preventDefault()}
                onDragStart={() => setDraggedSeatIndex(seatIndex)}
                onDrop={() => moveSeat(row, column)}
              >
                <span className="vehicle-seat-drag" aria-hidden="true">Mover</span>
                <label>
                  <span>Numero</span>
                  <input
                    aria-label={`Numero de asiento ${seat.number}`}
                    value={seat.number}
                    onChange={(event) => updateSeat(seatIndex, event.target.value)}
                  />
                </label>
                <button
                  aria-label={`Borrar asiento ${seat.number}`}
                  className="seat-delete-button"
                  type="button"
                  onClick={() => removeSeat(seatIndex)}
                >
                  ×
                </button>
              </div>
            ) : (
              <div
                className={`vehicle-seat-gap ${isActiveEmptyCell ? "active" : ""} ${isMarkedAisle ? "marked" : ""}`}
                aria-label="Casillero vacio"
                key={`${row}-${column}`}
                onDragOver={(event) => event.preventDefault()}
                onClick={() => setActiveEmptyCell((currentCell) => (currentCell === cellKey ? null : cellKey))}
                onDrop={() => moveSeat(row, column)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveEmptyCell((currentCell) => (currentCell === cellKey ? null : cellKey));
                  }
                }}
                role="button"
                tabIndex={0}
              >
                {isActiveEmptyCell ? (
                  <span className="empty-seat-actions">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        createSeat(row, column);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          createSeat(row, column);
                        }
                      }}
                    >
                      Asiento
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        markAisle(row, column);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          markAisle(row, column);
                        }
                      }}
                    >
                      Pasillo
                    </span>
                  </span>
                ) : isMarkedAisle || (hasSeatBefore && hasSeatAfter) ? (
                  "Pasillo"
                ) : (
                  "+"
                )}
              </div>
            );
          })}
        </div>
        <div className="vehicle-door-rail right" aria-label="Puertas lado derecho">
          {Array.from({ length: rows }, (_, index) => {
            const row = index + 1;
            const hasDoor = layoutMarkers.some((marker) => markerMatches(marker, "DOOR", row, -1));

            return (
              <button
                aria-label={`${hasDoor ? "Quitar" : "Agregar"} puerta derecha en fila ${row}`}
                className={`vehicle-door-cell ${hasDoor ? "active" : ""}`}
                key={`door-right-${row}`}
                type="button"
                onClick={() => toggleDoor(row, "right")}
              >
                {hasDoor ? "Puerta" : "+"}
              </button>
            );
          })}
        </div>
      </div>
      <p className="seat-layout-help">
        Toca un casillero vacio para crear un asiento o marcar pasillo. Los cuadrados chicos de los costados marcan
        puertas en los limites de la nave.
      </p>
    </div>
  );
}

import { describe, expect, it } from "vitest";
import { airportServiceWindow } from "./service-window";

const at = (time: string) => new Date(`2026-11-20T${time}:00-03:00`);

describe("airportServiceWindow: el tramo en que la combi y su chofer están con el vuelo", () => {
  it("una partida va del inicio estimado de la recorrida (2 h 30 antes) hasta el vuelo", () => {
    expect(airportServiceWindow({ direction: "DEPARTURE", scheduledAt: at("14:00") })).toEqual({ startsAt: at("11:30"), endsAt: at("14:00") });
  });

  it("una partida con recorrida coordinada arranca a esa hora y termina con la hora estimada del vuelo", () => {
    expect(airportServiceWindow({ direction: "DEPARTURE", scheduledAt: at("14:00"), estimatedAt: at("15:00"), pickupStartOverrideAt: at("12:00") }))
      .toEqual({ startsAt: at("12:00"), endsAt: at("15:00") });
  });

  it("un arribo va de media hora antes del aterrizaje (estimado si lo hay) hasta terminar el reparto", () => {
    expect(airportServiceWindow({ direction: "ARRIVAL", scheduledAt: at("14:00"), estimatedAt: at("14:40") })).toEqual({ startsAt: at("14:10"), endsAt: at("16:40") });
  });
});

import { describe, expect, it } from "vitest";
import { mapStatus, normalizeSchedules } from "./provider";

const ts = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const fila = (over: Record<string, unknown>) => ({
  flight_iata: "LA8366", airline_iata: "LA", dep_iata: "AEP", arr_iata: "CPC",
  arr_time_ts: ts("2026-10-16T17:50:00Z"), dep_time_ts: ts("2026-10-16T15:25:00Z"),
  arr_estimated_ts: ts("2026-10-16T18:45:00Z"), arr_delayed: 55, status: "scheduled",
  ...over
});

describe("conector AirLabs", () => {
  it("normaliza un arribo con demora", () => {
    const [v] = normalizeSchedules([fila({})], "ARRIVAL");
    expect(v.number).toBe("LA8366");
    expect(v.origin).toBe("AEP");
    expect(v.direction).toBe("ARRIVAL");
    expect(v.scheduledAt.toISOString()).toBe("2026-10-16T17:50:00.000Z");
    expect(v.estimatedAt?.toISOString()).toBe("2026-10-16T18:45:00.000Z");
    expect(v.status).toBe("DELAYED");
  });

  it("mapea estados", () => {
    expect(mapStatus("cancelled", null)).toBe("CANCELLED");
    expect(mapStatus("diverted", null)).toBe("DIVERTED");
    expect(mapStatus("landed", 10)).toBe("LANDED");
    expect(mapStatus("active", null)).toBe("SCHEDULED");
    expect(mapStatus("active", 45)).toBe("DELAYED");
    expect(mapStatus("scheduled", 10)).toBe("SCHEDULED");
  });

  it("deduplica el mismo vuelo por código compartido", () => {
    const comun = { dep_iata: "AEP", arr_time_ts: ts("2026-10-16T17:50:00Z") };
    const vuelos = normalizeSchedules(
      [fila({ ...comun, flight_iata: "JA3183", cs_flight_iata: "WJ3183" }), fila({ ...comun, flight_iata: "WJ3183" })],
      "ARRIVAL"
    );
    expect(vuelos).toHaveLength(1);
  });

  it("ignora filas sin número o sin horario", () => {
    expect(normalizeSchedules([fila({ flight_iata: null }), fila({ arr_time_ts: null })], "ARRIVAL")).toHaveLength(0);
  });

  it("ordena por horario y usa la salida para el destino", () => {
    const vuelos = normalizeSchedules(
      [fila({ arr_time_ts: ts("2026-10-16T20:00:00Z") }), fila({ arr_time_ts: ts("2026-10-16T15:00:00Z"), flight_iata: "AR1656" })],
      "ARRIVAL"
    );
    expect(vuelos.map((v) => v.number)).toEqual(["AR1656", "LA8366"]);
  });
});

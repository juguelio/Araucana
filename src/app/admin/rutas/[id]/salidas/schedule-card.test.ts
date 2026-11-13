import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/admin", () => ({ getCurrentAdminOrRedirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/special-trips/conflicts", () => ({ fleetConflicts: vi.fn(), lockFleet: vi.fn(), savePublicSchedule: vi.fn() }));

import { ScheduleCard, scheduleVehicleOptions, statusLabel, type CalendarSchedule } from "./schedule-card";

const salida = {
  id: "s1",
  vehicleId: "v1",
  vehicleName: "Bus Grande",
  vehiclePlate: "AE 123 AR",
  vehicleInternalNumber: "1910",
  availableSeats: 12,
  totalSeats: 40,
  status: "OPEN"
};

const flota = [
  { id: "v1", name: "Bus Grande", licensePlate: "AE 123 AR", internalNumber: "1910" },
  { id: "v2", name: "Combi 2", licensePlate: null, internalNumber: "243" },
  { id: "v3", name: "Combi 3", licensePlate: "AF 456 CD", internalNumber: null }
];

function render(extra: Partial<CalendarSchedule> = {}) {
  return renderToStaticMarkup(
    createElement(ScheduleCard, { schedule: { ...salida, ...extra }, routeId: "r1", vehicles: flota, timeLabel: "09:00" })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tarjeta de salida en el calendario (issue #81)", () => {
  it("muestra la nave asignada con interno y patente, no sólo la hora y el cupo", () => {
    const html = render();
    expect(html).toContain("09:00");
    expect(html).toContain("12/40");
    expect(html).toContain("Bus Grande");
    expect(html).toContain("Interno 1910 · AE 123 AR");
    expect(html).toContain("Abierta");
  });

  it("ofrece cambiar la nave desde la misma tarjeta con la nave actual elegida", () => {
    const html = render();
    expect(html).toContain('name="vehicleId"');
    expect(html).toContain("Cambiar nave");
    // La opción de la nave asignada queda seleccionada por defecto.
    expect(html).toMatch(/<option value="v1"[^>]*selected=""[^>]*>Bus Grande · Interno 1910 · AE 123 AR<\/option>/);
    expect(html).toContain('<option value="v2">Combi 2 · Interno 243</option>');
  });

  it("sigue mostrando la nave aunque haya quedado inactiva", () => {
    const html = render({ vehicleId: "v9", vehicleName: "Bus Viejo", vehiclePlate: null, vehicleInternalNumber: "900" });
    expect(html).toContain("Bus Viejo");
    expect(html).toContain("Bus Viejo (inactiva)");
    expect(html).toContain('value="v9" selected=""');
  });

  it("no agrega la opción «inactiva» cuando la nave está en la flota activa", () => {
    expect(scheduleVehicleOptions(salida, flota)).toBe(flota);
    expect(scheduleVehicleOptions({ ...salida, vehicleId: "v9", vehicleName: "Bus Viejo" }, flota)[0])
      .toEqual({ id: "v9", name: "Bus Viejo (inactiva)", licensePlate: "AE 123 AR", internalNumber: "1910" });
    // Una nave inactiva sin patente cargada mantiene el null, no lo convierte en texto.
    expect(scheduleVehicleOptions({ ...salida, vehicleId: "v9", vehicleName: "Bus Viejo", vehiclePlate: null }, flota)[0])
      .toMatchObject({ licensePlate: null });
  });

  it("traduce los estados de la salida", () => {
    expect(statusLabel("OPEN")).toBe("Abierta");
    expect(statusLabel("DOCUMENTATION")).toBe("Documentación");
    expect(statusLabel("CLOSED")).toBe("Cerrada");
    expect(statusLabel("RARO")).toBe("RARO");
  });
});

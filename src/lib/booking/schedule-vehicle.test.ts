import { describe, expect, it } from "vitest";
import { vehicleConflictNotice, vehicleDetails, vehicleLabel } from "./schedule-vehicle";

describe("etiqueta de nave de una salida", () => {
  it("muestra el nombre solo cuando la ficha no tiene interno ni patente", () => {
    expect(vehicleDetails({ name: "Combi 1" })).toBe("");
    expect(vehicleLabel({ name: "Combi 1" })).toBe("Combi 1");
    expect(vehicleLabel({ name: "Combi 1", licensePlate: "", internalNumber: null })).toBe("Combi 1");
  });

  it("suma interno y patente en el orden que usa la planilla del cliente", () => {
    expect(vehicleLabel({ name: "Bus Grande", internalNumber: "1910", licensePlate: "AE 123 AR" }))
      .toBe("Bus Grande · Interno 1910 · AE 123 AR");
    expect(vehicleLabel({ name: "Combi 2", internalNumber: "243" })).toBe("Combi 2 · Interno 243");
    expect(vehicleLabel({ name: "Combi 3", licensePlate: "AF 456 CD" })).toBe("Combi 3 · AF 456 CD");
  });

  it("avisa el choque con las etiquetas de los conflictos, sin repetir", () => {
    const notice = vehicleConflictNotice([
      { label: "Servicio público · SMA → Junín" },
      { label: "Viajes especiales · Hotel Loi Suites" },
      { label: "Servicio público · SMA → Junín" }
    ]);
    expect(notice).toContain("No se cambió la nave");
    expect(notice).toContain("Servicio público · SMA → Junín; Viajes especiales · Hotel Loi Suites");
    expect(notice.match(/Servicio público/g)).toHaveLength(1);
  });
});

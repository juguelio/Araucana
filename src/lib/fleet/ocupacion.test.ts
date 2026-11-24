import { describe, expect, it } from "vitest";
import { ocupacionEnVentana, ordenDeOpcion, type Ocupacion } from "./ocupacion";

const t = (hhmm: string, dia = "2026-11-28") => new Date(`${dia}T${hhmm}:00-03:00`);

// Sábado 28-nov con las salidas reales de Traful: ida 10:00 → 12:15 con la 12 y su chofer.
const ida: Ocupacion = {
  clave: "salida:ida",
  vehicleIds: ["nave-12"],
  driverIds: ["chofer-a"],
  desde: t("10:00"),
  hasta: t("12:15"),
  etiqueta: "Servicio público 10:00 · San Martín → Villa Traful",
  posible: false
};
const vuelo: Ocupacion = {
  clave: "vuelo:AR1659",
  vehicleIds: ["nave-14"],
  driverIds: ["chofer-b"],
  desde: t("11:30"),
  hasta: t("13:00"),
  etiqueta: "Aeropuerto 11:30–13:00 · AR1659",
  posible: true
};
const cerro: Ocupacion = {
  clave: "chapelco:d1",
  vehicleIds: ["nave-12"],
  driverIds: [],
  desde: t("00:00"),
  hasta: t("00:00", "2026-11-29"),
  etiqueta: "Chapelco, todo el día",
  posible: true
};

describe("ocupacionEnVentana: quién está libre a la hora del servicio (24-nov)", () => {
  it("una salida que se superpone ocupa la nave y el chofer", () => {
    const ventana = { desde: t("11:00"), hasta: t("12:30") };
    expect(ocupacionEnVentana([ida], "nave", ventana)).toEqual({ "nave-12": { estado: "ocupada", detalle: "Servicio público 10:00 · San Martín → Villa Traful" } });
    expect(ocupacionEnVentana([ida], "chofer", ventana)).toEqual({ "chofer-a": { estado: "ocupada", detalle: "Servicio público 10:00 · San Martín → Villa Traful" } });
  });

  it("lo que termina justo cuando empieza el otro no choca", () => {
    expect(ocupacionEnVentana([ida], "nave", { desde: t("12:15"), hasta: t("14:00") })).toEqual({});
  });

  it("aeropuerto y Chapelco se marcan como posible cruce", () => {
    const r = ocupacionEnVentana([vuelo], "nave", { desde: t("12:00"), hasta: t("14:00") });
    expect(r["nave-14"]).toEqual({ estado: "posible", detalle: "Aeropuerto 11:30–13:00 · AR1659" });
  });

  it("un cruce seguro le gana a uno posible y los demás se cuentan", () => {
    const r = ocupacionEnVentana([cerro, ida], "nave", { desde: t("10:30"), hasta: t("11:00") });
    expect(r["nave-12"]).toEqual({ estado: "ocupada", detalle: "Servicio público 10:00 · San Martín → Villa Traful y más" });
  });

  it("el propio servicio no cuenta como cruce", () => {
    expect(ocupacionEnVentana([ida], "nave", { desde: t("10:00"), hasta: t("12:15") }, ["salida:ida"])).toEqual({});
  });

  it("orden: la asignada primero, después libres, posibles y ocupadas", () => {
    const ocupacion = { a: { estado: "ocupada" as const, detalle: "x" }, b: { estado: "posible" as const, detalle: "y" } };
    const ids = ["a", "b", "c", "d"].sort((x, y) => ordenDeOpcion(x, "d", ocupacion) - ordenDeOpcion(y, "d", ocupacion));
    expect(ids).toEqual(["d", "c", "b", "a"]);
  });
});

describe("tituloDeNave", () => {
  it("una nave que se llama como su interno se muestra «Interno N»", async () => {
    const { tituloDeNave } = await import("./titulo-de-nave");
    expect(tituloDeNave({ name: "12", internalNumber: "12" })).toBe("Interno 12");
    expect(tituloDeNave({ name: "Araucana 24", internalNumber: null })).toBe("Araucana 24");
    expect(tituloDeNave({ name: "Sprinter 196", internalNumber: "196" })).toBe("Sprinter 196");
  });
});

import { expect, it } from "vitest";
import { clavesDeServicio, clavesDeServicioGuardado, normalizarNombre, turnoParaClave } from "./import-key";

const choferes = new Map([
  ["u-cristian", "Cristian"],
  ["u-nilda", "Nilda"]
]);
const idPorNombre = (nombre: string) => {
  for (const [id, name] of choferes) if (normalizarNombre(name) === normalizarNombre(nombre)) return id;
  return null;
};
const nombrePorId = (id: string) => choferes.get(id) ?? null;

/** Fila tal como la dejó la importación anterior a #405: `driver`/`companion`, turno normalizado. */
const filaVieja = {
  serviceDate: new Date("2026-11-02T00:00:00.000Z"),
  routeName: "Especial 18 VLA",
  shift: "Jornada completa",
  driverId: "u-cristian",
  companion: "Cintia",
  source: { row: 17, sheet: "021126", shift: "full day", driver: "Cristian", vehicle: "15", companion: "Cintia" }
};

it("reconoce la fila vieja (`driver`/`companion`, «full day») contra la de la planilla (`driver1`/`driver2`)", () => {
  const guardada = clavesDeServicioGuardado(filaVieja, { idPorNombre, nombrePorId });
  const planilla = clavesDeServicio({
    serviceDate: new Date("2026-11-02T00:00:00.000Z"),
    routeName: "Especial 18 VLA",
    shift: "full day",
    chofer1: { id: "u-cristian", nombre: "Cristian" },
    chofer2: { nombre: "Cintia" }
  });
  expect(planilla.some((clave) => guardada.includes(clave))).toBe(true);
});

it("también las reconoce cuando la planilla no resuelve el usuario y sólo hay nombre", () => {
  const guardada = clavesDeServicioGuardado({ ...filaVieja, driverId: null }, { idPorNombre, nombrePorId });
  const planilla = clavesDeServicio({
    serviceDate: "2026-11-02",
    routeName: "Especial 18 VLA",
    shift: "Full Day",
    chofer1: { nombre: "cristián" },
    chofer2: { nombre: "CINTIA" }
  });
  expect(planilla.some((clave) => guardada.includes(clave))).toBe(true);
});

it("no confunde dos servicios del mismo día, recorrido y turno con choferes distintos", () => {
  const cristian = clavesDeServicio({
    serviceDate: "2026-11-02",
    routeName: "Especial 18 VLA",
    shift: "Jornada completa",
    chofer1: { id: "u-cristian", nombre: "Cristian" },
    chofer2: { nombre: "Cintia" }
  });
  const nilda = clavesDeServicio({
    serviceDate: "2026-11-02",
    routeName: "Especial 18 VLA",
    shift: "Jornada completa",
    chofer1: { id: "u-nilda", nombre: "Nilda" },
    chofer2: { nombre: "Eve" }
  });
  expect(cristian.some((clave) => nilda.includes(clave))).toBe(false);
});

it("no confunde recorridos distintos ni horarios explícitos distintos", () => {
  const base = { serviceDate: "2026-11-02", routeName: "Primaria 111", shift: "08:00", chofer1: { id: "u-nilda", nombre: "Nilda" }, chofer2: {} };
  const otraRuta = clavesDeServicio({ ...base, routeName: "Primaria 113" });
  const otroHorario = clavesDeServicio({ ...base, shift: "16:30" });
  const propia = clavesDeServicio(base);
  expect(propia.some((clave) => otraRuta.includes(clave))).toBe(false);
  expect(propia.some((clave) => otroHorario.includes(clave))).toBe(false);
});

it("un servicio sin chofer se reconoce por fecha, recorrido y turno", () => {
  const guardada = clavesDeServicioGuardado({
    serviceDate: "2026-11-05",
    routeName: "Laboral",
    shift: "Jornada completa",
    driverId: null,
    source: { driver: "", companion: "" }
  });
  const planilla = clavesDeServicio({
    serviceDate: "2026-11-05",
    routeName: "Laboral",
    shift: "full day",
    chofer1: { nombre: "" },
    chofer2: { nombre: "" }
  });
  expect(planilla).toEqual(guardada);
});

it("normaliza turnos equivalentes y acentos", () => {
  expect(turnoParaClave("Full Day")).toBe("jornada completa");
  expect(turnoParaClave("JORNADA COMPLETA")).toBe("jornada completa");
  expect(turnoParaClave("Mañana")).toBe(turnoParaClave("manana"));
  expect(turnoParaClave("tarde")).toBe("tarde");
  expect(turnoParaClave("08:00")).toBe("08:00");
});

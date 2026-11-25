import { describe, expect, it } from "vitest";
import type { ServicioApp } from "@/lib/driver/jornada-app-types";
import type { MarcaWeb } from "./almacen";
import { admiteGPSManual, claveServicio, copiaParaGuardar, marcasFila, objetivoGPS } from "./estado-jornada";

const turno: ServicioApp = {
  id: "salida-1", fecha: "2026-11-25", titulo: "Terminal → Lago", tipo: "Servicio Público",
  nave: { id: "n1", nombre: "Combi", interno: null, patente: null }, origen: "Terminal",
  salida: "2026-11-25T23:30:00-03:00", fin: "2026-11-26T01:00:00-03:00",
  paradas: ["Terminal", "Lago"], indicaciones: ["Bajar en el muelle"],
  filas: [{ id: "r1", nombre: "Reserva", detalle: "", cantidad: 3, telefono: null }],
  compartida: true, comprobante: "firma-con-filas"
};
const continuacion = { ...turno, fecha: "2026-11-26" };
const sinHorario = { ...turno, id: "concesion-2", fin: null };

describe("GPS del chofer", () => {
  it("respeta el inicio, el fin y el cambio de fecha de la Argentina", () => {
    const asignaciones = [turno, continuacion];
    expect(objetivoGPS(asignaciones, Date.parse(turno.salida!) - 1, null).servicio).toBeNull();
    expect(objetivoGPS(asignaciones, Date.parse(turno.salida!), null).servicio).toBe(turno);
    expect(objetivoGPS(asignaciones, Date.parse("2026-11-26T00:00:00-03:00"), null).servicio).toBe(continuacion);
    expect(objetivoGPS(asignaciones, Date.parse(turno.fin!), null).servicio).toBeNull();
  });
  it("suspende el GPS si dos naves tienen el mismo horario", () => {
    const otra = { ...turno, nave: { ...turno.nave!, id: "n2" } };
    const gps = objetivoGPS([turno, otra], Date.parse(turno.salida!), null);
    expect(gps.conflicto).toBe(true);
    expect(gps.servicio).toBeNull();
  });
  it("sólo comparte sin franja al solicitarlo dentro de los límites conocidos del día", () => {
    const ahora = Date.parse(turno.salida!);
    expect(admiteGPSManual(sinHorario, ahora - 1)).toBe(false);
    expect(objetivoGPS([sinHorario], ahora, null).servicio).toBeNull();
    expect(objetivoGPS([sinHorario], ahora, claveServicio(sinHorario))).toMatchObject({ servicio: sinHorario, manual: true });
    expect(admiteGPSManual(sinHorario, Date.parse("2026-11-26T00:00:00-03:00"))).toBe(false);
    expect(admiteGPSManual({ ...sinHorario, nave: null }, ahora)).toBe(false);
    expect(admiteGPSManual(turno, ahora)).toBe(false);
  });
});

describe("hojas y embarques", () => {
  const marca: MarcaWeb = { fecha: turno.fecha, id: "b", at: turno.salida!, servicioId: turno.id, vehicleId: "n1",
    tipo: "embarque", filaId: "r1", cantidad: 1, driverId: "chofer1", estado: "guardada" };
  it("distingue sin informar de ausente y sólo agrega la última corrección de cada unidad", () => {
    expect(marcasFila([], turno, "r1").propia).toBeUndefined();
    const marcas: MarcaWeb[] = [marca, { ...marca, id: "a", cantidad: 0, at: "2026-11-26T02:31:00Z", estado: "pendiente" },
      { ...marca, vehicleId: "n2", id: "c", cantidad: 2 }, { ...marca, vehicleId: "n2", id: "d", cantidad: 3, estado: "revision" },
      { ...marca, id: "e", fecha: "2026-11-26", cantidad: 3 }];
    expect(marcasFila(marcas, turno, "r1")).toMatchObject({ propia: { cantidad: 0 }, enOtras: 2 });
    expect(marcasFila(marcas, continuacion, "r1")).toMatchObject({ propia: { cantidad: 3 }, enOtras: 0 });
  });
  it("mantiene datos operativos completos sólo en hojas descargadas", () => {
    const copia = { jornada: { fecha: turno.fecha, servicios: [turno, continuacion] }, sincronizada: turno.salida!, marcas: [], hojas: [claveServicio(turno)] };
    const [hoy, futura] = copiaParaGuardar(copia).jornada.servicios;
    expect(hoy).toEqual(turno);
    expect(futura).toMatchObject({ titulo: turno.titulo, fecha: continuacion.fecha, filas: [], paradas: [], indicaciones: [], comprobante: undefined });
    expect(continuacion.filas).toHaveLength(1);
  });
  it("una actualización conserva hojas abiertas en otra pestaña y elimina asignaciones retiradas", () => {
    const vigente = { jornada: { fecha: turno.fecha, servicios: [turno, continuacion] },
      sincronizada: "2026-11-25T22:50:00Z", marcas: [], hojas: [claveServicio(turno)] };
    const previa = { ...vigente, hojas: [claveServicio(continuacion)], sincronizada: turno.salida! };
    const cache = copiaParaGuardar(vigente, previa);
    expect(cache.jornada.servicios.map(s => s.filas.length)).toEqual([1, 1]);
    expect(cache.hojas).toHaveLength(2);
    const retiro = copiaParaGuardar({ ...vigente, sincronizada: "2026-11-26T12:00:00Z", jornada: { ...vigente.jornada, servicios: [turno] } }, cache);
    expect(retiro.hojas).toEqual([claveServicio(turno)]);
    expect(retiro.jornada.servicios).toEqual([turno]);
  });
});

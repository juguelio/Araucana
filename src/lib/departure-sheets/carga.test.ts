import { describe, expect, it } from "vitest";
import { camposParaElSiguiente, documentoEnmascarado, mismoNombre, nombreParaLista, progresoDeCarga, type PasajeroDeLaLista } from "./carga";

const p = (id: string, lastName: string, firstName: string): PasajeroDeLaLista => ({
  id, position: Number(id), nombre: nombreParaLista(lastName, firstName), firstName, lastName, documento: "DNI •••123", nationality: "Argentina"
});

describe("mismoNombre", () => {
  const lista = [p("1", "Pérez", "Ana María"), p("2", "Gómez", "Luis")];

  it("encuentra el mismo nombre sin importar tildes, mayúsculas ni espacios", () => {
    expect(mismoNombre(lista, "  PEREZ ", "ana   maría")?.id).toBe("1");
    expect(mismoNombre(lista, "gomez", "Luis")?.id).toBe("2");
  });

  it("no avisa con nombres distintos ni a medio escribir", () => {
    expect(mismoNombre(lista, "Pérez", "Ana")).toBeNull();
    expect(mismoNombre(lista, "P", "Ana María")).toBeNull();
    expect(mismoNombre(lista, "Pérez", "")).toBeNull();
  });
});

describe("progresoDeCarga", () => {
  it("con la cantidad del viaje dice cuántos van y cuántos faltan", () => {
    expect(progresoDeCarga(12, 30)).toEqual({ texto: "12 de 30 cargados", detalle: "Faltan 18", porcentaje: 40, completa: false });
    expect(progresoDeCarga(29, 30).detalle).toBe("Falta 1");
    expect(progresoDeCarga(30, 30)).toMatchObject({ detalle: "Están todos", porcentaje: 100, completa: true });
    expect(progresoDeCarga(32, 30)).toMatchObject({ detalle: "2 más de los 30 del viaje", porcentaje: 100 });
  });

  it("sin la cantidad del viaje sólo cuenta", () => {
    expect(progresoDeCarga(1, null)).toEqual({ texto: "1 pasajero cargado", detalle: null, porcentaje: null, completa: false });
    expect(progresoDeCarga(0, 0).texto).toBe("0 pasajeros cargados");
  });
});

describe("lo que se repite y cómo se muestra", () => {
  it("guarda tipo de documento, nacionalidad y país de residencia para el siguiente", () => {
    const form = new FormData();
    form.set("lastName", "Pérez");
    form.set("documentType", "PASAPORTE");
    form.set("nationality", "Chile");
    form.set("residenceCountry", " ");
    expect(camposParaElSiguiente(form)).toEqual({ documentType: "PASAPORTE", nationality: "Chile" });
  });

  it("nombre con el apellido en mayúsculas y documento enmascarado", () => {
    expect(nombreParaLista(" pérez ", "Ana")).toBe("PÉREZ, Ana");
    expect(nombreParaLista("Pérez", "")).toBe("PÉREZ");
    expect(documentoEnmascarado("DNI", "30123456")).toBe("DNI •••••456");
    expect(documentoEnmascarado("DNI", "12")).toBe("DNI •••");
  });
});

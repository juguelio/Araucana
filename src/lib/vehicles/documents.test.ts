import { describe, expect, it } from "vitest";
import {
  DOCUMENTO_MAX_BYTES,
  documentosPorTipo,
  documentosVigentes,
  errorDeDocumento,
  fechaDePapel,
  fechaDeVencimientoDelPapel,
  firmaDeArchivoValida,
  esTipoDeDocumento
} from "./documents";

const doc = (kind: string, dia: number) => ({ kind, createdAt: new Date(Date.UTC(2026, 10, dia)) });

describe("documentación de la flota", () => {
  it("acepta los papeles que gestiona la flota", () => {
    expect(esTipoDeDocumento("POLIZA")).toBe(true);
    expect(esTipoDeDocumento("CEDULA")).toBe(true);
    expect(esTipoDeDocumento("FOTO")).toBe(false);
    expect(esTipoDeDocumento(null)).toBe(false);
  });

  it("el vigente de cada tipo es la subida más reciente, no la primera", () => {
    const vigentes = documentosVigentes([doc("POLIZA", 3), doc("POLIZA", 9), doc("RTO", 5)]);
    expect(vigentes.POLIZA?.createdAt.toISOString().slice(0, 10)).toBe("2026-11-09");
    expect(vigentes.RTO?.createdAt.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(vigentes.TECNICA).toBeUndefined();
  });

  it("un papel sin subidas queda en null y las viejas van al historial", () => {
    const tipos = documentosPorTipo([doc("POLIZA", 3), doc("POLIZA", 9), doc("POLIZA", 7)]);
    const poliza = tipos.find((t) => t.tipo === "POLIZA")!;
    expect(poliza.vigente?.createdAt.toISOString().slice(0, 10)).toBe("2026-11-09");
    // Historial del más nuevo al más viejo, sin el vigente.
    expect(poliza.historial.map((h) => h.createdAt.toISOString().slice(0, 10))).toEqual(["2026-11-07", "2026-11-03"]);
    expect(tipos.find((t) => t.tipo === "CEDULA")?.vigente).toBeNull();
  });

  it("mantiene ambas pólizas vigentes y renueva sólo la cobertura elegida", () => {
    const principal = doc("POLIZA", 7), vieja = doc("POLIZA_SERVICIO_PUBLICO", 1), nueva = doc("POLIZA_SERVICIO_PUBLICO", 9);
    const tipos = documentosPorTipo([vieja, principal, nueva]);
    expect(tipos.find(t => t.tipo === "POLIZA")?.vigente).toBe(principal);
    expect(tipos.find(t => t.tipo === "POLIZA_SERVICIO_PUBLICO")).toMatchObject({ vigente: nueva, historial: [vieja] });
    expect(documentosPorTipo([principal]).map(t => t.tipo)).not.toContain("POLIZA_SERVICIO_PUBLICO");
    expect(documentosPorTipo([principal], true).find(t => t.tipo === "POLIZA_SERVICIO_PUBLICO")?.vigente).toBeNull();
  });

  it("ignora filas de tipos que ya no existen en vez de mostrarlas", () => {
    const tipos = documentosPorTipo([doc("POLIZA", 3), doc("CONTRATO", 4)]);
    expect(tipos.flatMap((t) => t.historial)).toHaveLength(0);
    expect(tipos.find((t) => t.tipo === "POLIZA")?.vigente).not.toBeNull();
  });

  it("rechaza vacíos, tipos no permitidos y archivos de más de 10 MB", () => {
    expect(errorDeDocumento({ name: "", type: "application/pdf", size: 10 })).toMatch(/Elegí el archivo/);
    expect(errorDeDocumento({ name: "poliza.docx", type: "application/msword", size: 10 })).toMatch(/PDF, JPG/);
    expect(errorDeDocumento({ name: "poliza.pdf", type: "application/pdf", size: 0 })).toMatch(/vacío/);
    expect(errorDeDocumento({ name: "poliza.pdf", type: "application/pdf", size: DOCUMENTO_MAX_BYTES + 1 })).toMatch(/10 MB/);
    expect(errorDeDocumento({ name: "poliza.pdf", type: "application/pdf", size: 1024 })).toBeNull();
  });

  it("valida la firma del archivo y no el MIME declarado", async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]), "a.pdf"], "a.pdf", { type: "application/pdf" });
    const fingido = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], "b.pdf", { type: "application/pdf" });
    expect(await firmaDeArchivoValida(pdf)).toBe(true);
    expect(await firmaDeArchivoValida(fingido)).toBe(false);
  });

  it("la fecha del papel no se corre de día y una fecha imposible no entra", () => {
    expect(fechaDePapel(new Date(Date.UTC(2027, 2, 31)))).toBe("31/03/2027");
    expect(fechaDePapel(null)).toBe("—");
    expect(fechaDeVencimientoDelPapel("2027-03-31")?.toISOString()).toBe("2027-03-31T00:00:00.000Z");
    expect(fechaDeVencimientoDelPapel("2027-02-31")).toBeNull();
    expect(fechaDeVencimientoDelPapel("")).toBeNull();
  });
});

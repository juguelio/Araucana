import { describe, expect, it } from "vitest";
import { DOCUMENT_KINDS, evaluateDocumentStatus, kindLabel } from "./catalog";

const ahora = new Date("2026-10-16T12:00:00Z");
const doc = (id: string, kind: string, iso: string, critical = true) => ({
  id,
  kind,
  expiresAt: new Date(iso),
  critical
});

describe("vencimientos de documentación", () => {
  it("separa vencidos de por vencer, y no mezcla los que están lejos", () => {
    const { expired, expiring } = evaluateDocumentStatus(
      [
        doc("1", "VTV", "2026-09-01T00:00:00Z"),   // vencido
        doc("2", "SEGURO", "2026-11-01T00:00:00Z"), // dentro de 30 días
        doc("3", "HABILITACION", "2027-05-01T00:00:00Z") // lejos
      ],
      ahora
    );
    expect(expired.map((d) => d.id)).toEqual(["1"]);
    expect(expiring.map((d) => d.id)).toEqual(["2"]);
  });

  it("el día exacto del vencimiento todavía NO está vencido, pero sí avisa", () => {
    const { expired, expiring } = evaluateDocumentStatus([doc("1", "VTV", "2026-10-16T12:00:00Z")], ahora);
    expect(expired).toHaveLength(0);
    expect(expiring.map((d) => d.id)).toEqual(["1"]);
  });

  it("ordena por proximidad de vencimiento", () => {
    const { expiring } = evaluateDocumentStatus(
      [doc("lejos", "ART", "2026-11-10T00:00:00Z"), doc("cerca", "CURSO", "2026-10-20T00:00:00Z")],
      ahora
    );
    expect(expiring.map((d) => d.id)).toEqual(["cerca", "lejos"]);
  });

  it("respeta la ventana configurable", () => {
    const docs = [doc("1", "SEGURO", "2026-12-01T00:00:00Z")];
    expect(evaluateDocumentStatus(docs, ahora, 7).expiring).toHaveLength(0);
    expect(evaluateDocumentStatus(docs, ahora, 90).expiring).toHaveLength(1);
  });

  it("los tipos críticos son los que bloquean", () => {
    const criticosNave = DOCUMENT_KINDS.VEHICLE.filter((k) => k.critical).map((k) => k.code);
    const criticosChofer = DOCUMENT_KINDS.DRIVER.filter((k) => k.critical).map((k) => k.code);
    expect(criticosNave).toEqual(["VTV", "SEGURO", "HABILITACION"]);
    expect(criticosChofer).toEqual(["LICENCIA", "APTO_MEDICO"]);
  });

  it("etiqueta los tipos y no rompe con uno desconocido", () => {
    expect(kindLabel("DRIVER", "LICENCIA")).toBe("Licencia de conducir");
    expect(kindLabel("VEHICLE", "NO_EXISTE")).toBe("NO_EXISTE");
  });
});

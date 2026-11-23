import { describe, expect, it } from "vitest";
import { driverDocumentsAudit, daysUntilExpiry, expiryDaysLabel, expiryStatus, formatExpiryDay, normalizeCuil, parseDay, todayInArgentina, validateDriverDocuments, worstStatus } from "./driver-documents";

const completo = {
  documentNumber: "29.098.806",
  cuil: "27290988069",
  licenseCategory: " d3 ",
  licenseScope: "COMPLETA",
  licenseExpiresAt: "2030-06-10",
  criminalRecordExpiresAt: "2027-02-10"
};

describe("documentación del chofer", () => {
  it("acepta lo que trae la planilla y lo deja prolijo", () => {
    const result = validateDriverDocuments(completo);
    expect(result).toEqual({
      ok: true,
      documents: {
        documentNumber: "29098806",
        cuil: "27-29098806-9",
        licenseCategory: "D3",
        licenseScope: "COMPLETA",
        licenseExpiresAt: new Date("2030-06-10T00:00:00.000Z"),
        criminalRecordExpiresAt: new Date("2027-02-10T00:00:00.000Z")
      }
    });
  });

  it("pide DNI, categoría y los dos vencimientos; el CUIL es opcional", () => {
    const result = validateDriverDocuments({ documentNumber: "", cuil: "", licenseCategory: "", licenseScope: "", licenseExpiresAt: "", criminalRecordExpiresAt: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["criminalRecordExpiresAt", "documentNumber", "licenseCategory", "licenseExpiresAt"]);
    expect(validateDriverDocuments({ ...completo, cuil: "" })).toMatchObject({ ok: true, documents: { cuil: null } });
  });

  it("rechaza un DNI corto, un CUIL que no es de esa persona y fechas imposibles", () => {
    const result = validateDriverDocuments({ ...completo, documentNumber: "123", licenseExpiresAt: "2030-02-30" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.documentNumber).toContain("7 u 8");
    expect(result.errors.licenseExpiresAt).toBeTruthy();
    const otro = validateDriverDocuments({ ...completo, cuil: "20-12345678-9" });
    expect(otro.ok ? null : otro.errors.cuil).toBe("El CUIL no coincide con el DNI.");
  });

  it("un DNI de 7 números también coincide con su CUIL", () => {
    expect(validateDriverDocuments({ ...completo, documentNumber: "8123456", cuil: "20-08123456-3" }).ok).toBe(true);
    expect(normalizeCuil("20 08123456 3")).toBe("20-08123456-3");
    expect(normalizeCuil("2008")).toBeNull();
  });

  it("marca vencido, por vencer (30 días) y vigente; sin dato, falta", () => {
    const hoy = "2026-11-17";
    expect(expiryStatus(parseDay("2026-11-16"), hoy)).toBe("EXPIRED");
    expect(expiryStatus(parseDay("2026-11-17"), hoy)).toBe("EXPIRING");
    expect(expiryStatus(parseDay("2026-12-17"), hoy)).toBe("EXPIRING");
    expect(expiryStatus(parseDay("2026-12-18"), hoy)).toBe("VALID");
    expect(expiryStatus(null, hoy)).toBe("MISSING");
    expect(worstStatus(["VALID", "EXPIRING"])).toBe("EXPIRING");
    expect(worstStatus(["EXPIRED", "MISSING"])).toBe("MISSING");
  });

  it("el día de hoy es el de Argentina, no el de UTC", () => {
    expect(todayInArgentina(new Date("2026-11-18T02:00:00Z"))).toBe("2026-11-17");
  });

  it("dice los días que faltan sin que el operador reste fechas (#368)", () => {
    const hoy = "2026-11-17";
    expect(daysUntilExpiry(parseDay("2026-11-29"), hoy)).toBe(12);
    expect(expiryDaysLabel(parseDay("2026-11-29"), hoy)).toBe("faltan 12 días");
    expect(expiryDaysLabel(parseDay("2026-11-18"), hoy)).toBe("faltan 1 día");
    expect(expiryDaysLabel(parseDay("2026-11-17"), hoy)).toBe("vence hoy");
    expect(expiryDaysLabel(parseDay("2026-11-16"), hoy)).toBe("venció hace 1 día");
    expect(expiryDaysLabel(parseDay("2026-11-01"), hoy)).toBe("venció hace 16 días");
    expect(expiryDaysLabel(null, hoy)).toBeNull();
    expect(expiryDaysLabel(parseDay("2026-11-29"), "no-es-un-dia")).toBeNull();
  });

  it("formatea el vencimiento como DD/MM/AAAA sin correrse de día", () => {
    expect(formatExpiryDay(parseDay("2027-02-01")!)).toBe("01/02/2027");
    expect(formatExpiryDay(new Date("2026-12-31T00:00:00.000Z"))).toBe("31/12/2026");
  });

  it("la auditoría lleva los datos con nombre de chofer y el alcance en palabras", () => {
    const result = validateDriverDocuments(completo);
    if (!result.ok) throw new Error("debería validar");
    expect(driverDocumentsAudit(result.documents)).toMatchObject({ "driver.documentNumber": "29098806", "driver.licenseScope": "Completa" });
    expect(driverDocumentsAudit(null)).toEqual({});
  });
});

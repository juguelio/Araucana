/**
 * Documentación de un chofer: DNI, licencia de conducir y certificado de antecedentes. Es lo que el
 * cliente lleva en su planilla «Vencimientos Choferes». Se pide al dar de alta un chofer (y al editarlo,
 * si todavía no la tiene) y el listado marca lo vencido o por vencer.
 *
 * Todo acá es puro para poder probarlo sin pantalla ni base.
 */

export const LICENSE_SCOPES = { COMPLETA: "Completa", JURISDICCIONAL: "Jurisdiccional" } as const;
export type LicenseScope = keyof typeof LICENSE_SCOPES;

/** Cuántos días antes de vencer se avisa. */
export const EXPIRY_WARNING_DAYS = 30;

export type DriverDocuments = {
  documentNumber: string;
  cuil: string | null;
  licenseCategory: string;
  licenseScope: LicenseScope;
  licenseExpiresAt: Date;
  criminalRecordExpiresAt: Date;
};

export type DriverDocumentsInput = {
  documentNumber: string;
  cuil: string;
  licenseCategory: string;
  licenseScope: string;
  licenseExpiresAt: string;
  criminalRecordExpiresAt: string;
};

export type DriverDocumentErrors = Partial<Record<keyof DriverDocumentsInput, string>>;

/** Un día "AAAA-MM-DD" como medianoche UTC, igual que el resto de las fechas sin hora del sistema. */
export function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function dayKey(date: Date | null | undefined) {
  return date ? date.toISOString().slice(0, 10) : "";
}

/** "20-12345678-9" a partir de lo que se escriba (con o sin guiones). `null` si no tiene 11 dígitos. */
export function normalizeCuil(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}` : null;
}

export function validateDriverDocuments(input: DriverDocumentsInput):
  { ok: true; documents: DriverDocuments } | { ok: false; errors: DriverDocumentErrors } {
  const errors: DriverDocumentErrors = {};

  const documentNumber = input.documentNumber.replace(/[.\s-]/g, "");
  if (!documentNumber) errors.documentNumber = "Ingresá el DNI del chofer.";
  else if (!/^\d{7,8}$/.test(documentNumber)) errors.documentNumber = "El DNI tiene 7 u 8 números.";

  let cuil: string | null = null;
  if (input.cuil.trim()) {
    cuil = normalizeCuil(input.cuil);
    if (!cuil) errors.cuil = "El CUIL tiene 11 números (20-12345678-9).";
    else if (documentNumber && /^\d{7,8}$/.test(documentNumber) && cuil.slice(3, 11) !== documentNumber.padStart(8, "0")) {
      errors.cuil = "El CUIL no coincide con el DNI.";
    }
  }

  const licenseCategory = input.licenseCategory.trim().toUpperCase().replace(/\s+/g, "");
  if (!licenseCategory) errors.licenseCategory = "Ingresá la categoría de la licencia (por ejemplo D3).";
  else if (licenseCategory.length > 12) errors.licenseCategory = "La categoría es corta: por ejemplo D3 o D1.";

  const licenseScope = (input.licenseScope || "COMPLETA").toUpperCase();
  if (!(licenseScope in LICENSE_SCOPES)) errors.licenseScope = "Elegí si la licencia es completa o jurisdiccional.";

  const licenseExpiresAt = parseDay(input.licenseExpiresAt);
  if (!licenseExpiresAt) errors.licenseExpiresAt = "Ingresá el vencimiento de la licencia.";

  const criminalRecordExpiresAt = parseDay(input.criminalRecordExpiresAt);
  if (!criminalRecordExpiresAt) errors.criminalRecordExpiresAt = "Ingresá el vencimiento del certificado de antecedentes.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    documents: {
      documentNumber,
      cuil,
      licenseCategory,
      licenseScope: licenseScope as LicenseScope,
      licenseExpiresAt: licenseExpiresAt!,
      criminalRecordExpiresAt: criminalRecordExpiresAt!
    }
  };
}

export type ExpiryStatus = "MISSING" | "EXPIRED" | "EXPIRING" | "VALID";

export const EXPIRY_LABELS: Record<ExpiryStatus, string> = {
  MISSING: "Falta",
  EXPIRED: "Vencido",
  EXPIRING: "Por vencer",
  VALID: "Vigente"
};

/** Días que faltan para el vencimiento: negativo si ya venció, `null` si no hay fecha. */
export function daysUntilExpiry(expiresAt: Date | null | undefined, today: string): number | null {
  if (!expiresAt) return null;
  const todayDate = parseDay(today);
  if (!todayDate) return null;
  return Math.round((expiresAt.getTime() - todayDate.getTime()) / 86_400_000);
}

/** Estado de un vencimiento al día de hoy (en Argentina). Vence al terminar el día indicado. */
export function expiryStatus(expiresAt: Date | null | undefined, today: string): ExpiryStatus {
  const days = daysUntilExpiry(expiresAt, today);
  if (days === null) return "MISSING";
  if (days < 0) return "EXPIRED";
  if (days <= EXPIRY_WARNING_DAYS) return "EXPIRING";
  return "VALID";
}

/**
 * Días restantes en palabras, para que el operador no tenga que restar fechas: «faltan 12 días»,
 * «vence hoy», «venció hace 3 días». `null` cuando el dato no está cargado.
 */
export function expiryDaysLabel(expiresAt: Date | null | undefined, today: string): string | null {
  const days = daysUntilExpiry(expiresAt, today);
  if (days === null) return null;
  if (days === 0) return "vence hoy";
  if (days > 0) return `faltan ${days} día${days === 1 ? "" : "s"}`;
  const vencidos = Math.abs(days);
  return `venció hace ${vencidos} día${vencidos === 1 ? "" : "s"}`;
}

/** `AAAA-MM-DD` (medianoche UTC) como `DD/MM/AAAA`, sin pasar por la zona horaria del servidor. */
export function formatExpiryDay(date: Date): string {
  return date.toISOString().slice(0, 10).split("-").reverse().join("/");
}

/** Lo peor de los dos vencimientos: lo que conviene mirar primero en el listado. */
export function worstStatus(statuses: ExpiryStatus[]): ExpiryStatus {
  const order: ExpiryStatus[] = ["MISSING", "EXPIRED", "EXPIRING", "VALID"];
  return order.find((status) => statuses.includes(status)) ?? "VALID";
}

/** Hoy como "AAAA-MM-DD" en Argentina. */
export function todayInArgentina(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta" }).format(now);
}

/** Los datos que entran a la auditoría de la cuenta, con nombres propios para no pisar los de la cuenta. */
export function driverDocumentsAudit(documents: DriverDocuments | null) {
  if (!documents) return {};
  return {
    "driver.documentNumber": documents.documentNumber,
    "driver.cuil": documents.cuil,
    "driver.licenseCategory": documents.licenseCategory,
    "driver.licenseScope": LICENSE_SCOPES[documents.licenseScope] ?? documents.licenseScope,
    "driver.licenseExpiresAt": documents.licenseExpiresAt,
    "driver.criminalRecordExpiresAt": documents.criminalRecordExpiresAt
  };
}

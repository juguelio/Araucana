export const phoneFormatError = "Ingresá un teléfono válido con código de área y país.";

export function normalizePassengerPhone(value: string): string | null {
  const phone = value.trim();
  if (!/^\+?[0-9() .-]+$/.test(phone)) return null;
  const digits = phone.replace(/\D/g, "");
  const international = phone.startsWith("+") ? digits
    : digits.startsWith("00") ? digits.slice(2)
    : `54${digits}`;
  if (!/^[1-9]\d{6,14}$/.test(international)) return null;

  if (international.startsWith("54") && !/^54(?:9)?[123]\d{9}$/.test(international)) return null;
  return `+${international}`;
}

export function passengerDocumentError(type: string, value: string, optional = false) {
  const document = value.trim();
  if (optional && !document) return undefined;
  if (type.trim().toUpperCase() === "DNI") {
    if (!/^(?:\d{7,8}|\d{1,2}\.\d{3}\.\d{3})$/.test(document) || !/[1-9]/.test(document)) {
      return "Ingresá un DNI de 7 u 8 dígitos.";
    }
  } else if (!/^[a-z0-9][a-z0-9 .-]{2,28}[a-z0-9]$/i.test(document)) {
    return "Ingresá un número de documento válido.";
  }
  return undefined;
}

export function normalizePassengerDocument(type: string, value: string) {
  return type.trim().toUpperCase() === "DNI" ? value.trim().replace(/\./g, "") : value.trim();
}

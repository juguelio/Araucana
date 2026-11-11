import { parseMonthlySalaryCents } from "./salary";
import { isValidPassword } from "@/lib/auth/password";
import { isManagedUserRole, type ManagedUserRole } from "./users";

export const MIN_PASSWORD_LENGTH = 12;

/** Datos crudos del formulario de alta de una cuenta del panel. */
export type ManagedUserDraftInput = {
  email: string;
  name: string;
  password: string;
  role: string;
  isActive: boolean;
  monthlySalary: string;
};

export type ManagedUserDraft = {
  email: string;
  name: string | null;
  password: string;
  role: ManagedUserRole;
  isActive: boolean;
  monthlySalaryCents: number | null;
};

export type ManagedUserField = "email" | "name" | "password" | "role" | "monthlySalary";

export type ManagedUserDraftResult =
  | { ok: true; draft: ManagedUserDraft }
  | { ok: false; errors: Partial<Record<ManagedUserField, string>> };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valida el alta de una cuenta del panel antes de tocar la base.
 * El sueldo sólo aplica a SECRETARY y DRIVER; para el resto se ignora.
 */
export function validateManagedUserDraft(input: ManagedUserDraftInput): ManagedUserDraftResult {
  const errors: Partial<Record<ManagedUserField, string>> = {};
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!email) {
    errors.email = "Ingresá el email de la cuenta.";
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "Ingresá un email válido.";
  }

  if (!isManagedUserRole(input.role)) {
    errors.role = "Elegí un rol válido.";
  }

  if (!input.password) {
    errors.password = "Ingresá una contraseña inicial.";
  } else if (!isValidPassword(input.password)) {
    errors.password = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres y no superar 72 bytes.`;
  }

  let monthlySalaryCents: number | null = null;
  if (isManagedUserRole(input.role) && (input.role === "SECRETARY" || input.role === "DRIVER")) {
    try {
      monthlySalaryCents = parseMonthlySalaryCents(input.monthlySalary);
    } catch (error) {
      errors.monthlySalary = error instanceof Error ? error.message : "Revisá el sueldo.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    draft: {
      email,
      name: name || null,
      password: input.password,
      role: input.role as ManagedUserRole,
      isActive: input.isActive,
      monthlySalaryCents
    }
  };
}

/** Contraseña sugerida para entregar al alta: legible, sin caracteres ambiguos. */
export function suggestInitialPassword(length = 14) {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let salida = "";
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    salida += alfabeto[byte % alfabeto.length];
  }
  return salida;
}

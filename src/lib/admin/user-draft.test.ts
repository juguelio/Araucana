import { describe, expect, it } from "vitest";
import { validateManagedUserDraft } from "./user-draft";

const base = {
  email: "  Valeria.Lobo@Araucana.com.ar ",
  name: "  Valeria Lobo ",
  password: "unaClaveLarga2026",
  role: "SECRETARY",
  isActive: true,
  monthlySalary: "450.000"
};

describe("validateManagedUserDraft", () => {
  it("normaliza email y nombre, y convierte el sueldo a centavos", () => {
    const result = validateManagedUserDraft(base);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.email).toBe("valeria.lobo@araucana.com.ar");
    expect(result.draft.name).toBe("Valeria Lobo");
    expect(result.draft.role).toBe("SECRETARY");
    expect(result.draft.monthlySalaryCents).toBe(45_000_000);
    expect(result.draft.isActive).toBe(true);
  });

  it("deja el nombre en null cuando viene vacío", () => {
    const result = validateManagedUserDraft({ ...base, name: "   " });

    expect(result.ok && result.draft.name).toBeNull();
  });

  it("ignora el sueldo en roles que no lo usan", () => {
    for (const role of ["ADMIN", "USER"]) {
      const result = validateManagedUserDraft({ ...base, role, monthlySalary: "no es un número" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.draft.monthlySalaryCents).toBeNull();
    }
  });

  it("rechaza un email inválido", () => {
    const result = validateManagedUserDraft({ ...base, email: "valeria" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.email).toMatch(/email válido/i);
  });

  it("rechaza contraseñas cortas o de más de 72 bytes", () => {
    const corta = validateManagedUserDraft({ ...base, password: "corta" });
    expect(corta.ok).toBe(false);
    if (!corta.ok) expect(corta.errors.password).toMatch(/12 caracteres/);

    const larga = validateManagedUserDraft({ ...base, password: "á".repeat(40) });
    expect(larga.ok).toBe(false);
    if (!larga.ok) expect(larga.errors.password).toMatch(/72 bytes/);
  });

  it("rechaza un rol desconocido", () => {
    const result = validateManagedUserDraft({ ...base, role: "ROOT" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.role).toBeTruthy();
  });

  it("rechaza un sueldo inválido para secretaría", () => {
    const result = validateManagedUserDraft({ ...base, monthlySalary: "abc" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.monthlySalary).toMatch(/mayor a cero/i);
  });

  it("permite crear sin sueldo cargado", () => {
    const result = validateManagedUserDraft({ ...base, monthlySalary: "" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.monthlySalaryCents).toBeNull();
  });

  it("junta todos los errores de una vez", () => {
    const result = validateManagedUserDraft({ ...base, email: "", password: "", role: "nope" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["email", "password", "role"]);
  });
});

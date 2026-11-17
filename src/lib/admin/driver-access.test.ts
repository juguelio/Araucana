import { describe, expect, it } from "vitest";
import {
  canDeleteManagedUser,
  canManageManagedUser,
  canSeeSalary,
  forcedManagedRole,
  isDriverOnlyManager,
  managedUsersBasePath
} from "./driver-access";

describe("acceso al módulo de choferes", () => {
  it("la secretaría gestiona sólo choferes", () => {
    expect(isDriverOnlyManager("SECRETARY")).toBe(true);
    expect(forcedManagedRole("SECRETARY")).toBe("DRIVER");
    expect(managedUsersBasePath("SECRETARY")).toBe("/admin/choferes");
  });

  it("la administración conserva el CRM completo", () => {
    for (const role of ["ADMIN", "SUPERADMIN"]) {
      expect(isDriverOnlyManager(role)).toBe(false);
      expect(forcedManagedRole(role)).toBeNull();
      expect(managedUsersBasePath(role)).toBe("/admin/usuarios");
    }
  });

  it("la secretaría no ve sueldos ni borra cuentas", () => {
    expect(canSeeSalary("SECRETARY")).toBe(false);
    expect(canDeleteManagedUser("SECRETARY")).toBe(false);
    expect(canSeeSalary("ADMIN")).toBe(true);
    expect(canDeleteManagedUser("ADMIN")).toBe(true);
  });

  it("la secretaría no abre la ficha de una cuenta que no es de chofer", () => {
    expect(canManageManagedUser("SECRETARY", "DRIVER")).toBe(true);
    expect(canManageManagedUser("SECRETARY", "ADMIN")).toBe(false);
    expect(canManageManagedUser("SECRETARY", "SUPERADMIN")).toBe(false);
    expect(canManageManagedUser("SECRETARY", "SECRETARY")).toBe(false);
    expect(canManageManagedUser("SECRETARY", "USER")).toBe(false);
  });

  it("la administración abre cualquier cuenta", () => {
    for (const target of ["DRIVER", "ADMIN", "SUPERADMIN", "SECRETARY", "USER"]) {
      expect(canManageManagedUser("ADMIN", target)).toBe(true);
    }
  });
});

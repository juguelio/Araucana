import { describe, expect, it } from "vitest";
import { getDefaultPathForRole, isAdminRole, isOfficeRole, roleCanAccess, toPublicRole } from "./roles";
import { canAssignRole, canManageAccount, isSuperAdmin } from "./super-admin";

const superAdmin = { role: "SUPERADMIN", isActive: true };
const admin = { role: "ADMIN", isActive: true };

describe("rol de super administrador", () => {
  it("es un rol propio que hereda todo lo del administrador", () => {
    expect(toPublicRole("SUPERADMIN")).toBe("SUPERADMIN");
    expect(isAdminRole("SUPERADMIN")).toBe(true);
    expect(isOfficeRole("SUPERADMIN")).toBe(true);
    expect(getDefaultPathForRole("SUPERADMIN")).toBe("/admin");
    expect(roleCanAccess("SUPERADMIN", ["ADMIN"])).toBe(true);
    expect(roleCanAccess("SUPERADMIN", ["ADMIN", "SECRETARY"])).toBe(true);
  });

  it("no convierte al super administrador en chofer ni al administrador en super administrador", () => {
    expect(roleCanAccess("SUPERADMIN", ["DRIVER"])).toBe(false);
    expect(roleCanAccess("ADMIN", ["SUPERADMIN"])).toBe(false);
    expect(roleCanAccess("SECRETARY", ["ADMIN"])).toBe(false);
    expect(isAdminRole("SECRETARY")).toBe(false);
  });

  it("exige la cuenta activa", () => {
    expect(isSuperAdmin(superAdmin)).toBe(true);
    expect(isSuperAdmin({ ...superAdmin, isActive: false })).toBe(false);
    expect(isSuperAdmin(admin)).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
  });

  it("sólo un super administrador asigna el rol o toca una cuenta que lo tiene", () => {
    expect(canAssignRole(admin, "SUPERADMIN")).toBe(false);
    expect(canAssignRole(superAdmin, "SUPERADMIN")).toBe(true);
    expect(canAssignRole(admin, "ADMIN")).toBe(true);
    expect(canManageAccount(admin, { role: "SUPERADMIN" })).toBe(false);
    expect(canManageAccount(superAdmin, { role: "SUPERADMIN" })).toBe(true);
    expect(canManageAccount(admin, { role: "SECRETARY" })).toBe(true);
  });
});

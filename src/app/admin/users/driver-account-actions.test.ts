import { beforeEach, expect, it, vi } from "vitest";
import { initialAdminFormState } from "../form-state";
import { deleteManagedUserAction, setManagedUserActiveAction, updateManagedUserAction } from "./actions";

const mock = vi.hoisted(() => ({
  admin: vi.fn(), manager: vi.fn(), find: vi.fn(), update: vi.fn(), remove: vi.fn(),
  transaction: vi.fn(), profile: vi.fn(), saveProfile: vi.fn()
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(decodeURIComponent(url)); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ getCurrentAdminOrRedirect: mock.admin, getCurrentDriverManagerOrRedirect: mock.manager }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $transaction: mock.transaction } }));
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }));

const form = (data: Record<string, string> = {}) => {
  const result = new FormData();
  for (const [key, value] of Object.entries({ id: "driver-1", driverEdit: "1", ...data })) result.set(key, value);
  return result;
};

const driver = { email: "chofer@example.test", name: "Chofer", role: "DRIVER", isActive: true, monthlySalaryCents: null };

beforeEach(() => {
  vi.resetAllMocks();
  mock.manager.mockResolvedValue({ id: "secretaria", role: "SECRETARY" });
  mock.admin.mockResolvedValue({ id: "admin", role: "ADMIN" });
  mock.transaction.mockImplementation((fn) => fn({
    user: { findUnique: mock.find, update: mock.update, delete: mock.remove },
    driverProfile: { findUnique: mock.profile, upsert: mock.saveProfile }
  }));
  mock.find.mockResolvedValue(driver);
  mock.update.mockResolvedValue(driver);
  mock.profile.mockResolvedValue(null);
});

it("permite desactivar desde la ficha de chofer y vuelve a esa ficha con el resultado", async () => {
  await expect(setManagedUserActiveAction(form({ isActive: "false" })))
    .rejects.toThrow("/admin/choferes/driver-1?notice=Cuenta desactivada.");
  expect(mock.update).toHaveBeenCalledWith({ where: { id: "driver-1" }, data: { isActive: false } });
});

it("guardar la documentación no modifica el estado actual del chofer", async () => {
  const data = form({ name: "Chofer", documentNumber: "29098806", licenseCategory: "D3",
    licenseScope: "COMPLETA", licenseExpiresAt: "2028-11-01", criminalRecordExpiresAt: "2028-11-01" });

  await expect(updateManagedUserAction(initialAdminFormState, data))
    .rejects.toThrow("/admin/choferes?notice=Cuenta actualizada.");
  expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
});

it("eliminar desde Choferes queda reservado a administración y a cuentas de chofer", async () => {
  mock.admin.mockRejectedValueOnce(new Error("Sólo administradores"));
  await expect(deleteManagedUserAction(form())).rejects.toThrow("Sólo administradores");
  mock.find.mockResolvedValueOnce({ ...driver, role: "SECRETARY" });
  await expect(deleteManagedUserAction(form())).rejects.toThrow("Esa cuenta no es de un chofer.");
  expect(mock.remove).not.toHaveBeenCalled();
});

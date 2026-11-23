import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeAccountPassword } from "./service";

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn()
}));
const passwords = vi.hoisted(() => ({ verifyPassword: vi.fn(), hashPassword: vi.fn() }));

vi.mock("@/lib/db/prisma", () => {
  const tx = { user: { updateMany: db.updateMany }, session: { deleteMany: db.deleteMany } };
  return {
    prisma: {
      user: { findUnique: db.findUnique },
      $transaction: async (callback: (client: typeof tx) => Promise<boolean>) => callback(tx)
    }
  };
});
vi.mock("./password", () => passwords);

describe("changeAccountPassword", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.findUnique.mockResolvedValue({ passwordHash: "old-hash" });
    passwords.verifyPassword.mockResolvedValue(true);
    passwords.hashPassword.mockResolvedValue("new-hash");
    db.updateMany.mockResolvedValue({ count: 1 });
  });

  it("verifica la contraseña anterior, requiere una sesión vigente y conserva solo esa sesión", async () => {
    await expect(changeAccountPassword("user-1", "token", "current", "new")).resolves.toBe(true);
    expect(passwords.verifyPassword).toHaveBeenCalledWith("current", "old-hash");
    expect(db.updateMany).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        passwordHash: "old-hash",
        sessions: { some: { tokenHash: expect.any(String), expiresAt: { gt: expect.any(Date) } } }
      },
      data: { passwordHash: "new-hash" }
    });
    const session = db.updateMany.mock.calls[0][0].where.sessions.some;
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1", tokenHash: { not: session.tokenHash } } });
  });

  it("rechaza una contraseña actual incorrecta y las cuentas sin contraseña local", async () => {
    passwords.verifyPassword.mockResolvedValue(false);
    await expect(changeAccountPassword("user-1", "token", "current", "new")).resolves.toBe(false);

    db.findUnique.mockResolvedValue({ passwordHash: null });
    await expect(changeAccountPassword("user-1", "token", "current", "new")).resolves.toBe(false);
    expect(passwords.hashPassword).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(db.deleteMany).not.toHaveBeenCalled();
  });

  it("deja las sesiones intactas si la sesión o la contraseña anterior cambió mientras se guardaba", async () => {
    db.updateMany.mockResolvedValue({ count: 0 });
    await expect(changeAccountPassword("user-1", "token", "current", "new")).resolves.toBe(false);
    expect(db.deleteMany).not.toHaveBeenCalled();
  });
});

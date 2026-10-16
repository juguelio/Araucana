import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), token: vi.fn() }));
vi.mock("@/lib/auth/service", () => ({
  getAppUserFromToken: mocks.user, getTokenFromRequest: mocks.token,
  AuthorizationError: class extends Error {}
}));
import { requireReservationAccess } from "./access";
import { createReservationCode, isPrivateReservationCode } from "./codes";

describe("guest reservation access", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue(null); });
  it("generates unique 128-bit capabilities and rejects legacy or malformed codes", () => {
    const codes = new Set(Array.from({ length: 100 }, () => createReservationCode()));
    expect(codes.size).toBe(100);
    for (const code of codes) expect(isPrivateReservationCode(code)).toBe(true);
    expect(isPrivateReservationCode("ARC-2610-AAAA")).toBe(false);
    expect(isPrivateReservationCode("ARC-2610-" + "G".repeat(32))).toBe(false);
  });
  it("does not reveal old reservations to anonymous, inactive or non-staff users", async () => {
    for (const user of [null, { role: "ADMIN", isActive: false }, { role: "DRIVER", isActive: true }, { role: "USER", isActive: true }]) {
      mocks.user.mockResolvedValue(user);
      await expect(requireReservationAccess("ARC-2610-AAAA")).rejects.toThrow();
    }
  });
  it("allows active staff to recover legacy bookings, and guests with a private link", async () => {
    for (const role of ["ADMIN", "SECRETARY"]) {
      mocks.user.mockResolvedValue({ role, isActive: true });
      await expect(requireReservationAccess("ARC-2610-AAAA")).resolves.toBeUndefined();
    }
    mocks.user.mockResolvedValue(null);
    await expect(requireReservationAccess(createReservationCode())).resolves.toBeUndefined();
  });
});

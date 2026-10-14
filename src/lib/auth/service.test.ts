import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  }
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));

import { syncSignedInSupabaseUser } from "./service";

function googleUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "google-user-1",
    email: "person@example.com",
    email_confirmed_at: "2026-10-14T12:00:00.000Z",
    app_metadata: { provider: "google" },
    user_metadata: { full_name: "Google User" },
    ...overrides
  } as never;
}

describe("Supabase profile synchronization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates new Google registrations as inactive USER accounts", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "profile-1", email: "person@example.com", name: "Google User", role: "USER", isActive: false
    });

    const profile = await syncSignedInSupabaseUser(googleUser());

    expect(prismaMock.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      email: "person@example.com", name: "Google User", supabaseUserId: "google-user-1", role: "USER", isActive: false
    }) });
    expect(profile).toMatchObject({ id: "profile-1", role: "USER", isActive: false });
  });

  it("links an existing email without changing its role or active state", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "employee-1", email: "person@example.com", name: "Chofer", supabaseUserId: null });
    prismaMock.user.update.mockResolvedValue({
      id: "employee-1", email: "person@example.com", name: "Chofer", role: "DRIVER", isActive: true
    });

    const profile = await syncSignedInSupabaseUser(googleUser());

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "employee-1" },
      data: { supabaseUserId: "google-user-1", email: "person@example.com" }
    });
    expect(profile).toMatchObject({ id: "employee-1", role: "DRIVER", isActive: true });
  });

  it("rejects identities without a verified email", async () => {
    await expect(syncSignedInSupabaseUser(googleUser({ email_confirmed_at: null }))).rejects.toThrow("email verificado");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("accepts only identities authenticated through Google", async () => {
    await expect(syncSignedInSupabaseUser(googleUser({ app_metadata: { provider: "email" } }))).rejects.toThrow("usando Google");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("does not link an email already bound to a different Supabase identity", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "profile-1", email: "person@example.com", supabaseUserId: "other-google-id" });

    await expect(syncSignedInSupabaseUser(googleUser())).rejects.toThrow("ya esta vinculada");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

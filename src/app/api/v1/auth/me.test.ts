import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getAppUserFromToken: vi.fn(),
  getTokenFromRequest: vi.fn()
}));

vi.mock("@/lib/auth/service", () => authMocks);

import { GET } from "./me/route";

describe("GET /api/v1/auth/me", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports pending approval in the standard API error envelope", async () => {
    authMocks.getTokenFromRequest.mockReturnValue("supabase-token");
    authMocks.getAppUserFromToken.mockResolvedValue({
      id: "profile-1", email: "new@example.com", name: "New User", role: "USER", isActive: false
    });

    const response = await GET(new Request("https://araucana.example/api/v1/auth/me", {
      headers: { Authorization: "Bearer supabase-token" }
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toEqual({ code: "PENDING_APPROVAL", message: expect.any(String) });
  });

  it("returns active Araucana profiles without internal fields", async () => {
    authMocks.getTokenFromRequest.mockReturnValue("supabase-token");
    authMocks.getAppUserFromToken.mockResolvedValue({
      id: "profile-2", email: "driver@example.com", name: "Driver", role: "DRIVER", isActive: true
    });

    const response = await GET(new Request("https://araucana.example/api/v1/auth/me"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: "profile-2", email: "driver@example.com", name: "Driver", role: "DRIVER" }
    });
  });
});

import { describe, expect, it } from "vitest";
import { extractBearerToken, toPublicUser } from "./session";

describe("Supabase auth helpers", () => {
  it("extracts JWT bearer tokens for native API clients", () => {
    expect(extractBearerToken("Bearer ey.jwt.token")).toBe("ey.jwt.token");
    expect(extractBearerToken("bearer ey.jwt.token")).toBe("ey.jwt.token");
    expect(extractBearerToken("Token ey.jwt.token")).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
  });

  it("returns only the Araucana role and identity fields", () => {
    expect(toPublicUser({ id: "u1", email: "driver@example.com", name: "Chofer", role: "DRIVER" })).toEqual({
      id: "u1", email: "driver@example.com", name: "Chofer", role: "DRIVER"
    });
  });
});

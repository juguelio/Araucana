import { describe, expect, it } from "vitest";
import { getOpenApiSpec } from "./openapi";

type OpenApiSpecForTest = ReturnType<typeof getOpenApiSpec> & {
  paths: Record<string, Record<string, { security?: unknown }>>;
  components: {
    securitySchemes: {
      bearerAuth: unknown;
    };
  };
};

describe("openapi spec", () => {
  it("documents mobile auth, public reservations, receipt upload, and admin endpoints", () => {
    const spec = getOpenApiSpec("https://api.example.com") as OpenApiSpecForTest;

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.servers).toEqual([{ url: "https://api.example.com" }]);
    expect(spec.paths["/api/v1/auth/me"].get.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths["/api/v1/auth/login"]).toBeUndefined();
    expect(spec.paths["/api/v1/auth/refresh"]).toBeUndefined();
    expect(spec.paths["/api/v1/auth/logout"]).toBeUndefined();
    expect(spec.paths["/api/v1/reservations/{code}/receipt"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/routes"].get.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths["/api/v1/admin/schedules"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/vehicles/{id}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/admin/reservations/{code}/approve-payment"].post).toBeDefined();
    expect(spec.paths["/api/v1/chapelco/availability"].get).toBeDefined();
    expect(spec.paths["/api/v1/driver/bootstrap"].get.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths["/api/v1/driver/chapelco"].get.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths["/api/v1/driver/chapelco"].patch).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT"
    });
  });
});

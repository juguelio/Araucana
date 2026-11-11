import { beforeEach, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { getAppUserFromToken } from "@/lib/auth/service";
import LoginPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => { throw new Error("redirect"); })
}));
vi.mock("@/lib/auth/service", () => ({ getAppUserFromToken: vi.fn() }));
vi.mock("@/lib/auth/google", () => ({ isGoogleLoginConfigured: () => false }));
vi.mock("./login-form", () => ({ LoginForm: () => null }));

beforeEach(() => vi.clearAllMocks());

it.each([
  { role: "ADMIN", isActive: true, destination: "/admin" },
  { role: "SECRETARY", isActive: true, destination: "/admin/reservas" },
  { role: "DRIVER", isActive: true, destination: "/chofer" },
  { role: "USER", isActive: false, destination: "/acceso-pendiente" }
] as const)("reutiliza la sesión de $role y abre $destination", async ({ role, isActive, destination }) => {
  vi.mocked(getAppUserFromToken).mockResolvedValue({
    id: "user-1", email: "empleado@example.com", name: null, role, isActive
  });

  await expect(LoginPage()).rejects.toThrow("redirect");
  expect(redirect).toHaveBeenCalledWith(destination);
});

it("muestra el ingreso si no hay una sesión vigente", async () => {
  vi.mocked(getAppUserFromToken).mockResolvedValue(null);

  await expect(LoginPage()).resolves.toMatchObject({ type: "main" });
  expect(redirect).not.toHaveBeenCalled();
});

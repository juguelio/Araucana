import { expect, test } from "@playwright/test";

test.describe("Acceso y administración", () => {
  test("ofrece acceso y registro con Google, sin credenciales propias", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Entrar a la cabina Araucana." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Acceso al sistema" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
    await expect(page.getByLabel("Password")).toHaveCount(0);
  });

  test("redirige visitantes sin sesión hacia Google login", async ({ page }) => {
    for (const path of ["/admin", "/admin/usuarios", "/admin/rutas", "/admin/naves"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeVisible();
    }
  });

  test("mantiene públicas las rutas y reservas", async ({ page }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login$/);
    await page.goto("/rutas");
    await expect(page).not.toHaveURL(/\/login$/);
  });
});

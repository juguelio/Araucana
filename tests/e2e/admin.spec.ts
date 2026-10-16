import { expect, test } from "@playwright/test";

test.describe("Acceso y administración", () => {
  test("ofrece acceso local y registro", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Entrar a la cabina Araucana." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ingresar", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Registrate" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Contraseña")).toBeVisible();
  });

  test("redirige visitantes sin sesión hacia login", async ({ page }) => {
    for (const path of ["/admin", "/admin/usuarios", "/admin/rutas", "/admin/naves"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("button", { name: "Ingresar", exact: true })).toBeVisible();
    }
  });

  test("mantiene públicas las rutas y reservas", async ({ page }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login$/);
    await page.goto("/rutas");
    await expect(page).not.toHaveURL(/\/login$/);
  });
});

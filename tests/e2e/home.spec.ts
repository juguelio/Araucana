import { expect, test } from "@playwright/test";

test.describe("Home pública", () => {
  test("presenta la propuesta y sus canales de conversión", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Mucho más que/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Reservar mi traslado/ })).toHaveAttribute("href", "/rutas");
    await expect(page.getByRole("link", { name: "Hablar por WhatsApp" }).first()).toHaveAttribute("href", "https://wa.me/5492944649049");
    await expect(page.getByRole("heading", { name: /Del aeropuerto/ })).toBeVisible();
  });

  test("abre el menú responsive", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const menu = page.getByRole("button", { name: "Abrir menú" });
    await expect(menu).toBeVisible();
    await menu.click();
    const mobileNav = page.getByRole("navigation", { name: "Navegación mobile" });
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Traslados", exact: true })).toHaveAttribute("href", "/rutas");
  });
});

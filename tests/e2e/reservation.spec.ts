import { expect, test, type Page } from "@playwright/test";

async function waitForReactFormHydration(page: Page) {
  await page.locator("form").evaluate((form) => {
    return new Promise<void>((resolve, reject) => {
      const hasReactProps = () => Object.keys(form).some((key) => key.startsWith("__reactProps$"));

      if (hasReactProps()) {
        resolve();
        return;
      }

      const timeout = window.setTimeout(() => {
        window.clearInterval(interval);
        reject(new Error("Timed out waiting for the reservation form to hydrate"));
      }, 10_000);

      const interval = window.setInterval(() => {
        if (!hasReactProps()) {
          return;
        }

        window.clearTimeout(timeout);
        window.clearInterval(interval);
        resolve();
      }, 50);
    });
  });
}

test.describe("Reserva web", () => {
  test("permite completar una reserva de un lugar para Villa Traful", async ({ page }) => {
    await page.goto("/rutas/sma-villa-traful-verano-2026");
    await page.getByRole("link", { name: "Reservar asiento" }).click();

    await expect(page).toHaveURL(/\/reservar\/sma-villa-traful-verano-2026$/);
    await waitForReactFormHydration(page);

    const departure = page.locator("label.schedule-option").first();
    await expect(departure).toBeVisible();
    await departure.click();
    await expect(departure.locator('input[name="scheduleId"]')).toBeChecked();

    await page.getByLabel("Nombre").fill("Camila");
    await page.getByLabel("Apellido").fill("Vidal");
    await page.getByLabel("Email").fill(`camila.${Date.now()}@example.com`);
    await page.getByLabel("Codigo de pais").selectOption("+54");
    await page.getByLabel("Telefono").fill("9 294 400 0000");
    await page.getByLabel("Tipo de documento").selectOption("DNI");
    await page.getByLabel("Documento", { exact: true }).fill("30111222");

    await page.getByRole("button", { name: "Confirmar reserva" }).click();

    await expect(page).toHaveURL(/\/reservas\/ARC-/);
    await expect(page.getByText("Reserva confirmada")).toBeVisible();
    await expect(page.getByText("1 lugar", { exact: true }).first()).toBeVisible();
  });
});

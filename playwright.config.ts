import { defineConfig, devices } from "@playwright/test";

const isolatedDatabaseUrl = process.env.E2E_DATABASE_URL;
if (process.env.ARAUCANA_E2E_RUNNER !== "1" || !isolatedDatabaseUrl || process.env.E2E_ISOLATED_DATABASE !== "1") {
  throw new Error("Ejecutá npm run test:e2e con una base aislada explícita.");
}
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const target = new URL(baseURL);
if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.protocol !== "http:") {
  throw new Error("Los e2e sólo pueden apuntar a un servidor local de prueba (localhost); nunca a un entorno publicado.");
}
if (!target.port) {
  throw new Error("PLAYWRIGHT_BASE_URL tiene que indicar el puerto (por ejemplo http://localhost:3000).");
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: `npm run dev -- --hostname ${target.hostname} -p ${target.port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    // The app under test always talks to the isolated database, whatever .env says.
    env: { DATABASE_URL: isolatedDatabaseUrl }
  }
});

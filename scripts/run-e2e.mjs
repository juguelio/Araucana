import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// Same files and precedence as `next dev`, so the identity check sees the database the app would use.
for (const file of [".env.development.local", ".env.local", ".env.development", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
const isolated = process.env.E2E_DATABASE_URL;
if (!isolated || process.env.E2E_ISOLATED_DATABASE !== "1") {
  console.error("E2E bloqueados: configurar E2E_DATABASE_URL con un branch aislado y E2E_ISOLATED_DATABASE=1. No se ejecutan migraciones ni seed automáticamente.");
  process.exit(1);
}
function databaseIdentity(value) {
  const url = new URL(value);
  return `${url.hostname.replace(/-pooler(?=\.)/, "")}${url.pathname}`;
}
if (process.env.DATABASE_URL && databaseIdentity(isolated) === databaseIdentity(process.env.DATABASE_URL)) {
  console.error("E2E bloqueados: la base de prueba coincide con la base habitual.");
  process.exit(1);
}
const result = spawnSync("npx", ["--no-install", "playwright", "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: isolated, ARAUCANA_E2E_RUNNER: "1" }
});
process.exit(result.status ?? 1);

import { describe, expect, it } from "vitest";
import { demoSeedDatabaseUrl } from "./demo-seed-target";

const demo = "postgresql://demo@127.0.0.1:5432/araucana_demo";

describe("destino de la carga de demostración", () => {
  it("requiere una conexión local dedicada aunque exista DATABASE_URL", () => {
    expect(() => demoSeedDatabaseUrl({ DATABASE_URL: demo })).toThrow("Configurá DEMO_DATABASE_URL");
    expect(() => demoSeedDatabaseUrl({
      DEMO_DATABASE_URL: "postgresql://demo@ep-test-pooler.neon.tech/neondb"
    })).toThrow("PostgreSQL local");
    expect(() => demoSeedDatabaseUrl({ DEMO_DATABASE_URL: demo + "?host=example.com" })).toThrow("PostgreSQL local");
  });

  it("reconoce la misma base con otro usuario, alias o esquema", () => {
    expect(() => demoSeedDatabaseUrl({
      DEMO_DATABASE_URL: demo,
      DATABASE_URL: "postgresql://app@localhost/araucana_demo?schema=public"
    })).toThrow("coincide con la base habitual");
  });

  it.each([{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }])("bloquea producción con %o", (env) => {
    expect(() => demoSeedDatabaseUrl({ ...env, DEMO_DATABASE_URL: demo })).toThrow("deshabilitada en producción");
  });

  it("permite una base de demostración local separada", () => {
    expect(demoSeedDatabaseUrl({
      DEMO_DATABASE_URL: demo, DATABASE_URL: "postgresql://app@localhost/araucana"
    })).toBe(demo);
  });
});

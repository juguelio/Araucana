import { describe, expect, it } from "vitest";

// El script corre en el build de Vercel (JS plano, sin paso de compilación): se importa tal cual.
// @ts-expect-error -- módulo .mjs sin declaración de tipos
const { decidir } = await import("../../../scripts/migrate-deploy.mjs");

type Decision = { correr: boolean; motivo?: string; error?: string; url?: string };

const base = { VERCEL: "1", DATABASE_URL: "postgresql://u:p@db.example.com:5432/neondb" } as Record<string, string | undefined>;

describe("migraciones en el build", () => {
  it("no migra nunca desde una máquina local", () => {
    // Es la guarda que importa: el .env de desarrollo apunta a la base compartida y un `npm run build`
    // de escritorio no puede aplicarle migraciones.
    const decision = decidir({ DATABASE_URL: base.DATABASE_URL }) as Decision;
    expect(decision.correr).toBe(false);
    expect(decision.motivo).toContain("no es un build de Vercel");
  });

  it("en Vercel migra contra DIRECT_URL, no contra el pooler", () => {
    const decision = decidir({
      ...base,
      DATABASE_URL: "postgresql://u:p@ep-x-pooler.us-east-1.aws.neon.tech/neondb",
      DIRECT_URL: "postgresql://u:p@ep-x.us-east-1.aws.neon.tech/neondb"
    }) as Decision;
    expect(decision.correr).toBe(true);
    expect(decision.url).toContain("ep-x.us-east-1.aws.neon.tech");
    expect(decision.url).not.toContain("pooler");
    expect(decision.motivo).toContain("DIRECT_URL");
  });

  it("acepta SKIP_MIGRATIONS para un deploy sin base", () => {
    const decision = decidir({ ...base, SKIP_MIGRATIONS: "1" }) as Decision;
    expect(decision.correr).toBe(false);
    expect(decision.motivo).toContain("SKIP_MIGRATIONS");
  });

  it("sin ninguna URL falla en vez de publicar código contra una base sin migrar", () => {
    const decision = decidir({ VERCEL: "1" }) as Decision;
    expect(decision.correr).toBe(false);
    expect(decision.error).toContain("DIRECT_URL");
  });
});

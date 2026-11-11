import { describe, expect, it } from "vitest";
import { assertLocalDatabase, describeDatabaseTarget, UnsafeDatabaseTargetError } from "./local-database";

const NEON = "postgresql://neondb_owner:secreto@ep-calm-wildflower-aqeb2bl0.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require";
const NEON_POOLER = "postgresql://u:p@ep-calm-wildflower-aqeb2bl0-pooler.c-8.us-east-1.aws.neon.tech/neondb";
const LOCAL = "postgresql://altostake@127.0.0.1:5433/araucana_e2e";

describe("base destino de una operación destructiva", () => {
  it("bloquea una base remota (el caso que borró producción)", () => {
    expect(() => assertLocalDatabase(NEON)).toThrow(UnsafeDatabaseTargetError);
    expect(() => assertLocalDatabase(NEON)).toThrow(/Se niega a correr contra ep-calm-wildflower/);
  });

  it("bloquea la URL con pooler de Neon", () => {
    expect(() => assertLocalDatabase(NEON_POOLER)).toThrow(/sólo acepta 127\.0\.0\.1 o localhost/);
  });

  it("acepta 127.0.0.1 y localhost", () => {
    expect(assertLocalDatabase(LOCAL)).toEqual({ host: "127.0.0.1", database: "araucana_e2e", isLocal: true });
    expect(assertLocalDatabase("postgresql://u@localhost:55432/araucana_demo")).toMatchObject({ isLocal: true });
    expect(assertLocalDatabase("postgresql://u@[::1]:5433/araucana")).toMatchObject({ host: "::1", isLocal: true });
  });

  it("bloquea si la URL falta, está vacía o no es Postgres", () => {
    expect(() => assertLocalDatabase(undefined)).toThrow(/necesita una DATABASE_URL válida/);
    expect(() => assertLocalDatabase("")).toThrow(/necesita una DATABASE_URL válida/);
    expect(() => assertLocalDatabase("mysql://u:p@127.0.0.1:3306/db")).toThrow(/necesita una DATABASE_URL válida/);
  });

  it("describe la base sin filtrar credenciales", () => {
    const target = describeDatabaseTarget(NEON);

    expect(target).toEqual({
      host: "ep-calm-wildflower-aqeb2bl0.c-8.us-east-1.aws.neon.tech",
      database: "neondb",
      isLocal: false
    });
    expect(JSON.stringify(target)).not.toContain("secreto");
  });

  it("no confía en una URL que sólo contiene 'localhost' en la base o el usuario", () => {
    expect(describeDatabaseTarget("postgresql://u@db.localhost.example.com:5432/localhost")?.isLocal).toBe(false);
    expect(() => assertLocalDatabase("postgresql://localhost:x@ep-remoto.example.com:5432/x")).toThrow(
      UnsafeDatabaseTargetError
    );
  });

  it("menciona la operación concreta en el error", () => {
    expect(() => assertLocalDatabase(NEON, "«prisma db push»")).toThrow(/«prisma db push» reescribe el esquema/);
  });
});

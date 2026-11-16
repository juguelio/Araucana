import { describe, expect, it, vi } from "vitest";
import { entitySnapshot, listChange, readForAudit, recordEntityAudit, recordEntityAuditAfterCommit } from "./entity";
import { auditChangeLines } from "./labels";

const actor = { id: "u1", name: "Vale", email: "vale@example.com", role: "ADMIN" };
type Row = { data: Record<string, unknown> };
function client() {
  const rows: Row[] = [];
  const create = vi.fn(async (row: Row) => { rows.push(row); });
  return { create, rows, auditLog: { create } };
}

describe("auditoría de un registro cualquiera", () => {
  it("la foto deja afuera lo técnico y las relaciones, salvo el JSON que se pida", () => {
    expect(entitySnapshot({
      id: "r1", createdAt: new Date(), updatedAt: new Date(), from: "SMA", priceCents: 100, isActive: true, notes: null,
      stops: [{ name: "Traful" }], schedules: [{ id: "s1" }], _count: { seats: 3 }
    }, ["stops"])).toEqual({ from: "SMA", priceCents: 100, isActive: true, notes: null, stops: [{ name: "Traful" }] });
    expect(entitySnapshot(null)).toBeNull();
  });

  it("deduce alta, edición y baja, y guarda sólo lo que cambió", async () => {
    const db = client();
    await recordEntityAudit(db, { actor, entity: "ROUTE", entityId: "r1", entityLabel: "SMA → Traful", summary: "Ruta creada.", after: { from: "SMA", notes: null } });
    await recordEntityAudit(db, { actor, entity: "ROUTE", entityId: "r1", summary: "Ruta editada.", before: { from: "SMA", priceCents: 100 }, after: { from: "SMA", priceCents: 150 } });
    await recordEntityAudit(db, { actor, entity: "ROUTE", entityId: "r1", summary: "Ruta borrada.", before: { from: "SMA" } });
    expect(db.rows.map((row) => [row.data.action, row.data.changes])).toEqual([
      ["CREATE", { from: { before: null, after: "SMA" } }],
      ["UPDATE", { priceCents: { before: 100, after: 150 } }],
      ["DELETE", { from: { before: "SMA", after: null } }]
    ]);
    expect(db.rows[0]?.data).toMatchObject({ actorId: "u1", actorRole: "ADMIN", entity: "ROUTE", entityLabel: "SMA → Traful" });
  });

  it("una edición que no cambió nada no deja fila, salvo que traiga cambios aparte", async () => {
    const db = client();
    expect(await recordEntityAudit(db, { actor, entity: "VEHICLE", summary: "Nave editada.", before: { name: "A" }, after: { name: "A" } })).toBe(false);
    expect(db.create).not.toHaveBeenCalled();
    const seats = listChange(["02", "01"], ["01", "02", "03"]);
    expect(seats).toEqual({ before: "01, 02", after: "01, 02, 03" });
    expect(listChange(["01"], ["01"])).toBeNull();
    await recordEntityAudit(db, { actor, entity: "VEHICLE", summary: "Nave editada.", before: { name: "A" }, after: { name: "A" }, extra: { seats: seats! } });
    expect(db.rows[0]?.data.changes).toEqual({ seats: { before: "01, 02", after: "01, 02, 03" } });
    // Un hecho sin fotos para comparar (se guardó una clave) se registra con su resumen.
    expect(await recordEntityAudit(db, { actor, entity: "AIRPORT", action: "UPDATE", entityLabel: "Clave de AirLabs", summary: "Clave de AirLabs guardada." })).toBe(true);
    expect(db.rows[1]?.data).toMatchObject({ action: "UPDATE", summary: "Clave de AirLabs guardada." });
    expect(db.rows[1]?.data).not.toHaveProperty("changes");
  });

  it("después de una escritura ya confirmada, un fallo de la auditoría no se propaga", async () => {
    const failing = { auditLog: { create: async () => { throw new Error("sin base"); } } };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordEntityAudit(failing, { actor, entity: "AIRPORT", summary: "x", after: { a: 1 } })).rejects.toThrow("sin base");
    await expect(recordEntityAuditAfterCommit(failing, { actor, entity: "AIRPORT", summary: "x", after: { a: 1 } })).resolves.toBe(false);
    await expect(readForAudit(async () => { throw new Error("sin base"); })).resolves.toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("los campos nuevos se leen en castellano y las listas largas se recortan", () => {
    const lines = auditChangeLines({
      priceCents: { before: 100000, after: 150000 },
      vehicle: { before: "Sprinter 1", after: "Sprinter 2" },
      legs: { before: null, after: Array.from({ length: 40 }, (_, i) => ({ description: `Tramo ${i}` })) }
    });
    expect(lines.map((line) => line.label)).toEqual(["Precio", "Nave", "Tramos"]);
    expect(auditChangeLines({ serviceDate: { before: null, after: "2026-11-16T00:00:00.000Z" } })[0]?.after).toBe("16/11/2026");
    expect(lines[2]?.after.length).toBeLessThanOrEqual(281);
    expect(lines[2]?.after.endsWith("…")).toBe(true);
  });
});

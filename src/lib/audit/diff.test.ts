import { describe, expect, it } from "vitest";
import { diffRecords, flattenRecord, hasChanges, HIDDEN_VALUE } from "./diff";
import { auditRow } from "./record";
import { reservationAuditSnapshot } from "./reservation";
import { auditChangeLines } from "./labels";
import { auditOrderBy, auditPageHref, auditWhere, parseAuditFilters } from "./query";

describe("diferencia para la auditoría", () => {
  it("guarda sólo los campos que cambiaron, con el antes y el después", () => {
    const changes = diffRecords(
      { status: "PENDING_PAYMENT", totalCents: 1000, referredBy: null },
      { status: "CONFIRMED", totalCents: 1000, referredBy: undefined }
    );
    expect(changes).toEqual({ status: { before: "PENDING_PAYMENT", after: "CONFIRMED" } });
  });

  it("un alta y una baja dejan la foto completa de un solo lado", () => {
    expect(diffRecords(null, { name: "Ana", notes: null })).toEqual({ name: { before: null, after: "Ana" } });
    expect(diffRecords({ name: "Ana" }, null)).toEqual({ name: { before: "Ana", after: null } });
    expect(hasChanges(diffRecords({ a: 1 }, { a: 1 }))).toBe(false);
  });

  it("compara fechas por su valor y nunca copia una contraseña", () => {
    const day = new Date("2026-11-16T12:00:00.000Z");
    expect(diffRecords({ occurredAt: day }, { occurredAt: new Date(day) })).toEqual({});
    expect(diffRecords({ passwordHash: "viejo" }, { passwordHash: "nuevo" })).toEqual({
      passwordHash: { before: HIDDEN_VALUE, after: HIDDEN_VALUE }
    });
  });

  it("aplana las relaciones a un nivel", () => {
    expect(flattenRecord({ status: "X", payment: { status: "PENDING" } })).toEqual({ status: "X", "payment.status": "PENDING" });
  });
});

describe("foto de una reserva", () => {
  it("toma los datos editables y deja afuera el comprobante", () => {
    const snapshot = reservationAuditSnapshot({
      status: "PENDING_PAYMENT", totalCents: 5000, updatedAt: new Date(),
      payment: { status: "PENDING", receiptBlobUrl: "https://blob/x", amountCents: 5000 },
      passenger: { firstName: "Ana", lastName: "Paz", id: "p1" },
      airportDetails: null,
      chapelcoDetails: { pickupAddress: "Av. San Martín 100", ascentSlot: "AM" }
    });
    expect(snapshot).toEqual({
      status: "PENDING_PAYMENT", totalCents: 5000,
      "payment.status": "PENDING", "payment.amountCents": 5000,
      "passenger.firstName": "Ana", "passenger.lastName": "Paz",
      "pickup.pickupAddress": "Av. San Martín 100"
    });
  });
});

describe("fila de auditoría", () => {
  it("copia al actor tal como era y trata la falta de actor como sistema", () => {
    const row = auditRow({
      actor: { id: "u1", name: " Ana ", email: "ana@example.com", role: "SECRETARY" },
      action: "CANCEL", entity: "RESERVATION", entityId: "r1", entityLabel: "ARC-1", summary: "Reserva cancelada.",
      changes: {}
    });
    expect(row).toMatchObject({ actorId: "u1", actorName: "Ana", actorRole: "SECRETARY", action: "CANCEL" });
    expect(row).not.toHaveProperty("changes");
    expect(auditRow({ action: "CREATE", entity: "USER", summary: "x" })).toMatchObject({ actorId: null, actorRole: "SYSTEM" });
  });
});

describe("lectura en pantalla", () => {
  it("traduce campos, estados e importes", () => {
    expect(auditChangeLines({
      status: { before: "PENDING_PAYMENT", after: "CANCELLED" },
      isActive: { before: true, after: false },
      "passenger.phone": { before: null, after: "2944" }
    })).toEqual([
      { field: "status", label: "Estado", before: "Pago pendiente", after: "Cancelada" },
      { field: "isActive", label: "Cuenta activa", before: "Sí", after: "No" },
      { field: "passenger.phone", label: "Pasajero · teléfono", before: "—", after: "2944" }
    ]);
    expect(auditChangeLines({ totalCents: { before: 100000, after: 250000 } })[0].after).toContain("2.500");
    expect(auditChangeLines({ category: { before: null, after: "FUEL" }, occurredAt: { before: null, after: "2026-11-16T00:00:00.000Z" } }))
      .toMatchObject([{ after: "Combustible" }, { after: "16/11/2026" }]);
    expect(auditChangeLines(null)).toEqual([]);
  });
});

describe("filtros de la pantalla", () => {
  it("descarta valores inválidos y arma el rango por día argentino", () => {
    const filters = parseAuditFilters({ entity: "OTRA", action: "LOGIN", from: "2026-11-16", to: "2026-11-16", page: "-3", q: "  ana " });
    expect(filters).toEqual({ q: "ana", entity: "", action: "LOGIN", from: "2026-11-16", to: "2026-11-16", page: 1, orden: { columna: "fecha", direccion: "desc" } });
    const where = auditWhere(filters);
    expect(where.action).toBe("LOGIN");
    expect(where.createdAt).toEqual({ gte: new Date("2026-11-16T03:00:00.000Z"), lt: new Date("2026-11-17T03:00:00.000Z") });
    expect(where.OR).toHaveLength(5);
    expect(auditWhere(parseAuditFilters({}))).toEqual({});
  });

  it("ordena sólo por columnas declaradas y la paginación conserva filtros y orden", () => {
    expect(parseAuditFilters({ orden: "summary", dir: "asc" }).orden).toEqual({ columna: "fecha", direccion: "desc" });
    const filters = parseAuditFilters({ q: "ana", orden: "quien", dir: "asc", page: "2" });
    expect(auditOrderBy(filters.orden)[0]).toEqual({ actorName: { sort: "asc", nulls: "last" } });
    expect(auditOrderBy(filters.orden).at(-1)).toEqual({ id: "desc" });
    expect(auditPageHref(filters, 3)).toBe("/admin/auditoria?q=ana&orden=quien&dir=asc&page=3");
  });
});

import { describe, it, expect } from "vitest";
import {
  readStatement,
  compareStatement,
  currencySummary,
  statementHeader,
  type BankRow,
  type LedgerPayment,
} from "./reconciliation";

const b: BankRow = { date: "2026-11-10", reference: " REF ", cents: 123456, currency: "ARS" };
const p: LedgerPayment = { ...b, code: "ABC", reference: "ref" };
const read = (...rows: unknown[][]) => readStatement([statementHeader, ...rows], "2026-11");
describe("cotejo bancario", () => {
  it("acepta fechas de Excel y texto argentino, mantiene ceros de la referencia y centavos", () => {
    expect(
      read([new Date("2026-11-10"), "001", "1.234,56", "ars"], ["10/11/2026", "", -12.01, "USD"]),
    ).toEqual([
      { ...b, reference: "001" },
      { ...b, reference: "", currency: "USD", cents: -1201 },
    ]);
  });
  it.each([
    ["31/11/2026", "2,00"],
    ["01/12/2026", "2,00"],
    ["10/11/2026", "3.2"],
    ["10/11/2026", 1.234],
  ])("rechaza fecha o importe inválido", (date, amount) => {
    expect(() => read([date, "abc", amount, "ARS"])).toThrow("Fila 2");
  });
  it("compara por referencia o reserva y conserva cada moneda", () => {
    expect(compareStatement([b], [p])).toEqual([{ status: "Coincidencia exacta", bank: b, payment: p }]);
    expect(compareStatement([{ ...b, reference: "ABC", cents: 123455 }], [p])[0].status).toBe(
      "Revisar importe",
    );
    expect(compareStatement([{ ...b, currency: "USD" }], [p])[0].status).toBe("Revisar moneda");
  });
  it("bloquea referencias repetidas en cualquiera de los dos lados", () => {
    expect(compareStatement([b, { ...b, reference: "ABC" }], [p]).map((r) => r.status)).toEqual([
      "Referencia ambigua",
      "Referencia ambigua",
      "Pago con referencia ambigua",
    ]);
    expect(
      compareStatement([b], [p, { ...p, code: "DEF" }]).filter((r) => r.status === "Coincidencia exacta"),
    ).toHaveLength(0);
  });
  it("totaliza cada lado una sola vez, incluso con una ambigüedad y monedas distintas", () => {
    const rows = compareStatement([b, b, { ...b, cents: -300, currency: "USD" }], [p]);
    expect(currencySummary(rows)).toEqual([
      { currency: "ARS", credits: 246912, debits: 0, approved: 123456 },
      { currency: "USD", credits: 0, debits: 300, approved: 0 },
    ]);
  });
  it("expone ambos lados y mantiene los débitos separados", () => {
    expect(
      compareStatement(
        [
          { ...b, reference: "" },
          { ...b, cents: -300 },
        ],
        [p],
      ).map((r) => r.status),
    ).toEqual(["Sin pago identificado", "Débito o ajuste", "Pago sin acreditar en el extracto"]);
  });
});

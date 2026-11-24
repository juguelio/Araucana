import { describe, expect, it } from "vitest";
import { COMPANY_CUIT } from "@/lib/company";
import { getManualBankDetails } from "./manual-bank-details";

const base = {
  MANUAL_PAYMENT_HOLDER: "La Araucana Viajes",
  MANUAL_PAYMENT_BANK: "Banco de la Nación Argentina",
  MANUAL_PAYMENT_CBU: "0".repeat(22)
};

describe("datos bancarios del pago manual", () => {
  it("muestra el CUIT de La Araucana aunque la variable de entorno no esté configurada", () => {
    expect(getManualBankDetails(base)?.cuit).toBe(COMPANY_CUIT);
    expect(getManualBankDetails({ ...base, MANUAL_PAYMENT_CUIT: "   " })?.cuit).toBe(COMPANY_CUIT);
  });

  it("permite pisar el CUIT por configuración", () => {
    expect(getManualBankDetails({ ...base, MANUAL_PAYMENT_CUIT: "20-12345678-9" })?.cuit).toBe("20-12345678-9");
  });

  it("sin datos bancarios válidos no arma un panel con CUIT suelto", () => {
    expect(getManualBankDetails({
      MANUAL_PAYMENT_HOLDER: base.MANUAL_PAYMENT_HOLDER,
      MANUAL_PAYMENT_BANK: base.MANUAL_PAYMENT_BANK,
      MANUAL_PAYMENT_CBU: "123"
    })).toBeNull();
  });
});

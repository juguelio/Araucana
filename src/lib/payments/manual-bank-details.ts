export type ManualBankDetails = {
  holder: string;
  bank: string;
  accountType: string;
  cbu: string;
  alias: string;
  cuit: string;
};

export function getManualBankDetails(env: Record<string, string | undefined> = process.env): ManualBankDetails | null {
  const holder = env.MANUAL_PAYMENT_HOLDER?.trim();
  const bank = env.MANUAL_PAYMENT_BANK?.trim();
  const cbu = env.MANUAL_PAYMENT_CBU?.trim() ?? "";
  const alias = env.MANUAL_PAYMENT_ALIAS?.trim() ?? "";
  if (!holder || !bank || (!cbu && !alias) || (cbu && !/^\d{22}$/.test(cbu))) return null;
  return { holder, bank, cbu, alias, accountType: env.MANUAL_PAYMENT_ACCOUNT_TYPE?.trim() ?? "", cuit: env.MANUAL_PAYMENT_CUIT?.trim() ?? "" };
}

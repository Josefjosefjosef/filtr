import { PREMIUM_INVOICE_SUPPLIER } from "./premium-invoice-supplier";
import { czechBankAccountToIban } from "./premium-invoice-iban";

export type SpaydPaymentInput = {
  amountCents: number;
  currency: string;
  variableSymbol: string;
  message?: string;
};

/** QR Platba / SPAYD payload (CZ standard). */
export function buildPremiumInvoiceSpayd(input: SpaydPaymentInput): string {
  const sup = PREMIUM_INVOICE_SUPPLIER;
  const iban = czechBankAccountToIban(sup.bankCode, sup.accountNumber, sup.accountPrefix);
  const amount = (input.amountCents / 100).toFixed(2);
  const parts = [
    "SPD*1.0",
    "ACC:" + iban,
    "AM:" + amount,
    "CC:" + (input.currency || "CZK").toUpperCase(),
    "X-VS:" + String(input.variableSymbol).replace(/\D/g, "").slice(0, 10),
  ];
  const msg = (input.message || "Faktura InfoUzel Ads").replace(/\*/g, " ").trim().slice(0, 60);
  if (msg) parts.push("MSG:" + msg);
  return parts.join("*");
}

export function parseSpaydFields(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = payload.startsWith("SPD*") ? payload.slice(4) : payload;
  const segments = body.split("*");
  if (segments[0]?.includes(".")) out.version = segments.shift() || "";
  for (const seg of segments) {
    const idx = seg.indexOf(":");
    if (idx <= 0) continue;
    out[seg.slice(0, idx)] = seg.slice(idx + 1);
  }
  return out;
}

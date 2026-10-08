/**
 * Premium invoice VAT mode — current production: non-payer.
 * Future payer switch must update config + effective date, not historical PDFs.
 */
export type PremiumVatMode = "non_payer" | "payer";

export type PremiumVatConfig = {
  mode: PremiumVatMode;
  registrationEffectiveFrom: string | null;
  supplierDic: string | null;
  defaultRatePercent: number | null;
};

export const PREMIUM_VAT_CONFIG: PremiumVatConfig = {
  mode: "non_payer",
  registrationEffectiveFrom: null,
  supplierDic: null,
  defaultRatePercent: 21,
};

export type PremiumVatLine = {
  netCents: number;
  vatCents: number;
  grossCents: number;
  ratePercent: number | null;
  nonVatNotice: string | null;
};

export function resolvePremiumInvoiceVat(totalCents: number, atIso: string, config: PremiumVatConfig = PREMIUM_VAT_CONFIG): PremiumVatLine {
  const effective =
    config.mode === "payer" &&
    config.registrationEffectiveFrom &&
    atIso >= config.registrationEffectiveFrom;
  if (!effective) {
    return {
      netCents: totalCents,
      vatCents: 0,
      grossCents: totalCents,
      ratePercent: null,
      nonVatNotice: "Cena není předmětem DPH (dodavatel není plátce DPH).",
    };
  }
  const rate = config.defaultRatePercent ?? 21;
  const netCents = Math.round(totalCents / (1 + rate / 100));
  const vatCents = totalCents - netCents;
  return {
    netCents,
    vatCents,
    grossCents: totalCents,
    ratePercent: rate,
    nonVatNotice: null,
  };
}

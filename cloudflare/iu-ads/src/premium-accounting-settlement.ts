import type { PremiumPaymentSettlementMode } from "./premium-czech-money";

export type AccountingSettlementRecap = {
  original_invoice_cents: number;
  prior_corrected_cents: number;
  remaining_correctable_cents: number;
  storno_amount_cents: number;
  credit_note_cents: number;
  new_service_price_cents: number;
  amount_paid_cents: number;
  remaining_due_cents: number;
  overpayment_cents: number;
};

export function sumPriorCreditCorrectionsCents(rows: { correction_cents: number }[]): number {
  let sum = 0;
  for (const row of rows) {
    const c = Math.round(Number(row.correction_cents) || 0);
    if (c < 0) sum += Math.abs(c);
  }
  return sum;
}

export function computeAccountingSettlementRecap(input: {
  originalInvoiceCents: number;
  priorCorrectedCents: number;
  stornoAmountCents: number;
  paymentMode: PremiumPaymentSettlementMode;
  amountPaidCents: number;
}): AccountingSettlementRecap {
  const original = Math.max(0, Math.round(input.originalInvoiceCents || 0));
  const prior = Math.max(0, Math.round(input.priorCorrectedCents || 0));
  const remainingCorrectable = Math.max(0, original - prior);
  const storno = Math.max(0, Math.round(input.stornoAmountCents || 0));
  const creditNote = -storno;
  const newService = Math.max(0, original + creditNote);
  let paid = Math.max(0, Math.round(input.amountPaidCents || 0));
  if (input.paymentMode === "unpaid") paid = 0;
  if (input.paymentMode === "paid") paid = original;
  const remainingDue = Math.max(0, newService - paid);
  const overpayment = Math.max(0, paid - newService);
  return {
    original_invoice_cents: original,
    prior_corrected_cents: prior,
    remaining_correctable_cents: remainingCorrectable,
    storno_amount_cents: storno,
    credit_note_cents: creditNote,
    new_service_price_cents: newService,
    amount_paid_cents: paid,
    remaining_due_cents: remainingDue,
    overpayment_cents: overpayment,
  };
}

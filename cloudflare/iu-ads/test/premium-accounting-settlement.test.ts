import { describe, expect, it } from "vitest";
import { computeAccountingSettlementRecap, sumPriorCreditCorrectionsCents } from "../src/premium-accounting-settlement";
import { parseCzechMoneyToCents, validatePremiumStornoReason } from "../src/premium-czech-money";

describe("premium accounting settlement", () => {
  it("parses Czech money with comma", () => {
    expect(parseCzechMoneyToCents("3 000,50")).toEqual({ ok: true, cents: 300050 });
    expect(parseCzechMoneyToCents("0").ok).toBe(false);
    expect(parseCzechMoneyToCents("abc").ok).toBe(false);
  });

  it("validates storno reason length", () => {
    expect(validatePremiumStornoReason("Krátký").ok).toBe(false);
    expect(validatePremiumStornoReason("Zákazník požádal o zrušení reklamní služby.").ok).toBe(true);
  });

  it("sums prior credit corrections", () => {
    const sum = sumPriorCreditCorrectionsCents([{ correction_cents: -100000 }, { correction_cents: -50000 }]);
    expect(sum).toBe(150000);
  });

  it("computes overpayment when paid exceeds new service price", () => {
    const r = computeAccountingSettlementRecap({
      originalInvoiceCents: 569000,
      priorCorrectedCents: 0,
      stornoAmountCents: 300000,
      paymentMode: "paid",
      amountPaidCents: 569000,
    });
    expect(r.new_service_price_cents).toBe(269000);
    expect(r.overpayment_cents).toBe(300000);
    expect(r.remaining_due_cents).toBe(0);
  });

  it("computes underpayment for partial pay", () => {
    const r = computeAccountingSettlementRecap({
      originalInvoiceCents: 569000,
      priorCorrectedCents: 0,
      stornoAmountCents: 300000,
      paymentMode: "partial",
      amountPaidCents: 200000,
    });
    expect(r.remaining_due_cents).toBe(69000);
  });
});

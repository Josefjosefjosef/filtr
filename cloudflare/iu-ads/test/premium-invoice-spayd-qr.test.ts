import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { czechBankAccountToIban } from "../src/premium-invoice-iban";
import { buildPremiumInvoiceSpayd, parseSpaydFields } from "../src/premium-invoice-spayd";
import { buildPremiumInvoiceQrPng } from "../src/premium-invoice-qr";
import { PREMIUM_INVOICE_SUPPLIER } from "../src/premium-invoice-supplier";
import { PREMIUM_VAT_CONFIG, resolvePremiumInvoiceVat } from "../src/premium-invoice-vat";
import { buildPremiumInvoicePdf } from "../src/premium-invoice-pdf";

describe("premium invoice SPAYD + QR", () => {
  it("computes canonical CZ IBAN for supplier account", () => {
    const iban = czechBankAccountToIban(
      PREMIUM_INVOICE_SUPPLIER.bankCode,
      PREMIUM_INVOICE_SUPPLIER.accountNumber,
      PREMIUM_INVOICE_SUPPLIER.accountPrefix
    );
    expect(iban).toMatch(/^CZ[0-9]{22}$/);
    expect(iban).toBe("CZ9155000000000294822412");
  });

  it("builds SPAYD with amount, currency, VS, IBAN", () => {
    const spayd = buildPremiumInvoiceSpayd({
      amountCents: 539000,
      currency: "CZK",
      variableSymbol: "2026001234",
    });
    expect(spayd.startsWith("SPD*1.0*")).toBe(true);
    const fields = parseSpaydFields(spayd);
    expect(fields.ACC).toMatch(/^CZ/);
    expect(fields.AM).toBe("5390.00");
    expect(fields.CC).toBe("CZK");
    expect(fields["X-VS"]).toBe("2026001234");
  });

  it("QR PNG decodes back to SPAYD payload", async () => {
    const spayd = buildPremiumInvoiceSpayd({
      amountCents: 10000,
      currency: "CZK",
      variableSymbol: "123456",
    });
    const pngBytes = await buildPremiumInvoiceQrPng(spayd, 120);
    const png = PNG.sync.read(Buffer.from(pngBytes));
    const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(code?.data).toBe(spayd);
  });

  it("embeds QR in invoice PDF", async () => {
    const pdf = await buildPremiumInvoicePdf({
      invoice_number: "INV-2026-QR",
      variable_symbol: "20260099",
      issued_at: "2026-03-02T09:00:00.000Z",
      due_at: "2026-03-05T09:00:00.000Z",
      taxable_date: "2026-03-02T09:00:00.000Z",
      buyer_company: "Test s.r.o.",
      buyer_ico: "12345678",
      buyer_dic: null,
      buyer_address_lines: ["Ulice 1", "110 00 Praha"],
      buyer_registry: null,
      line_description: "Reklamní umístění — test",
      service_period_start: "2026-03-02T09:00:00.000Z",
      service_period_end: "2026-09-02T09:00:00.000Z",
      total_cents: 539000,
      currency: "CZK",
      order_reference: "AD-2026-REF",
      category_title_cs: "Test kategorie",
      position_label: "P1",
      duration_months: 6,
    });
    expect(pdf.byteLength).toBeGreaterThan(1500);
  });
});

describe("premium invoice VAT modes", () => {
  it("keeps current non-payer mode unchanged", () => {
    expect(PREMIUM_VAT_CONFIG.mode).toBe("non_payer");
    const line = resolvePremiumInvoiceVat(100000, "2026-01-01T00:00:00.000Z");
    expect(line.vatCents).toBe(0);
    expect(line.nonVatNotice).toContain("není plátce");
  });

  it("future payer mode computes VAT split in test", () => {
    const line = resolvePremiumInvoiceVat(121000, "2027-06-01T00:00:00.000Z", {
      mode: "payer",
      registrationEffectiveFrom: "2027-01-01T00:00:00.000Z",
      supplierDic: "CZ29482241",
      defaultRatePercent: 21,
    });
    expect(line.vatCents).toBeGreaterThan(0);
    expect(line.grossCents).toBe(121000);
  });
});

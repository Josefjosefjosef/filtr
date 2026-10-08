import { describe, expect, it } from "vitest";
import { buildPremiumInvoicePdf } from "../src/premium-invoice-pdf";
import { buildPremiumInvoiceSpayd, parseSpaydFields } from "../src/premium-invoice-spayd";
import {
  decodeSpaydFromInvoicePdfBytes,
  findEmbeddedPngsInPdf,
  pdfBytesContainNeedle,
} from "../src/premium-invoice-pdf-qr-extract";

const sampleInvoiceInput = {
  invoice_number: "INV-2026-PROD-QR",
  variable_symbol: "2026007777",
  issued_at: "2026-03-02T09:00:00.000Z",
  due_at: "2026-03-05T09:00:00.000Z",
  taxable_date: "2026-03-02T09:00:00.000Z",
  buyer_company: "Test s.r.o.",
  buyer_ico: "12345678",
  buyer_dic: null,
  buyer_address_lines: ["Ulice 1", "110 00 Praha"],
  line_description: "Reklamní umístění — test",
  service_period_start: "2026-03-02T09:00:00.000Z",
  service_period_end: "2026-09-02T09:00:00.000Z",
  total_cents: 539000,
  currency: "CZK",
  order_reference: "AD-2026-REF",
  category_title_cs: "Test kategorie",
  position_label: "P1",
  duration_months: 6,
};

describe("premium invoice PDF QR extract", () => {
  it("finds PNG and decodes SPAYD matching canonical payment fields", async () => {
    const pdf = await buildPremiumInvoicePdf(sampleInvoiceInput);
    const spayd = await decodeSpaydFromInvoicePdfBytes(pdf);
    expect(spayd).toBeTruthy();
    const expected = buildPremiumInvoiceSpayd({
      amountCents: sampleInvoiceInput.total_cents,
      currency: sampleInvoiceInput.currency,
      variableSymbol: sampleInvoiceInput.variable_symbol,
    });
    const fields = parseSpaydFields(spayd!);
    const exp = parseSpaydFields(expected);
    expect(fields.ACC).toBe(exp.ACC);
    expect(fields.AM).toBe("5390.00");
    expect(fields.CC).toBe("CZK");
    expect(fields["X-VS"]).toBe("2026007777");
  });

  it("PDF embeds decodable QR image stream", async () => {
    const pdf = await buildPremiumInvoicePdf(sampleInvoiceInput);
    expect(await decodeSpaydFromInvoicePdfBytes(pdf)).toContain("SPD*1.0");
  });
});

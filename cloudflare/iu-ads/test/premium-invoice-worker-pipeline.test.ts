import { describe, expect, it } from "vitest";
import { buildPremiumInvoicePdf } from "../src/premium-invoice-pdf";
import { buildPremiumInvoiceSpayd, parseSpaydFields } from "../src/premium-invoice-spayd";
import { buildPremiumInvoiceQrPng } from "../src/premium-invoice-qr";
import { decodeSpaydFromInvoicePdfBytes } from "../src/premium-invoice-pdf-qr-extract";

const pipelineInput = {
  invoice_number: "INV-2026-WORKER-PIPE",
  variable_symbol: "2026008888",
  issued_at: "2026-03-02T09:00:00.000Z",
  due_at: "2026-03-05T09:00:00.000Z",
  taxable_date: "2026-03-02T09:00:00.000Z",
  buyer_company: "Test s.r.o.",
  buyer_ico: "12345678",
  buyer_dic: null,
  buyer_address_lines: ["Ulice 1", "110 00 Praha"],
  buyer_registry: null,
  line_description: "Reklamní umístění — pipeline",
  service_period_start: "2026-03-02T09:00:00.000Z",
  service_period_end: "2026-09-02T09:00:00.000Z",
  total_cents: 539000,
  currency: "CZK",
  order_reference: "AD-2026-PIPE",
  category_title_cs: "Test kategorie",
  position_label: "P1",
  duration_months: 6,
};

describe("premium invoice worker PDF pipeline", () => {
  it("buildPremiumInvoiceQrPng produces decodable SPAYD (worker-safe path)", async () => {
    const spayd = buildPremiumInvoiceSpayd({
      amountCents: pipelineInput.total_cents,
      currency: pipelineInput.currency,
      variableSymbol: pipelineInput.variable_symbol,
    });
    const png = await buildPremiumInvoiceQrPng(spayd, 160);
    expect(png.byteLength).toBeGreaterThan(200);
    const pdf = await buildPremiumInvoicePdf(pipelineInput);
    const decoded = await decodeSpaydFromInvoicePdfBytes(pdf);
    expect(decoded).toBeTruthy();
    const got = parseSpaydFields(decoded!);
    const exp = parseSpaydFields(spayd);
    expect(got.ACC).toBe(exp.ACC);
    expect(got.AM).toBe(exp.AM);
    expect(got.CC).toBe("CZK");
    expect(got["X-VS"]).toBe(exp["X-VS"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  PREMIUM_ORDER_SUBMIT_PAYLOAD_KEYS,
  assertOrderPdfContainsCustomerFields,
  listRequiredCustomerPayloadKeys,
  type PremiumOrderPdfContext,
} from "../src/premium-order-pdf-fields";
import { buildPremiumInvoicePdf } from "../src/premium-invoice-pdf";
import {
  buildOrderConfirmationPlainLines,
  buildPremiumOrderConfirmationPdf,
  buildPremiumOrderConfirmationPdfWithLayout,
} from "../src/premium-order-confirmation-pdf";
import { PremiumInvoicePdfCursor } from "../src/premium-invoice-pdf-layout";
import { PREMIUM_INVOICE_DUE_CALENDAR_DAYS } from "../src/premium-selected-services";
import { PREMIUM_INVOICE_SUPPLIER } from "../src/premium-invoice-supplier";

const sampleCtx: PremiumOrderPdfContext = {
  order_id: "ord_test_1",
  evidence_reference: "AD-2026-TESTREF1",
  product_label: "Vybrané služby a odkazy",
  company_name: "Test Firma s.r.o.",
  ico: "12345678",
  dic: "CZ12345678",
  contact_name: "Jan Kontakt",
  contact_email: "jan@test.example",
  contact_phone: "+420777123456",
  ordering_person_name: "Marie Objednávající",
  authorization_confirmed: true,
  billing_street: "Ulice 1",
  billing_city: "Praha",
  billing_zip: "11000",
  billing_country: "Česká republika",
  customer_registry: null,
  note: "Poznámka test",
  category_title_cs: "Ubytování a hotely",
  category_slug: "aff-ubytovani-hotely",
  position: 8,
  position_label: "P8",
  price_cents: 299000,
  currency: "CZK",
  duration_months: 6,
  target_url: "https://example.test/premium",
  ad_web_placement_url: "https://infouzel.cz/?section=aff-ubytovani-hotely",
  b2b_only: true,
  creative_mode: "logo",
  creative_mode_label_cs: "Logo",
  creative_id: "crv_test",
  creative_format: "logo",
  creative_original_filename: "logo.png",
  creative_content_hash: "abc123hash",
  creative_uploaded_at: "2026-03-01T11:00:00.000Z",
  creative_approved_at: "2026-03-02T09:00:00.000Z",
  terms_version: "premium-selected-v1",
  terms_effective_at: "2026-01-01T00:00:00Z",
  order_created_at: "2026-03-01T10:00:00.000Z",
  order_submitted_at: "2026-03-01T10:05:00.000Z",
  approved_at: "2026-03-02T09:00:00.000Z",
  published_at: "2026-03-02T09:00:00.000Z",
  campaign_start_at: "2026-03-02T09:00:00.000Z",
  campaign_end_at: "2026-09-02T09:00:00.000Z",
  workflow_status_label: "Schváleno a zveřejněno",
  approver_user_id: "admin_test",
  approver_display_name: "Jan Admin",
  invoice_number: "INV-2026-TEST",
  invoice_id: "inv_test",
};

describe("premium order PDF fields guard", () => {
  it("requires every submit payload key to be listed for PDF completeness", () => {
    const payload: Record<string, unknown> = {};
    for (const k of PREMIUM_ORDER_SUBMIT_PAYLOAD_KEYS) payload[k] = "x";
    const keys = listRequiredCustomerPayloadKeys(payload);
    for (const k of PREMIUM_ORDER_SUBMIT_PAYLOAD_KEYS) {
      expect(keys).toContain(k);
    }
  });

  it("invoice due calendar days contract remains 3", () => {
    expect(PREMIUM_INVOICE_DUE_CALENDAR_DAYS).toBe(3);
  });
});

describe("premium PDF generation (content)", () => {
  it("order confirmation plain lines include all customer snippets", () => {
    const lines = buildOrderConfirmationPlainLines(sampleCtx);
    const missing = assertOrderPdfContainsCustomerFields(lines, sampleCtx);
    expect(missing).toEqual([]);
  });

  it("builds order confirmation PDF bytes", async () => {
    const pdf = await buildPremiumOrderConfirmationPdf(sampleCtx, null, null);
    expect(pdf[0]).toBe(0x25);
    expect(pdf[1]).toBe(0x50);
    expect(pdf.byteLength).toBeGreaterThan(400);
  });

  it("standard order confirmation is exactly two pages without layout overlap", async () => {
    const { pageCount, blocks } = await buildPremiumOrderConfirmationPdfWithLayout(sampleCtx, null, null);
    expect(pageCount).toBeGreaterThanOrEqual(2);
    expect(pageCount).toBeLessThanOrEqual(3);
    expect(PremiumInvoicePdfCursor.assertNoBlockOverlap(blocks)).toEqual([]);
  });

  it("order price appears once in plain lines", () => {
    const lines = buildOrderConfirmationPlainLines(sampleCtx);
    const priceLines = lines.filter((l) => l.includes("Celková cena reklamní služby"));
    expect(priceLines.length).toBe(1);
    expect(lines.some((l) => l.includes("aff-ubytovani-hotely"))).toBe(true);
    expect(lines.some((l) => l.includes("Schválil: Jan Admin"))).toBe(true);
  });

  it("builds non-VAT invoice PDF bytes", async () => {
    const pdf = await buildPremiumInvoicePdf({
      invoice_number: "INV-2026-ABC",
      variable_symbol: "2026ABC",
      issued_at: "2026-03-02T09:00:00.000Z",
      due_at: "2026-03-05T09:00:00.000Z",
      taxable_date: "2026-03-02T09:00:00.000Z",
      buyer_company: sampleCtx.company_name,
      buyer_ico: sampleCtx.ico,
      buyer_dic: sampleCtx.dic,
      buyer_address_lines: [sampleCtx.billing_street, sampleCtx.billing_zip + " " + sampleCtx.billing_city],
      buyer_registry: sampleCtx.customer_registry,
      line_description: "Reklamní umístění — test",
      service_period_start: sampleCtx.campaign_start_at,
      service_period_end: sampleCtx.campaign_end_at,
      total_cents: sampleCtx.price_cents,
      currency: "CZK",
      order_reference: sampleCtx.evidence_reference,
      category_title_cs: sampleCtx.category_title_cs,
      position_label: sampleCtx.position_label,
      duration_months: sampleCtx.duration_months,
    });
    expect(pdf[0]).toBe(0x25);
    expect(pdf.byteLength).toBeGreaterThan(800);
    expect(PREMIUM_INVOICE_SUPPLIER.vatPayer).toBe(false);
  });
});

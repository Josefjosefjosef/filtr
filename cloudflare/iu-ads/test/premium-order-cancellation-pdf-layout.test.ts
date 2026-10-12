import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildPremiumOrderCancellationPdf } from "../src/premium-order-cancellation-pdf";
import type { PremiumOrderPdfContext } from "../src/premium-order-pdf-fields";

function baseCtx(overrides: Partial<PremiumOrderPdfContext> = {}): PremiumOrderPdfContext {
  return {
    order_id: "ord_storno_layout",
    evidence_reference: "AD-2026-LAYOUT01",
    product_label: "Vybrané služby a odkazy",
    company_name: "Test s.r.o.",
    ico: "27076831",
    dic: null,
    contact_name: "Kontakt",
    contact_email: "a@test.example",
    contact_phone: null,
    ordering_person_name: null,
    authorization_confirmed: true,
    billing_street: "Ulice 1",
    billing_city: "Praha",
    billing_zip: "11000",
    billing_country: "CZ",
    customer_registry: null,
    note: null,
    category_title_cs: "Software a bezpečnost",
    category_slug: "aff-software-bezpecnost",
    position: 1,
    position_label: "P1",
    price_cents: 599000,
    currency: "CZK",
    duration_months: 6,
    target_url: "https://example.test/",
    ad_web_placement_url: null,
    b2b_only: true,
    creative_mode: "banner",
    creative_mode_label_cs: "Banner",
    creative_id: null,
    creative_format: null,
    creative_original_filename: null,
    creative_content_hash: null,
    creative_uploaded_at: null,
    creative_approved_at: null,
    terms_version: "v1",
    terms_effective_at: "2026-01-01",
    order_created_at: "2026-10-01T10:00:00.000Z",
    order_submitted_at: "2026-10-01T10:00:00.000Z",
    approved_at: "2026-10-02T10:00:00.000Z",
    published_at: "2026-10-02T10:00:00.000Z",
    campaign_start_at: "2026-10-02T10:00:00.000Z",
    campaign_end_at: "2027-04-02T10:00:00.000Z",
    workflow_status_label: "Schváleno",
    approver_user_id: null,
    approver_display_name: "Admin",
    invoice_number: "INV-2026-TEST",
    invoice_id: "inv_test",
    ...overrides,
  };
}

describe("premium order cancellation PDF layout", () => {
  it("renders pre-publish rejection storno on one page", async () => {
    const pdfBytes = await buildPremiumOrderCancellationPdf({
      ctx: baseCtx(),
      storno_number: "STO-2026-000001",
      storno_kind: "rejection",
      reason: "Test důvod storna",
      issued_at: "2026-10-12T12:00:00.000Z",
      issuer_display_name: "Admin",
      invoice_number: null,
      credit_note_number: null,
      order_was_approved: false,
      ad_was_published: false,
      ad_turned_off_at: null,
      payment_status_label: "Neuhrazeno",
    });
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
    expect(pdfBytes.byteLength).toBeGreaterThan(8_000);
  });

  it("does not leave a footer-only second page for standard published storno", async () => {
    const pdfBytes = await buildPremiumOrderCancellationPdf({
      ctx: baseCtx(),
      storno_number: "STO-2026-000123",
      storno_kind: "cancellation",
      reason: "Klient požádal o zrušení objednávky. Reklamní službu již nechce.",
      issued_at: "2026-10-12T12:27:00.000Z",
      issuer_display_name: "Hlavní administrátor",
      invoice_number: "INV-2026-1FE6BE48",
      credit_note_number: "DOB-2026-000001",
      order_was_approved: true,
      ad_was_published: true,
      ad_turned_off_at: "2026-10-12T11:00:00.000Z",
      payment_status_label: "Neuhrazeno",
      storno_amount_cents: 599000,
      variable_symbol: "20261648",
    });
    expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBe(1);
  });

  it("keeps published storno with normal reason on one A4 page", async () => {
    const pdfBytes = await buildPremiumOrderCancellationPdf({
      ctx: baseCtx(),
      storno_number: "STO-2026-000123",
      storno_kind: "cancellation",
      reason: "Klient požádal o zrušení objednávky. Reklamní službu již nechce.",
      issued_at: "2026-10-12T12:27:00.000Z",
      issuer_display_name: "Hlavní administrátor",
      invoice_number: "INV-2026-1FE6BE48",
      credit_note_number: "DOB-2026-000001",
      order_was_approved: true,
      ad_was_published: true,
      ad_turned_off_at: "2026-10-12T11:00:00.000Z",
      payment_status_label: "Neuhrazeno",
      storno_amount_cents: 599000,
      variable_symbol: "20261648",
    });
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("allows second page only for very long storno reason", async () => {
    const longReason =
      "Důvod storna: ".repeat(40) +
      "Podrobné vysvětlení rozhodnutí zákazníka a provozovatele včetně české diakritiky žluťoučký kůň.";
    const pdfBytes = await buildPremiumOrderCancellationPdf({
      ctx: baseCtx(),
      storno_number: "STO-2026-000124",
      storno_kind: "cancellation",
      reason: longReason,
      issued_at: "2026-10-12T12:27:00.000Z",
      issuer_display_name: "Hlavní administrátor",
      invoice_number: "INV-2026-1FE6BE48",
      credit_note_number: null,
      order_was_approved: true,
      ad_was_published: true,
      ad_turned_off_at: "2026-10-12T11:00:00.000Z",
      payment_status_label: "Neuhrazeno",
      storno_amount_cents: 599000,
    });
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getPageCount()).toBeLessThanOrEqual(2);
  });
});

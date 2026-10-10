import { describe, expect, it, vi } from "vitest";
import { executePremiumAdTurnOff, premiumAdTurnOffBlocksResume } from "../src/premium-ad-turnoff";
import { buildPremiumOrderCancellationPdf } from "../src/premium-order-cancellation-pdf";
import { buildPremiumCreditNotePdf } from "../src/premium-credit-note-pdf";
import type { PremiumOrderPdfContext } from "../src/premium-order-pdf-fields";

const sampleCtx: PremiumOrderPdfContext = {
  order_id: "ord_storno_1",
  evidence_reference: "AD-2026-TEST01",
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
};

describe("premium ad turn-off", () => {
  it("blocks resume when ad turned off", () => {
    expect(premiumAdTurnOffBlocksResume({ ad_turned_off_at: "2026-10-03T00:00:00.000Z" })).toBe(true);
    expect(premiumAdTurnOffBlocksResume({ ad_turned_off_at: null })).toBe(false);
  });

  it("requires reason for turn-off", async () => {
    const env = { DB: {} as D1Database };
    const r = await executePremiumAdTurnOff(env, { orderId: "x", actorUserId: "u", reason: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("reason_required");
  });
});

describe("storno PDF generators", () => {
  it("builds cancellation PDF with STO number", async () => {
    const pdf = await buildPremiumOrderCancellationPdf({
      ctx: sampleCtx,
      storno_number: "STO-2026-000001",
      storno_kind: "rejection",
      reason: "Test důvod",
      issued_at: "2026-10-12T12:00:00.000Z",
      issuer_display_name: "Admin",
      invoice_number: null,
      credit_note_number: null,
      order_was_approved: false,
      ad_was_published: false,
      ad_turned_off_at: null,
      payment_status_label: "Neuhrazeno",
    });
    expect(pdf.byteLength).toBeGreaterThan(1500);
  });

  it("builds credit note PDF", async () => {
    const pdf = await buildPremiumCreditNotePdf({
      ctx: sampleCtx,
      credit_note_number: "DOB-2026-000001",
      invoice_number: "INV-2026-TEST",
      invoice_issued_at: "2026-10-10T10:00:00.000Z",
      issued_at: "2026-10-12T12:00:00.000Z",
      correction_effective_at: "2026-10-12T12:00:00.000Z",
      original_total_cents: 599000,
      correction_cents: -599000,
      new_total_cents: 0,
      currency: "CZK",
      reason: "Storno služby",
      payment_status_label: "Neuhrazeno",
      amount_paid_cents: 0,
    });
    expect(pdf.byteLength).toBeGreaterThan(1500);
  });
});

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildPremiumOrderCancellationPdf } from "../src/premium-order-cancellation-pdf";
import type { PremiumOrderPdfContext } from "../src/premium-order-pdf-fields";

const longRef =
  "AD-2026-VERY-LONG-CUSTOMER-ORDER-CODE-9F3A2B1C0D9E8F7A6B5C4D3E2F1A0B9C8D7E6F5";

const baseCtx: PremiumOrderPdfContext = {
  order_id: "ord_long_ref",
  evidence_reference: longRef,
  product_label: "Vybrané služby a odkazy",
  company_name: "Velmi dlouhý název obchodní společnosti s ručením omezeným pro reklamní služby",
  ico: "27076831",
  dic: "CZ27076831",
  contact_name: "Kontakt",
  contact_email: "info@example.test",
  contact_phone: null,
  ordering_person_name: null,
  authorization_confirmed: true,
  billing_street: "Kněžická 96",
  billing_city: "Praha 12",
  billing_zip: "19012",
  billing_country: "CZ",
  customer_registry: "zapsána v obchodním rejstříku vedeném Městským soudem v Praze",
  note: null,
  category_title_cs: "Software a bezpečnost",
  category_slug: "aff-software-bezpecnost",
  position: 1,
  position_label: "P1",
  price_cents: 599000,
  currency: "CZK",
  duration_months: 6,
  target_url: "https://example.test/very/long/target/url/path/for/wrapping/in/pdf",
  ad_web_placement_url: "https://infouzel.cz/affiliate/software",
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
  order_created_at: "2026-10-10T10:00:00.000Z",
  order_submitted_at: "2026-10-10T10:00:00.000Z",
  approved_at: "2026-10-10T11:00:00.000Z",
  published_at: "2026-10-10T12:00:00.000Z",
  campaign_start_at: "2026-10-10T12:00:00.000Z",
  campaign_end_at: "2027-04-10T12:00:00.000Z",
  workflow_status_label: "Schváleno",
  approver_user_id: null,
  approver_display_name: "Admin",
  invoice_number: "INV-2026-LONG",
  invoice_id: "inv_long",
};

describe("premium storno PDF long identifiers", () => {
  it("renders long public order reference without exceeding two pages", async () => {
    const pdfBytes = await buildPremiumOrderCancellationPdf({
      ctx: baseCtx,
      storno_number: "STO-2026-000999",
      storno_kind: "cancellation",
      reason: "Storno test — česká diakritika: žluťoučký kůň úpěl ďábelské ódy.",
      issued_at: "2026-10-12T12:27:00.000Z",
      issuer_display_name: "Hlavní administrátor",
      invoice_number: "INV-2026-LONG",
      credit_note_number: null,
      order_was_approved: true,
      ad_was_published: true,
      ad_turned_off_at: "2026-10-12T11:00:00.000Z",
      payment_status_label: "Neuhrazeno",
      storno_amount_cents: 599000,
      variable_symbol: "20261648",
    });
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getPageCount()).toBeLessThanOrEqual(2);
    expect(pdfBytes.byteLength).toBeGreaterThan(8_000);
    expect(longRef.length).toBeGreaterThan(40);
  });
});

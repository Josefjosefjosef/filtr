import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildPremiumOrderCancellationPdf } from "../src/premium-order-cancellation-pdf";
import { buildPremiumCreditNotePdf } from "../src/premium-credit-note-pdf";
import type { PremiumOrderPdfContext } from "../src/premium-order-pdf-fields";
import { renderPdfPagePng } from "../src/premium-invoice-pdf-page-png";

const referenceCtx: PremiumOrderPdfContext = {
  order_id: "ord_visual_ref",
  evidence_reference: "AD-2026-C2F61389",
  product_label: "Vybrané služby a odkazy",
  company_name: "RESISTANCE s.r.o.",
  ico: "27076831",
  dic: "CZ27076831",
  contact_name: "Kontakt",
  contact_email: "info@resistance.cz",
  contact_phone: null,
  ordering_person_name: null,
  authorization_confirmed: true,
  billing_street: "Kněžická 96",
  billing_city: "Praha 12",
  billing_zip: "19012",
  billing_country: "CZ",
  customer_registry: "zapsána v obchodním rejstříku",
  note: null,
  category_title_cs: "Software a bezpečnost",
  category_slug: "aff-software-bezpecnost",
  position: 1,
  position_label: "P1",
  price_cents: 599000,
  currency: "CZK",
  duration_months: 6,
  target_url: "https://example.test/target",
  ad_web_placement_url: "https://infouzel.cz/affiliate/software",
  b2b_only: true,
  creative_mode: "banner",
  creative_mode_label_cs: "Banner (celá plocha)",
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
  invoice_number: "INV-2026-1FE6BE48",
  invoice_id: "inv_visual",
};

describe("premium storno + credit note visual proof", () => {
  it("renders reference-like storno and dobropis PDF with PNG export", async () => {
    const stornoPdf = await buildPremiumOrderCancellationPdf({
      ctx: referenceCtx,
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
    const creditPdf = await buildPremiumCreditNotePdf({
      ctx: referenceCtx,
      credit_note_number: "DOB-2026-000001",
      invoice_number: "INV-2026-1FE6BE48",
      invoice_issued_at: "2026-10-10T10:00:00.000Z",
      issued_at: "2026-10-12T12:00:00.000Z",
      correction_effective_at: "2026-10-12T12:00:00.000Z",
      original_total_cents: 599000,
      correction_cents: -599000,
      new_total_cents: 0,
      currency: "CZK",
      reason: "Zrušení reklamní objednávky na žádost zákazníka (ilustrační údaj).",
      payment_status_label: "Neuhrazeno",
      amount_paid_cents: 0,
    });

    const stornoDoc = await PDFDocument.load(stornoPdf);
    const creditDoc = await PDFDocument.load(creditPdf);
    expect(stornoDoc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(stornoDoc.getPageCount()).toBeLessThanOrEqual(2);
    expect(creditDoc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(creditDoc.getPageCount()).toBeLessThanOrEqual(2);

    expect(stornoPdf.byteLength).toBeGreaterThan(10_000);
    expect(creditPdf.byteLength).toBeGreaterThan(10_000);

    const outDir = process.env.IU_STORNO_CREDIT_VISUAL_OUT;
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "storno-order-reference.pdf"), Buffer.from(stornoPdf));
      fs.writeFileSync(path.join(outDir, "credit-note-reference.pdf"), Buffer.from(creditPdf));
      for (let p = 1; p <= stornoDoc.getPageCount(); p++) {
        const png = await renderPdfPagePng(stornoPdf, p, 2);
        expect(png).toBeTruthy();
        if (png) fs.writeFileSync(path.join(outDir, `storno-order-page-${p}.png`), png);
      }
      for (let p = 1; p <= creditDoc.getPageCount(); p++) {
        const png = await renderPdfPagePng(creditPdf, p, 2);
        expect(png).toBeTruthy();
        if (png) fs.writeFileSync(path.join(outDir, `credit-note-page-${p}.png`), png);
      }
    }
  });
});

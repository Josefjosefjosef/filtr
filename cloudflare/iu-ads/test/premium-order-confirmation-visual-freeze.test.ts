import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  assertOrderConfirmationContentAboveFooter,
  buildOrderConfirmationPlainLines,
  buildPremiumOrderConfirmationPdfWithLayout,
  PREMIUM_ORDER_CONFIRMATION_CONTENT_MIN_Y,
} from "../src/premium-order-confirmation-pdf";
import { buildOrderConfirmationSampleCreativePng } from "./order-confirmation-creative-fixture";
import {
  orderConfirmationPage1FooterBandContentOverlap,
  orderConfirmationPage2HasEmbeddedCreative,
} from "./order-confirmation-png-guards";
import type { PremiumOrderPdfContext } from "../src/premium-order-pdf-fields";
import { renderPdfPagePng } from "../src/premium-invoice-pdf-page-png";
import { PREMIUM_INVOICE_BRAND_HEX } from "../src/premium-invoice-brand";

const referenceCtx: PremiumOrderPdfContext = {
  order_id: "ord_freeze_ref",
  evidence_reference: "AD-2026-99928AF8",
  product_label: "Vybrané služby a odkazy",
  company_name: "RESISTANCE s.r.o.",
  ico: "27076831",
  dic: "CZ27076831",
  contact_name: "Josef Zmrhal",
  contact_email: "josef@example.test",
  contact_phone: "+420777000111",
  ordering_person_name: "Josef Zmrhal",
  authorization_confirmed: true,
  billing_street: "Průběžná 402",
  billing_city: "Nupaky",
  billing_zip: "25101",
  billing_country: "Česká republika",
  customer_registry: {
    registry_kind: "commercial_register",
    registry_name_cs: "obchodní rejstřík",
    court_name_cs: "Městským soudem v Praze",
    section: "C",
    insert: "94523",
    file_mark: null,
    display_line_cs: "Zapsána v OR u Městského soudu v Praze, oddíl C, vložka 94523.",
    verified_source: "ares",
    verified_at: "2026-10-08T12:00:00.000Z",
    user_confirmed: false,
  },
  note: null,
  category_title_cs: "Cestovní kanceláře",
  category_slug: "aff-cestovni-kancelare",
  position: 8,
  position_label: "P8",
  price_cents: 389000,
  currency: "CZK",
  duration_months: 6,
  target_url: "https://example.test/campaign",
  ad_web_placement_url: "https://infouzel.cz/?section=aff-cestovni-kancelare",
  b2b_only: true,
  creative_mode: "smaller_image",
  creative_mode_label_cs: "Menší obrázek",
  creative_id: "crv_freeze_sample",
  creative_format: "smaller_image",
  creative_original_filename: "creative.png",
  creative_content_hash: "a".repeat(64),
  creative_uploaded_at: "2026-10-08T21:11:00.000Z",
  creative_approved_at: "2026-10-08T21:12:00.000Z",
  terms_version: "premium-selected-v1",
  terms_effective_at: "2026-01-01T00:00:00.000Z",
  order_created_at: "2026-10-08T21:11:00.000Z",
  order_submitted_at: "2026-10-08T21:11:00.000Z",
  approved_at: "2026-10-08T21:12:00.000Z",
  published_at: "2026-10-08T21:12:00.000Z",
  campaign_start_at: "2026-10-08T21:12:00.000Z",
  campaign_end_at: "2027-04-08T21:12:00.000Z",
  workflow_status_label: "Schváleno a zveřejněno",
  approver_user_id: "admin_1",
  approver_display_name: "Hlavní administrátor",
  invoice_number: "INV-2026-3B895940",
  invoice_id: "inv_freeze",
};

describe("premium order confirmation visual freeze", () => {
  it("renders two pages with required headings and section URL", async () => {
    const sampleCreative = buildOrderConfirmationSampleCreativePng();
    const { pdfBytes, pageCount, page1Blocks, blocks } = await buildPremiumOrderConfirmationPdfWithLayout(
      referenceCtx,
      sampleCreative,
      "image/png"
    );
    expect(pageCount).toBe(2);
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(pageCount);

    const page1Png = await renderPdfPagePng(Uint8Array.from(pdfBytes), 1, 2);
    const page2Png = await renderPdfPagePng(Uint8Array.from(pdfBytes), 2, 2);
    expect(page1Png).not.toBeNull();
    expect(page2Png).not.toBeNull();
    expect(page1Png!.byteLength).toBeGreaterThan(8000);
    expect(page2Png!.byteLength).toBeGreaterThan(8000);

    expect(assertOrderConfirmationContentAboveFooter(page1Blocks, PREMIUM_ORDER_CONFIRMATION_CONTENT_MIN_Y, 0)).toEqual([]);
    expect(await orderConfirmationPage1FooterBandContentOverlap(page1Png!)).toBe(false);
    expect(assertOrderConfirmationContentAboveFooter(blocks, PREMIUM_ORDER_CONFIRMATION_CONTENT_MIN_Y, 1)).toEqual([]);
    expect(await orderConfirmationPage1FooterBandContentOverlap(page2Png!)).toBe(false);
    const creativeProbe = await orderConfirmationPage2HasEmbeddedCreative(page2Png!);
    expect(creativeProbe.ok).toBe(true);
    expect(creativeProbe.blueRatio).toBeGreaterThan(0.04);

    const outDir = process.env.IU_ORDER_CONFIRMATION_VISUAL_OUT;
    if (outDir) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "order-confirmation-freeze.pdf"), Buffer.from(pdfBytes));
      fs.writeFileSync(path.join(outDir, "order-confirmation-freeze-page-1.png"), page1Png!);
      fs.writeFileSync(path.join(outDir, "order-confirmation-freeze-page-2.png"), page2Png!);
    }

    const plain = buildOrderConfirmationPlainLines(referenceCtx).join("\n");
    expect(plain).toContain("Potvrzení objednávky");
    expect(plain).toContain("aff-cestovni-kancelare");
    expect(plain).toContain("INV-2026-3B895940");
    expect(plain).not.toContain("customer_order_code");
    expect(PREMIUM_INVOICE_BRAND_HEX).toBe("#003cff");
  });
});

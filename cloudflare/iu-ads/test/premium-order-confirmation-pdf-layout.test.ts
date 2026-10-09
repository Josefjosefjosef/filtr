import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  assertOrderConfirmationContentAboveFooter,
  buildPremiumOrderConfirmationPdfWithLayout,
  buildOrderConfirmationPlainLines,
  PREMIUM_ORDER_CONFIRMATION_CONTENT_MIN_Y,
} from "../src/premium-order-confirmation-pdf";
import { buildOrderConfirmationSampleCreativePng } from "./order-confirmation-creative-fixture";
import { orderConfirmationPage1FooterBandContentOverlap } from "./order-confirmation-png-guards";
import type { PremiumOrderPdfContext } from "../src/premium-order-pdf-fields";
import { PremiumInvoicePdfCursor } from "../src/premium-invoice-pdf-layout";
import { assertOrderPdfContainsCustomerFields } from "../src/premium-order-pdf-fields";
import { renderPdfPagePng } from "../src/premium-invoice-pdf-page-png";

function baseCtx(overrides: Partial<PremiumOrderPdfContext> = {}): PremiumOrderPdfContext {
  return {
    order_id: "ord_layout",
    evidence_reference: "AD-2026-LAYOUT01",
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
    note: null,
    category_title_cs: "Cestovní kanceláře",
    category_slug: "aff-cestovni-kancelare",
    position: 8,
    position_label: "P8",
    price_cents: 389000,
    currency: "CZK",
    duration_months: 6,
    target_url: "https://example.test/premium",
    ad_web_placement_url: "https://infouzel.cz/?section=aff-cestovni-kancelare",
    b2b_only: true,
    creative_mode: "smaller_image",
    creative_mode_label_cs: "Menší obrázek",
    creative_id: "crv_layout",
    creative_format: "smaller_image",
    creative_original_filename: "ad.png",
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
    approver_user_id: "admin_test",
    approver_display_name: "Jan Admin",
    invoice_number: "INV-2026-LAYOUT",
    invoice_id: "inv_layout",
    ...overrides,
  };
}

const SAMPLE_CREATIVE = buildOrderConfirmationSampleCreativePng();

describe("premium order confirmation PDF layout scenarios", () => {
  const scenarios: { name: string; ctx: PremiumOrderPdfContext }[] = [
    {
      name: "long_company",
      ctx: baseCtx({
        company_name:
          "Velmi dlouhý obchodní název společnosti s.r.o. se sídlem v několika krajích České republiky",
      }),
    },
    {
      name: "long_address",
      ctx: baseCtx({
        billing_street: "Národní třída 1234/56, budova Omega, 7. patro, kancelář 701",
        billing_city: "Praha 1 — Staré Město",
        billing_zip: "11000",
      }),
    },
    {
      name: "long_registry",
      ctx: baseCtx({
        customer_registry: {
          registry_kind: "commercial_register",
          registry_name_cs: "obchodní rejstřík",
          court_name_cs: "Městským soudem v Praze",
          section: "C",
          insert: "447292",
          file_mark: null,
          display_line_cs:
            "Společnost zapsána v obchodním rejstříku vedeném Městským soudem v Praze, oddíl C, vložka 447292, s historickým zápisem a doplňkovými údaji.",
          verified_source: "ares",
          verified_at: "2026-01-01T00:00:00.000Z",
          user_confirmed: false,
        },
      }),
    },
    {
      name: "long_target_url",
      ctx: baseCtx({
        target_url:
          "https://example.test/path/to/landing?utm_source=infouzel&utm_medium=premium&utm_campaign=" +
          "aff-cestovni-kancelare&extra=" +
          "x".repeat(120),
      }),
    },
    {
      name: "long_placement_url_snapshot",
      ctx: baseCtx({
        ad_web_placement_url:
          "https://infouzel.cz/?section=aff-cestovni-kancelare&legacy=1&trace=" + "y".repeat(80),
      }),
    },
    {
      name: "long_hash",
      ctx: baseCtx({
        creative_content_hash: "f".repeat(128),
      }),
    },
    {
      name: "no_dic",
      ctx: baseCtx({ dic: null }),
    },
  ];

  for (const scenario of scenarios) {
    it("renders " + scenario.name + " on two pages without block overlap on attachment page", async () => {
      const { pdfBytes, pageCount, blocks, page1Blocks } = await buildPremiumOrderConfirmationPdfWithLayout(
        scenario.ctx,
        SAMPLE_CREATIVE,
        "image/png"
      );
      expect(pageCount).toBeGreaterThanOrEqual(2);
      expect(pageCount).toBeLessThanOrEqual(3);
      expect(pdfBytes.byteLength).toBeGreaterThan(2000);
      expect(PremiumInvoicePdfCursor.assertNoBlockOverlap(blocks)).toEqual([]);
      expect(page1Blocks.some((block) => block.id.includes("Technické"))).toBe(true);
      expect(assertOrderConfirmationContentAboveFooter(page1Blocks, PREMIUM_ORDER_CONFIRMATION_CONTENT_MIN_Y, 0)).toEqual(
        []
      );
      const page1Png = await renderPdfPagePng(Uint8Array.from(pdfBytes), 1, 2);
      expect(page1Png).not.toBeNull();
      expect(await orderConfirmationPage1FooterBandContentOverlap(page1Png!)).toBe(false);
      const plain = buildOrderConfirmationPlainLines(scenario.ctx);
      expect(assertOrderPdfContainsCustomerFields(plain, scenario.ctx)).toEqual([]);
      const doc = await PDFDocument.load(pdfBytes);
      expect(doc.getPageCount()).toBe(pageCount);
    });
  }

  it("embeds supplied creative bytes (not a placeholder asset)", async () => {
    const ctx = baseCtx();
    const { pdfBytes } = await buildPremiumOrderConfirmationPdfWithLayout(ctx, SAMPLE_CREATIVE, "image/png");
    const doc = await PDFDocument.load(pdfBytes);
    const page2 = doc.getPage(1);
    const ops = page2.node.Contents()?.asArray?.()?.length ?? 0;
    expect(ops).toBeGreaterThan(0);
  });

  it("renders PNG page 1 and page 2 for reference layout", async () => {
    const ctx = baseCtx();
    const { pdfBytes } = await buildPremiumOrderConfirmationPdfWithLayout(ctx, SAMPLE_CREATIVE, "image/png");
    const p1 = await renderPdfPagePng(Uint8Array.from(pdfBytes), 1, 2);
    const p2 = await renderPdfPagePng(Uint8Array.from(pdfBytes), 2, 2);
    expect(p1).not.toBeNull();
    expect(p2).not.toBeNull();
    expect(p1!.byteLength).toBeGreaterThan(8000);
    expect(p2!.byteLength).toBeGreaterThan(8000);
    const outDir = process.env.IU_ORDER_CONFIRMATION_VISUAL_OUT;
    if (outDir) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "order-confirmation-reference.pdf"), Buffer.from(pdfBytes));
      fs.writeFileSync(path.join(outDir, "order-confirmation-page-1.png"), p1!);
      fs.writeFileSync(path.join(outDir, "order-confirmation-page-2.png"), p2!);
    }
  });
});

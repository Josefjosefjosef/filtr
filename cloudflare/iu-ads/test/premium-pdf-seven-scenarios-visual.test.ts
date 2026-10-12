import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildPremiumCreditNotePdf } from "../src/premium-credit-note-pdf";
import { buildPremiumInvoicePdfWithLayout } from "../src/premium-invoice-pdf";
import { decodeSpaydFromInvoicePdfBytes } from "../src/premium-invoice-pdf-qr-extract";
import { renderPdfPagePng } from "../src/premium-invoice-pdf-page-png";
import { buildPremiumOrderCancellationPdf } from "../src/premium-order-cancellation-pdf";
import { buildPremiumOrderConfirmationPdfWithLayout } from "../src/premium-order-confirmation-pdf";
import { PremiumInvoicePdfCursor } from "../src/premium-invoice-pdf-layout";
import type { PremiumOrderPdfContext } from "../src/premium-order-pdf-fields";
import { buildOrderConfirmationSampleCreativePng } from "./order-confirmation-creative-fixture";

const SAMPLE_CREATIVE = buildOrderConfirmationSampleCreativePng();

const compactStornoCtx: PremiumOrderPdfContext = {
  order_id: "ord_storno_compact",
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
  price_cents: 569000,
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

async function writePdfAndPngs(
  outDir: string,
  baseName: string,
  pdfBytes: Uint8Array,
  expectPages: { min: number; max: number }
): Promise<{ pageCount: number; pngOk: number; pngFail: number }> {
  fs.mkdirSync(outDir, { recursive: true });
  const snapshot = new Uint8Array(Buffer.from(pdfBytes));
  fs.writeFileSync(path.join(outDir, baseName + ".pdf"), Buffer.from(snapshot));
  let pngOk = 0;
  let pngFail = 0;
  const doc = await PDFDocument.load(snapshot);
  const pageCount = doc.getPageCount();
  expect(pageCount).toBeGreaterThanOrEqual(expectPages.min);
  expect(pageCount).toBeLessThanOrEqual(expectPages.max);
  const pdfPath = path.join(outDir, baseName + ".pdf");
  for (let p = 1; p <= pageCount; p++) {
    const pngPath = path.join(outDir, `${baseName}-page-${p}.png`);
    const fileBytes = new Uint8Array(fs.readFileSync(pdfPath));
    let png = await renderPdfPagePng(fileBytes, p, 2);
    if (!png || png.byteLength < 500) {
      try {
        const prefix = path.join(outDir, `${baseName}-page-${p}`);
        execFileSync("pdftoppm", ["-png", "-singlefile", "-f", String(p), "-l", String(p), "-r", "150", pdfPath, prefix], {
          stdio: "pipe",
        });
        if (fs.existsSync(pngPath)) {
          png = fs.readFileSync(pngPath);
        } else if (fs.existsSync(prefix + ".png")) {
          fs.renameSync(prefix + ".png", pngPath);
          png = fs.readFileSync(pngPath);
        }
      } catch {
        png = null;
      }
    }
    if (!png || png.byteLength < 500) {
      pngFail += 1;
    } else {
      pngOk += 1;
      if (!fs.existsSync(pngPath)) fs.writeFileSync(pngPath, png);
    }
  }
  return { pageCount, pngOk, pngFail };
}

const referenceCtx: PremiumOrderPdfContext = {
  order_id: "ord_visual_suite",
  evidence_reference: "AD-2026-VISUAL01",
  product_label: "Vybrané služby a odkazy",
  company_name: "Velmi dlouhý název obchodní společnosti s ručením omezeným pro reklamní služby",
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
  customer_registry: "zapsána v obchodním rejstříku vedeném Městským soudem v Praze",
  note: null,
  category_title_cs: "Software a bezpečnost",
  category_slug: "aff-software-bezpecnost",
  position: 1,
  position_label: "P1",
  price_cents: 569000,
  currency: "CZK",
  duration_months: 6,
  target_url: "https://example.test/very/long/target/url/path/for/wrapping/in/pdf",
  ad_web_placement_url: "https://infouzel.cz/affiliate/software",
  b2b_only: true,
  creative_mode: "banner",
  creative_mode_label_cs: "Banner (celá plocha)",
  creative_id: "crv_visual",
  creative_format: "banner",
  creative_original_filename: "ad.png",
  creative_content_hash: "a".repeat(64),
  creative_uploaded_at: "2026-10-10T10:00:00.000Z",
  creative_approved_at: "2026-10-10T11:00:00.000Z",
  terms_version: "premium-selected-v1-long-identifier-2026",
  terms_effective_at: "2026-01-01T00:00:00.000Z",
  order_created_at: "2026-10-10T10:00:00.000Z",
  order_submitted_at: "2026-10-10T10:00:00.000Z",
  approved_at: "2026-10-10T11:00:00.000Z",
  published_at: "2026-10-10T12:00:00.000Z",
  campaign_start_at: "2026-10-10T12:00:00.000Z",
  campaign_end_at: "2027-04-10T12:00:00.000Z",
  workflow_status_label: "Schváleno",
  approver_user_id: null,
  approver_display_name: "Admin",
  invoice_number: "INV-2026-VISUAL",
  invoice_id: "inv_visual",
};

describe("premium PDF seven-scenario visual suite", () => {
  it("renders all seven document scenarios with PNG pages when IU_PDF_VISUAL_SUITE_OUT is set", async () => {
    const outDir = process.env.IU_PDF_VISUAL_SUITE_OUT;
    const report: Record<string, unknown> = { scenarios: [] as unknown[] };

    const confirmation = await buildPremiumOrderConfirmationPdfWithLayout(
      referenceCtx,
      SAMPLE_CREATIVE,
      "image/png"
    );
    expect(confirmation.pageCount).toBeGreaterThanOrEqual(2);
    expect(PremiumInvoicePdfCursor.assertNoBlockOverlap(confirmation.blocks)).toEqual([]);
    const confirmationPdf = confirmation.pdfBytes.slice();

    const invoiceInput = {
      invoice_number: "INV-2026-VISUAL",
      variable_symbol: "2026visual",
      issued_at: "2026-10-10T10:00:00.000Z",
      due_at: "2026-10-13T10:00:00.000Z",
      taxable_date: "2026-10-10T10:00:00.000Z",
      buyer_company: referenceCtx.company_name,
      buyer_ico: referenceCtx.ico,
      buyer_dic: referenceCtx.dic,
      buyer_address_lines: [referenceCtx.billing_street, referenceCtx.billing_zip + " " + referenceCtx.billing_city],
      buyer_registry: referenceCtx.customer_registry,
      line_description: "Reklamní umístění",
      service_period_start: referenceCtx.campaign_start_at!,
      service_period_end: referenceCtx.campaign_end_at!,
      total_cents: referenceCtx.price_cents,
      currency: "CZK",
      order_reference: referenceCtx.evidence_reference,
      category_title_cs: referenceCtx.category_title_cs,
      position_label: referenceCtx.position_label,
      duration_months: 6,
    };
    const invoice = await buildPremiumInvoicePdfWithLayout(invoiceInput);
    expect(invoice.pageCount).toBe(1);
    expect(PremiumInvoicePdfCursor.assertNoBlockOverlap(invoice.layoutBlocks)).toEqual([]);
    const invoicePdf = invoice.pdfBytes.slice();
    const spayd = await decodeSpaydFromInvoicePdfBytes(invoice.pdfBytes.slice());
    expect(spayd).toContain("SPD*1.0");

    const stornoBefore = await buildPremiumOrderCancellationPdf({
      ctx: compactStornoCtx,
      storno_number: "STO-2026-BEFORE",
      storno_kind: "rejection",
      reason: "Storno před schválením a zveřejněním reklamy.",
      issued_at: "2026-10-12T12:00:00.000Z",
      issuer_display_name: "Admin",
      invoice_number: null,
      credit_note_number: null,
      order_was_approved: false,
      ad_was_published: false,
      ad_turned_off_at: null,
      payment_status_label: "Neuhrazeno",
    });
    const stornoBeforeDoc = await PDFDocument.load(stornoBefore);
    expect(stornoBeforeDoc.getPageCount()).toBe(1);
    const stornoBeforePdf = stornoBefore.slice();

    const stornoAfter = await buildPremiumOrderCancellationPdf({
      ctx: compactStornoCtx,
      storno_number: "STO-2026-AFTER",
      storno_kind: "cancellation",
      reason: "Klient požádal o zrušení objednávky. Reklamní službu již nechce.",
      issued_at: "2026-10-12T12:27:00.000Z",
      issuer_display_name: "Hlavní administrátor",
      invoice_number: compactStornoCtx.invoice_number,
      credit_note_number: "DOB-2026-VISUAL",
      order_was_approved: true,
      ad_was_published: true,
      ad_turned_off_at: "2026-10-12T11:00:00.000Z",
      payment_status_label: "Neuhrazeno",
      storno_amount_cents: 569000,
      variable_symbol: "2026visual",
    });
    expect((await PDFDocument.load(stornoAfter)).getPageCount()).toBe(1);
    const stornoAfterPdf = stornoAfter.slice();

    const longReason =
      "Důvod storna: ".repeat(35) + "Podrobné odůvodnění včetně diakritiky žluťoučký kůň úpěl ďábelské ódy.";
    const stornoLong = await buildPremiumOrderCancellationPdf({
      ctx: compactStornoCtx,
      storno_number: "STO-2026-LONG",
      storno_kind: "cancellation",
      reason: longReason,
      issued_at: "2026-10-12T12:27:00.000Z",
      issuer_display_name: "Admin",
      invoice_number: compactStornoCtx.invoice_number,
      credit_note_number: null,
      order_was_approved: true,
      ad_was_published: true,
      ad_turned_off_at: "2026-10-12T11:00:00.000Z",
      payment_status_label: "Neuhrazeno",
      storno_amount_cents: 569000,
    });
    const stornoLongPages = (await PDFDocument.load(stornoLong)).getPageCount();
    expect(stornoLongPages).toBeGreaterThanOrEqual(1);
    expect(stornoLongPages).toBeLessThanOrEqual(2);
    const stornoLongPdf = stornoLong.slice();

    const creditPdf = await buildPremiumCreditNotePdf({
      ctx: referenceCtx,
      credit_note_number: "DOB-2026-VISUAL",
      invoice_number: referenceCtx.invoice_number!,
      invoice_issued_at: "2026-10-10T10:00:00.000Z",
      issued_at: "2026-10-12T12:00:00.000Z",
      correction_effective_at: "2026-10-12T12:00:00.000Z",
      original_total_cents: 569000,
      correction_cents: -569000,
      new_total_cents: 0,
      currency: "CZK",
      reason: "Plná oprava fakturované částky — storno reklamní služby.",
      payment_status_label: "Neuhrazeno",
      amount_paid_cents: 0,
      ad_was_published: true,
      ad_turned_off_at: "2026-10-12T11:00:00.000Z",
    });
    const creditPdfSnapshot = creditPdf.slice();
    const creditRaw = new TextDecoder("latin1").decode(creditPdfSnapshot);
    expect(creditRaw).not.toContain("\u2212");

    const longIdConfirmation = await buildPremiumOrderConfirmationPdfWithLayout(
      {
        ...referenceCtx,
        evidence_reference:
          "AD-2026-VERY-LONG-CUSTOMER-ORDER-CODE-9F3A2B1C0D9E8F7A6B5C4D3E2F1A0B9C8D7E6F5",
      },
      SAMPLE_CREATIVE,
      "image/png"
    );
    expect(PremiumInvoicePdfCursor.assertNoBlockOverlap(longIdConfirmation.blocks)).toEqual([]);
    const longIdPdf = longIdConfirmation.pdfBytes.slice();

    if (outDir) {
      expect(confirmationPdf[0]).toBe(0x25);
      const exports: { id: number; name: string; file: string; pdf: Uint8Array; pages: { min: number; max: number } }[] = [
        { id: 1, name: "order_confirmation", file: "01-order-confirmation", pdf: confirmationPdf, pages: { min: 2, max: 3 } },
        { id: 2, name: "invoice_qr", file: "02-invoice-qr", pdf: invoicePdf, pages: { min: 1, max: 1 } },
        { id: 3, name: "storno_before", file: "03-storno-before-publish", pdf: stornoBeforePdf, pages: { min: 1, max: 1 } },
        { id: 4, name: "storno_after", file: "04-storno-after-publish", pdf: stornoAfterPdf, pages: { min: 1, max: 1 } },
        { id: 5, name: "storno_long_reason", file: "05-storno-long-reason", pdf: stornoLongPdf, pages: { min: 1, max: 2 } },
        { id: 6, name: "credit_note_full", file: "06-credit-note-full", pdf: creditPdfSnapshot, pages: { min: 1, max: 2 } },
        { id: 7, name: "long_identifiers", file: "07-long-identifiers", pdf: longIdPdf, pages: { min: 2, max: 3 } },
      ];
      for (const item of exports) {
        const r = await writePdfAndPngs(outDir, item.file, item.pdf, item.pages);
        const row: Record<string, unknown> = {
          id: item.id,
          name: item.name,
          pages: r.pageCount,
          pngOk: r.pngOk,
          pngFail: r.pngFail,
        };
        if (item.id === 2) row.spayd = !!spayd;
        if (item.id === 6) row.correction_cents = -569000;
        (report.scenarios as unknown[]).push(row);
      }
      const anyPngFail = (report.scenarios as { pngFail?: number }[]).some((s) => (s.pngFail ?? 0) > 0);
      report.generated_at = new Date().toISOString();
      report.outDir = outDir;
      report.png_renderer = anyPngFail ? "partial_or_skipped" : "ok";
      fs.writeFileSync(path.join(outDir, "visual-suite-report.json"), JSON.stringify(report, null, 2));
      if (anyPngFail && process.env.IU_PDF_VISUAL_SUITE_PDF_ONLY !== "1") {
        expect(anyPngFail).toBe(false);
      }
    }
  });
});

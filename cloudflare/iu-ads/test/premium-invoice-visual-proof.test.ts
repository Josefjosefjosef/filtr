import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPremiumInvoicePdfWithLayout } from "../src/premium-invoice-pdf";
import { PremiumInvoicePdfCursor } from "../src/premium-invoice-pdf-layout";
import { decodeSpaydFromInvoicePdfBytes } from "../src/premium-invoice-pdf-qr-extract";
import { renderInvoicePdfFirstPagePng } from "../src/premium-invoice-pdf-page-png";

const referenceLikeInput = {
  invoice_number: "INV-2026-8342EA45",
  variable_symbol: "2026834245",
  issued_at: "2026-10-08T12:00:00.000Z",
  due_at: "2026-10-11T12:00:00.000Z",
  taxable_date: "2026-10-08T12:00:00.000Z",
  buyer_company: "RESISTANCE s.r.o.",
  buyer_ico: "27076831",
  buyer_dic: "CZ27076831",
  buyer_address_lines: ["Průběžná 402", "251 01 Nupaky", "Česká republika"],
  buyer_registry: null,
  line_description: "Reklamní umístění",
  service_period_start: "2026-10-08T12:00:00.000Z",
  service_period_end: "2027-04-08T12:00:00.000Z",
  total_cents: 449000,
  currency: "CZK",
  order_reference: "AD-2026-F0B0A7F0",
  category_title_cs: "Cestovní kanceláře",
  position_label: "P6",
  duration_months: 6,
};

describe("premium invoice visual proof", () => {
  it("renders reference-like invoice PDF and optional PNG export", async () => {
    const { pdfBytes, layoutBlocks } = await buildPremiumInvoicePdfWithLayout(referenceLikeInput);
    const pdfSnapshot = Uint8Array.from(pdfBytes);
    expect(pdfSnapshot.byteLength).toBeGreaterThan(4000);
    expect(PremiumInvoicePdfCursor.assertNoBlockOverlap(layoutBlocks)).toEqual([]);

    const outDir = process.env.IU_INVOICE_VISUAL_OUT;
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "invoice-reference-like.pdf"), Buffer.from(pdfSnapshot));
    }

    const spayd = await decodeSpaydFromInvoicePdfBytes(Uint8Array.from(pdfSnapshot));
    expect(spayd).toContain("SPD*1.0");
    expect(spayd).toContain("4490.00");

    if (outDir) {
      const pngBuffer = await renderInvoicePdfFirstPagePng(Uint8Array.from(pdfSnapshot), 2);
      if (pngBuffer) {
        fs.writeFileSync(path.join(outDir, "invoice-reference-like.png"), pngBuffer);
      }
    }
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildPremiumInvoicePdfWithLayout } from "../src/premium-invoice-pdf";
import {
  PREMIUM_INVOICE_FOOTER_Y,
  PREMIUM_INVOICE_MARGIN,
  PREMIUM_INVOICE_PAGE,
  PremiumInvoicePdfCursor,
} from "../src/premium-invoice-pdf-layout";
import { decodeSpaydFromInvoicePdfBytes } from "../src/premium-invoice-pdf-qr-extract";
import { renderInvoicePdfFirstPagePng } from "../src/premium-invoice-pdf-page-png";
import { PREMIUM_INVOICE_BRAND_HEX } from "../src/premium-invoice-brand";

/** Deterministic reference invoice — stable input for visual regression. */
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

function readFooterBandSource(): string {
  const src = fs.readFileSync(path.join(__dirname, "../src/premium-invoice-pdf.ts"), "utf8");
  const m = src.match(/function drawInvoiceFooterBand[\s\S]*?\n}/);
  return m ? m[0] : "";
}

/** Detect a long horizontal gray rule in the footer band (thank-you / logo zone). */
export function footerBandHasHorizontalGrayRule(
  imageData: { data: Uint8ClampedArray; width: number; height: number },
  opts?: { bandTopRatio?: number; minGrayRunRatio?: number }
): boolean {
  const bandTopRatio = opts?.bandTopRatio ?? 0.86;
  const minGrayRunRatio = opts?.minGrayRunRatio ?? 0.45;
  const { width, height, data } = imageData;
  const yStart = Math.floor(height * bandTopRatio);
  const yEnd = height - 2;
  for (let y = yStart; y < yEnd; y += 2) {
    let grayRun = 0;
    let maxGrayRun = 0;
    for (let x = Math.floor(width * 0.08); x < Math.floor(width * 0.92); x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const isGrayRule =
        r > 180 && r < 245 && g > 180 && g < 245 && b > 180 && b < 245 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20;
      if (isGrayRule) {
        grayRun++;
        if (grayRun > maxGrayRun) maxGrayRun = grayRun;
      } else {
        grayRun = 0;
      }
    }
    if (maxGrayRun >= width * minGrayRunRatio) return true;
  }
  return false;
}

describe("premium invoice approved visual freeze", () => {
  it("footer band source has no horizontal rule", () => {
    const footerSrc = readFooterBandSource();
    expect(footerSrc.includes("drawLine")).toBe(false);
    expect(footerSrc.includes("Děkujeme za vaši objednávku")).toBe(true);
    expect(footerSrc.includes("drawBrandLogo")).toBe(true);
  });

  it("reference PDF is stable in one run, single page, QR, footer layout", async () => {
    const builtA = await buildPremiumInvoicePdfWithLayout(referenceLikeInput);
    const builtB = await buildPremiumInvoicePdfWithLayout(referenceLikeInput);
    expect(builtA.pageCount).toBe(1);
    expect(builtB.pageCount).toBe(1);
    expect(builtA.pdfBytes.byteLength).toBeGreaterThan(4000);
    expect(Math.abs(builtA.pdfBytes.byteLength - builtB.pdfBytes.byteLength)).toBeLessThan(200);

    const snapshot = Uint8Array.from(builtA.pdfBytes);
    expect((await PDFDocument.load(snapshot)).getPageCount()).toBe(1);

    const spayd = await decodeSpaydFromInvoicePdfBytes(snapshot);
    expect(spayd).toContain("SPD*1.0");
    expect(spayd).toContain("X-VS:2026834245");

    expect(PremiumInvoicePdfCursor.assertNoBlockOverlap(builtA.layoutBlocks)).toEqual([]);

    const footer = builtA.layoutBlocks.find((b) => b.id === "footer");
    expect(footer).toBeTruthy();
    const footY = PREMIUM_INVOICE_FOOTER_Y;
    expect(footer!.rect.yBottom).toBeLessThanOrEqual(footY - 14);
    expect(footer!.rect.x).toBe(PREMIUM_INVOICE_MARGIN);
    expect(footer!.rect.w).toBe(PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN * 2);

    const payment = builtA.layoutBlocks.find((b) => b.id === "payment_section");
    expect(payment).toBeTruthy();
    expect(payment!.rect.yBottom).toBeGreaterThan(footer!.rect.yTop);

    expect(PREMIUM_INVOICE_BRAND_HEX.toLowerCase()).toBe("#003cff");
  });

  it("reference PNG has no footer horizontal rule and includes thank-you zone content", async () => {
    const { pdfBytes } = await buildPremiumInvoicePdfWithLayout(referenceLikeInput);
    const png = await renderInvoicePdfFirstPagePng(Uint8Array.from(pdfBytes), 2);
    if (!png) {
      expect(process.env.CI).not.toBe("true");
      return;
    }
    expect(png.byteLength).toBeGreaterThan(8000);

    const napiCanvas = await import("@napi-rs/canvas");
    const img = await napiCanvas.loadImage(png);
    const canvas = napiCanvas.createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    expect(footerBandHasHorizontalGrayRule(imageData)).toBe(false);

    const outDir = process.env.IU_INVOICE_VISUAL_OUT;
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "invoice-reference-like.pdf"), Buffer.from(pdfBytes));
      fs.writeFileSync(path.join(outDir, "invoice-reference-like.png"), png);
    }
  });
});

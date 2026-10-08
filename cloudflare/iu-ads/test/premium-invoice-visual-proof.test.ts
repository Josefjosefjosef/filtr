import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPremiumInvoicePdfWithLayout } from "../src/premium-invoice-pdf";
import { PremiumInvoicePdfCursor } from "../src/premium-invoice-pdf-layout";
import { decodeSpaydFromInvoicePdfBytes } from "../src/premium-invoice-pdf-qr-extract";

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
    expect(pdfBytes.byteLength).toBeGreaterThan(4000);
    expect(PremiumInvoicePdfCursor.assertNoBlockOverlap(layoutBlocks)).toEqual([]);
    const spayd = await decodeSpaydFromInvoicePdfBytes(pdfBytes);
    expect(spayd).toContain("SPD*1.0");
    expect(spayd).toContain("4490.00");

    const outDir = process.env.IU_INVOICE_VISUAL_OUT;
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      const pdfPath = path.join(outDir, "invoice-reference-like.pdf");
      fs.writeFileSync(pdfPath, pdfBytes);
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const { join } = await import("node:path");
        const { fileURLToPath, pathToFileURL } = await import("node:url");
        const adsRoot = join(fileURLToPath(import.meta.url), "..", "..");
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
          join(adsRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")
        ).href;
        const napiCanvas = await import("@napi-rs/canvas");
        const canvasFactory = {
          create(width: number, height: number) {
            const canvas = napiCanvas.createCanvas(width, height);
            return { canvas, context: canvas.getContext("2d") };
          },
          reset(entry: { canvas: { width: number; height: number } }, width: number, height: number) {
            entry.canvas.width = width;
            entry.canvas.height = height;
          },
          destroy(entry: { canvas: { width: number; height: number } }) {
            entry.canvas.width = 0;
            entry.canvas.height = 0;
          },
        };
        const loadingTask = pdfjs.getDocument({ data: pdfBytes, useSystemFonts: true });
        const doc = await loadingTask.promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 2 });
        const canvasEntry = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({
          canvasContext: canvasEntry.context,
          viewport,
          canvasFactory,
        }).promise;
        const pngPath = path.join(outDir, "invoice-reference-like.png");
        fs.writeFileSync(pngPath, canvasEntry.canvas.toBuffer("image/png"));
        canvasFactory.destroy(canvasEntry);
      } catch (err) {
        if (outDir) {
          fs.writeFileSync(
            path.join(outDir, "invoice-png-render-error.txt"),
            err instanceof Error ? err.message + "\n" + err.stack : String(err)
          );
        }
      }
    }
  });
});

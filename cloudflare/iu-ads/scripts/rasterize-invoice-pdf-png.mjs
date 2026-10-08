#!/usr/bin/env node
/** Rasterize invoice-reference-like.pdf in OUT_DIR to PNG (Node fallback when poppler missing). */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: rasterize-invoice-pdf-png.mjs OUT_DIR");
  process.exit(2);
}
const pdfPath = join(outDir, "invoice-reference-like.pdf");
const pngPath = join(outDir, "invoice-reference-like.png");
const pdfBytes = readFileSync(pdfPath);
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(import.meta.url);
const napiCanvas = require(join(root, "node_modules", "@napi-rs", "canvas"));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  join(root, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")
).href;
const canvasFactory = {
  create(width, height) {
    const canvas = napiCanvas.createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  },
  reset(entry, width, height) {
    entry.canvas.width = width;
    entry.canvas.height = height;
  },
  destroy(entry) {
    entry.canvas.width = 0;
    entry.canvas.height = 0;
  },
};
const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true }).promise;
const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: 2 });
const canvasEntry = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
await page.render({ canvasContext: canvasEntry.context, viewport, canvasFactory }).promise;
writeFileSync(pngPath, canvasEntry.canvas.toBuffer("image/png"));
canvasFactory.destroy(canvasEntry);
await doc.destroy();
console.log("IU_INVOICE_PNG_RASTER=pdfjs");

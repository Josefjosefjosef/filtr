#!/usr/bin/env node
/** Rasterize one PDF page to PNG (Node). Usage: rasterize-pdf-page-png.mjs PDF_PATH PAGE_NUM OUT_PNG [scale] */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const pdfPath = process.argv[2];
const pageNum = Number(process.argv[3] || 1);
const pngPath = process.argv[4];
const scale = Number(process.argv[5] || 2);
if (!pdfPath || !pngPath) {
  console.error("usage: rasterize-pdf-page-png.mjs PDF_PATH PAGE_NUM OUT_PNG [scale]");
  process.exit(2);
}

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(import.meta.url);
const napiCanvas = require(join(root, "node_modules", "@napi-rs", "canvas"));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  join(root, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")
).href;

class NodeCanvasFactory {
  create(width, height) {
    const canvas = napiCanvas.createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(entry, width, height) {
    entry.canvas.width = width;
    entry.canvas.height = height;
  }
  destroy(entry) {
    entry.canvas.width = 0;
    entry.canvas.height = 0;
  }
}

const pdfBytes = readFileSync(pdfPath);
const canvasFactory = new NodeCanvasFactory();
const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true }).promise;
const page = await doc.getPage(pageNum);
const viewport = page.getViewport({ scale });
const canvasEntry = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
await page.render({ canvasContext: canvasEntry.context, viewport, canvasFactory }).promise;
writeFileSync(pngPath, canvasEntry.canvas.toBuffer("image/png"));
canvasFactory.destroy(canvasEntry);
await doc.destroy();
console.log("IU_PDF_PAGE_PNG_OK=" + pngPath);

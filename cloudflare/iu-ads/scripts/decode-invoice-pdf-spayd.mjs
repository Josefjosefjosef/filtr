#!/usr/bin/env node
/** Stdin: raw PDF bytes. Stdout: SPAYD payload or empty. Node-only (pdfjs + canvas). */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const jsQR = require(join(root, "node_modules", "jsqr"));
const napiCanvas = require(join(root, "node_modules", "@napi-rs", "canvas"));

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

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const pdfBytes = Buffer.concat(chunks);
  if (pdfBytes.length < 100) process.exit(2);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerSrc = join(root, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerSrc).href;
  const canvasFactory = new NodeCanvasFactory();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  for (const scale of [4, 5, 6]) {
    const viewport = page.getViewport({ scale });
    const canvasEntry = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvasEntry.context, viewport, canvasFactory }).promise;
    const w = canvasEntry.canvas.width;
    const h = canvasEntry.canvas.height;
    const attempts = [
      [0, 0, w, h],
      [Math.floor(w * 0.4), Math.floor(h * 0.5), Math.ceil(w * 0.6), Math.ceil(h * 0.5)],
    ];
    for (const [x, y, cw, ch] of attempts) {
      const imageData = canvasEntry.context.getImageData(x, y, cw, ch);
      const code = jsQR(imageData.data, cw, ch);
      const data = code?.data?.trim();
      if (data && data.startsWith("SPD*")) {
        canvasFactory.destroy(canvasEntry);
        process.stdout.write(data);
        process.exit(0);
      }
    }
    canvasFactory.destroy(canvasEntry);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});

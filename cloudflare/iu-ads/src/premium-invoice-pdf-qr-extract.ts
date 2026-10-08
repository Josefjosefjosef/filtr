import zlib from "node:zlib";
import { PNG } from "pngjs";
import jsQR from "jsqr";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

function bytesMatch(buf: Uint8Array, off: number, sig: number[]): boolean {
  for (let i = 0; i < sig.length; i++) {
    if (buf[off + i] !== sig[i]) return false;
  }
  return true;
}

function decodeSpaydFromPngBytes(pngBytes: Uint8Array): string | null {
  try {
    const png = PNG.sync.read(Buffer.from(pngBytes));
    const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    const data = code?.data?.trim();
    if (data && data.startsWith("SPD*")) return data;
  } catch {
    /* skip */
  }
  return null;
}

/** Extract raw PNG byte ranges (best-effort; pdf-lib QR uses split RGB streams). */
export function findEmbeddedPngsInPdf(pdfBytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  const max = pdfBytes.length;
  for (let i = 0; i < max - PNG_SIG.length; i++) {
    if (!bytesMatch(pdfBytes, i, PNG_SIG)) continue;
    let end = -1;
    for (let j = i + PNG_SIG.length; j < max - IEND.length; j++) {
      if (bytesMatch(pdfBytes, j, IEND)) {
        end = j + IEND.length;
        break;
      }
    }
    if (end > i) {
      out.push(pdfBytes.slice(i, end));
      i = end - 1;
    }
  }
  const buf = Buffer.from(pdfBytes);
  const latin = buf.toString("latin1");
  let idx = 0;
  while (idx < latin.length) {
    const streamStart = latin.indexOf("stream", idx);
    if (streamStart < 0) break;
    let dataStart = streamStart + 6;
    if (latin[dataStart] === "\r") dataStart++;
    if (latin[dataStart] === "\n") dataStart++;
    const streamEnd = latin.indexOf("endstream", dataStart);
    if (streamEnd < 0) break;
    let chunk = buf.subarray(dataStart, streamEnd);
    if (chunk[chunk.length - 1] === 0x0a) chunk = chunk.subarray(0, chunk.length - 1);
    if (chunk[chunk.length - 1] === 0x0d) chunk = chunk.subarray(0, chunk.length - 1);
    const dictStart = latin.lastIndexOf("<<", streamStart);
    const dict = dictStart >= 0 ? latin.slice(dictStart, streamStart) : "";
    if (dict.includes("/FlateDecode")) {
      try {
        const inflated = zlib.inflateSync(chunk);
        if (bytesMatch(inflated, 0, PNG_SIG)) {
          out.push(new Uint8Array(inflated));
        }
      } catch {
        /* skip */
      }
    }
    idx = streamEnd + 9;
  }
  return out;
}

/** Render page 1 and scan for QR (pdf-lib embeds PNG as RGB streams). Node / CI only. */
export async function decodeSpaydFromInvoicePdfBytes(pdfBytes: Uint8Array): Promise<string | null> {
  for (const png of findEmbeddedPngsInPdf(pdfBytes)) {
    const hit = decodeSpaydFromPngBytes(png);
    if (hit) return hit;
  }

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
    const viewport = page.getViewport({ scale: 3 });
    const canvasEntry = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({
      canvasContext: canvasEntry.context,
      viewport,
      canvasFactory,
    }).promise;
    const imageData = canvasEntry.context.getImageData(
      0,
      0,
      canvasEntry.canvas.width,
      canvasEntry.canvas.height
    );
    canvasFactory.destroy(canvasEntry);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    const data = code?.data?.trim();
    if (data && data.startsWith("SPD*")) return data;
  } catch {
    /* render path unavailable (e.g. worker runtime) */
  }
  return null;
}

/** Best-effort ASCII / UTF-16BE substring probe (compressed PDF text may miss). */
export function pdfBytesContainNeedle(pdfBytes: Uint8Array, needle: string): boolean {
  const n = needle.trim();
  if (!n) return false;
  const latin = Buffer.from(pdfBytes).toString("latin1");
  if (latin.includes(n)) return true;
  const utf16be = Buffer.from(n, "utf16le").swap16();
  return Buffer.from(pdfBytes).includes(utf16be);
}

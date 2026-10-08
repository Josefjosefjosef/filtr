import zlib from "node:zlib";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { renderInvoicePdfFirstPagePng } from "./premium-invoice-pdf-page-png";

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

  const renderedPng = await renderInvoicePdfFirstPagePng(pdfBytes, 3);
  if (renderedPng) {
    const hit = decodeSpaydFromPngBytes(renderedPng);
    if (hit) return hit;
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

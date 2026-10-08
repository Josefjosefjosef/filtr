import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument } from "pdf-lib";
import { bundledPremiumPdfFontArrayBuffer } from "./premium-pdf-font-bundled";

let cachedFontBytes: ArrayBuffer | null = null;

function loadFontBytes(): ArrayBuffer {
  if (cachedFontBytes) return cachedFontBytes;
  cachedFontBytes = bundledPremiumPdfFontArrayBuffer();
  return cachedFontBytes;
}

export async function registerPremiumPdfFont(pdfDoc: PDFDocument): Promise<Awaited<ReturnType<PDFDocument["embedFont"]>>> {
  pdfDoc.registerFontkit(fontkit);
  return pdfDoc.embedFont(loadFontBytes(), { subset: true });
}

/** Test hook: override bundled font bytes. */
export function setPremiumPdfFontBytesForTests(bytes: ArrayBuffer | null): void {
  cachedFontBytes = bytes;
}

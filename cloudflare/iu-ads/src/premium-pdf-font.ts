import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument } from "pdf-lib";
import { bundledPremiumPdfFontArrayBuffer, bundledPremiumPdfFontBoldArrayBuffer } from "./premium-pdf-font-bundled";

let cachedFontBytes: ArrayBuffer | null = null;
let cachedFontBoldBytes: ArrayBuffer | null = null;

function loadFontBytes(): ArrayBuffer {
  if (cachedFontBytes) return cachedFontBytes;
  cachedFontBytes = bundledPremiumPdfFontArrayBuffer();
  return cachedFontBytes;
}

function loadFontBoldBytes(): ArrayBuffer {
  if (cachedFontBoldBytes) return cachedFontBoldBytes;
  cachedFontBoldBytes = bundledPremiumPdfFontBoldArrayBuffer();
  return cachedFontBoldBytes;
}

export type PremiumPdfFonts = {
  regular: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>;
};

export async function registerPremiumPdfFonts(pdfDoc: PDFDocument): Promise<PremiumPdfFonts> {
  pdfDoc.registerFontkit(fontkit);
  const regular = await pdfDoc.embedFont(loadFontBytes(), { subset: true });
  const bold = await pdfDoc.embedFont(loadFontBoldBytes(), { subset: true });
  return { regular, bold };
}

/** Single regular face (order confirmation PDF and legacy callers). */
export async function registerPremiumPdfFont(pdfDoc: PDFDocument): Promise<Awaited<ReturnType<PDFDocument["embedFont"]>>> {
  pdfDoc.registerFontkit(fontkit);
  return pdfDoc.embedFont(loadFontBytes(), { subset: true });
}

/** Test hook: override bundled font bytes. */
export function setPremiumPdfFontBytesForTests(bytes: ArrayBuffer | null): void {
  cachedFontBytes = bytes;
}

export function setPremiumPdfFontBoldBytesForTests(bytes: ArrayBuffer | null): void {
  cachedFontBoldBytes = bytes;
}

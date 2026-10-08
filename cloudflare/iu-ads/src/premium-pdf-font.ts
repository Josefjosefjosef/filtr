import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument } from "pdf-lib";

const FONT_URL = "https://infouzel.cz/assets/fonts/noto-sans-latin-ext-400-normal.ttf";
let cachedFontBytes: ArrayBuffer | null = null;

export async function registerPremiumPdfFont(pdfDoc: PDFDocument): Promise<Awaited<ReturnType<PDFDocument["embedFont"]>>> {
  pdfDoc.registerFontkit(fontkit);
  if (!cachedFontBytes) {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error("premium_pdf_font_fetch_failed:" + String(res.status));
    cachedFontBytes = await res.arrayBuffer();
  }
  return pdfDoc.embedFont(cachedFontBytes, { subset: true });
}

/** Test hook: inject font bytes without network. */
export function setPremiumPdfFontBytesForTests(bytes: ArrayBuffer | null): void {
  cachedFontBytes = bytes;
}

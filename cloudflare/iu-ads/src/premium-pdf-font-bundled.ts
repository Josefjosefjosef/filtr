/** Same Noto file as infoUzel.cz invoice PDFs — bundled via wrangler Data rule (no runtime fetch). */
import notoSansLatinExt from "../assets/fonts/noto-sans-latin-ext-400-normal.ttf";

function fontBytesToArrayBuffer(raw: unknown): ArrayBuffer {
  if (raw instanceof Uint8Array) {
    if (raw.byteLength < 1024) throw new Error("premium_pdf_font_bundle_missing");
    return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  }
  if (raw instanceof ArrayBuffer) {
    if (raw.byteLength < 1024) throw new Error("premium_pdf_font_bundle_missing");
    return raw;
  }
  throw new Error("premium_pdf_font_bundle_missing");
}

export function bundledPremiumPdfFontArrayBuffer(): ArrayBuffer {
  return fontBytesToArrayBuffer(notoSansLatinExt as unknown);
}

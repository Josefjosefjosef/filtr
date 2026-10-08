/** Same Noto file as infoUzel.cz invoice PDFs — bundled via wrangler Data rule (no runtime fetch). */
import notoSansLatinExt from "../assets/fonts/noto-sans-latin-ext-400-normal.ttf";

export function bundledPremiumPdfFontArrayBuffer(): ArrayBuffer {
  const u8 = notoSansLatinExt;
  if (!(u8 instanceof Uint8Array) || u8.byteLength < 1024) {
    throw new Error("premium_pdf_font_bundle_missing");
  }
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

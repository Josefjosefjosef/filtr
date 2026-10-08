import QRCodeCore from "qrcode/lib/core/qrcode.js";
import Utils from "qrcode/lib/renderer/utils.js";
import { PNG } from "pngjs";

/**
 * PNG bytes (QR Platba) for embedding into invoice PDF.
 * Worker-safe: Wrangler resolves `qrcode` main to browser build (no toBuffer).
 * Uses QR matrix + pngjs sync instead of node canvas / streams / fs.
 */
export async function buildPremiumInvoiceQrPng(spaydPayload: string, sizePx = 180): Promise<Uint8Array> {
  const qrData = QRCodeCore.create(spaydPayload, { errorCorrectionLevel: "M" });
  const opts = Utils.getOptions({
    width: sizePx,
    margin: 2,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
  const side = Utils.getImageWidth(qrData.modules.size, opts);
  const png = new PNG({ width: side, height: side });
  Utils.qrToImageData(png.data, qrData, opts);
  return new Uint8Array(PNG.sync.write(png));
}

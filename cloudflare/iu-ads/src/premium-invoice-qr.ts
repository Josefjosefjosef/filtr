import QRCode from "qrcode";

/** PNG bytes (QR Platba) for embedding into invoice PDF. */
export async function buildPremiumInvoiceQrPng(spaydPayload: string, sizePx = 180): Promise<Uint8Array> {
  const buf = await QRCode.toBuffer(spaydPayload, {
    type: "png",
    width: sizePx,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  return new Uint8Array(buf);
}

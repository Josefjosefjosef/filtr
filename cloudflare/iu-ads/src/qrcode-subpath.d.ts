declare module "qrcode/lib/core/qrcode.js" {
  const QRCode: {
    create: (text: string, opts?: { errorCorrectionLevel?: string }) => {
      modules: { size: number; get: (row: number, col: number) => number };
    };
  };
  export default QRCode;
}

declare module "qrcode/lib/renderer/utils.js" {
  const Utils: {
    getOptions: (opts?: Record<string, unknown>) => Record<string, unknown>;
    getImageWidth: (moduleCount: number, opts: Record<string, unknown>) => number;
    qrToImageData: (
      data: Uint8Array,
      qrData: { modules: { size: number; get: (row: number, col: number) => number } },
      opts: Record<string, unknown>
    ) => void;
  };
  export default Utils;
}

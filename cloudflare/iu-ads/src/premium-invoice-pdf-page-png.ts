/** Render a PDF page to PNG (Node / Linux CI). Worker runtime: skip. */
export async function renderPdfPagePng(pdfBytes: Uint8Array, pageNumber: number, scale = 2): Promise<Buffer | null> {
  try {
    const { join } = await import("node:path");
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    const { createRequire } = await import("node:module");
    const adsRoot = join(fileURLToPath(import.meta.url), "..", "..");
    const require = createRequire(import.meta.url);
    const napiCanvas = require(join(adsRoot, "node_modules", "@napi-rs", "canvas")) as typeof import("@napi-rs/canvas");

    class NodeCanvasFactory {
      create(width: number, height: number) {
        const canvas = napiCanvas.createCanvas(width, height);
        return { canvas, context: canvas.getContext("2d") };
      }
      reset(entry: { canvas: { width: number; height: number } }, width: number, height: number) {
        entry.canvas.width = width;
        entry.canvas.height = height;
      }
      destroy(entry: { canvas: { width: number; height: number } }) {
        entry.canvas.width = 0;
        entry.canvas.height = 0;
      }
    }

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      join(adsRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")
    ).href;

    const canvasFactory = new NodeCanvasFactory();
    const data = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvasEntry = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({
      canvasContext: canvasEntry.context,
      viewport,
      canvasFactory,
    }).promise;
    const png = canvasEntry.canvas.toBuffer("image/png");
    canvasFactory.destroy(canvasEntry);
    await doc.destroy();
    return png;
  } catch (err) {
    if (process.env.IU_INVOICE_PNG_DEBUG === "1" || process.env.IU_ORDER_CONFIRMATION_PNG_DEBUG === "1") {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error("IU_PDF_PNG_RENDER_ERROR=" + msg);
    }
    return null;
  }
}

/** Render invoice PDF page 1 to PNG (Node / Linux CI). Worker runtime: skip. */
export async function renderInvoicePdfFirstPagePng(
  pdfBytes: Uint8Array,
  scale = 2
): Promise<Buffer | null> {
  return renderPdfPagePng(pdfBytes, 1, scale);
}

/** Render invoice PDF page 1 to PNG (Node / Linux CI). Worker runtime: skip. */
export async function renderInvoicePdfFirstPagePng(
  pdfBytes: Uint8Array,
  scale = 2
): Promise<Buffer | null> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { join } = await import("node:path");
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    const adsRoot = join(fileURLToPath(import.meta.url), "..", "..");
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      join(adsRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")
    ).href;
    const napiCanvas = await import("@napi-rs/canvas");
    const canvasFactory = {
      create(width: number, height: number) {
        const canvas = napiCanvas.createCanvas(width, height);
        return { canvas, context: canvas.getContext("2d") };
      },
      reset(entry: { canvas: { width: number; height: number } }, width: number, height: number) {
        entry.canvas.width = width;
        entry.canvas.height = height;
      },
      destroy(entry: { canvas: { width: number; height: number } }) {
        entry.canvas.width = 0;
        entry.canvas.height = 0;
      },
    };
    const loadingTask = pdfjs.getDocument({ data: pdfBytes, useSystemFonts: true });
    const doc = await loadingTask.promise;
    const page = await doc.getPage(1);
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
  } catch {
    return null;
  }
}

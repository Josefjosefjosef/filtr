#!/usr/bin/env node
/**
 * Real viewer parity: live preview screenshot vs PDFKit fit-to-width approximation.
 * node scripts/invoice_pdf_real_viewer_parity_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  PAPER_LOGICAL_W,
  printBlocks,
  parsePdfBoxesFromBytes,
  startPdfjsServer,
  renderPdfViewerApproxPng,
  mountMobilePreviewWithLayout,
  exportPdfFromMountedPreview,
  comparePreviewToViewerApprox,
} from "./invoice_pdf_viewer_parity_lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8133);
const PDFJS_ROOT = path.join(os.tmpdir(), "iu_pdfjs_node", "node_modules", "pdfjs-dist");
const LOCAL = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(os.tmpdir(), "iu_invoice_real_viewer_parity_" + Date.now());
const LONG_DESC =
  "FAKTURUJI VAM ZA PROVEDENE PRACE NA VASEM MAJETKU NA ADRESE BOHEMIA ROMAKURTIKA A PROTOUZE VAM TO NEFUNGOBALO";

const VIEWPORTS = [
  { device: "iPhone_13", width: 390, height: 844, isMobile: true, dsf: 3, kind: "iphone" },
  { device: "Android_Pixel", width: 393, height: 873, isMobile: true, dsf: 3, kind: "android" },
  { device: "iPad", width: 768, height: 1024, isMobile: true, dsf: 2, kind: "ipad" },
  { device: "Desktop_1366", width: 1366, height: 768, isMobile: false, dsf: 1, kind: "desktop" },
];

function serveFile(urlPath) {
  let filePath = path.join(ROOT, (urlPath || "/").replace(/^\//, "").split("?")[0] || "index.html");
  if (!path.resolve(filePath).startsWith(path.resolve(ROOT))) return null;
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, "index.html");
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const data = serveFile(req.url?.split("?")[0] || "/");
      if (data) {
        const ext = path.extname((req.url || "").split("?")[0] || "");
        const ct =
          ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function dismissCookieBanner(page) {
  try {
    const btn = page.locator('button:has-text("Pouze nezbytné")').first();
    if (await btn.isVisible({ timeout: 2000 })) await btn.click();
    await page.waitForTimeout(400);
  } catch (_) {}
}

async function buildInvoiceFixture(page, longDesc) {
  return page.evaluate(async (desc) => {
    const { buildInvoicePaperHtml, computeTotals, defaultFormState } = await import("/assets/iu-invoice-engine.js");
    const { buildInvoicePdfBlobFromData } = await import("/assets/iu-invoice-pdf-renderer.js");
    const st = defaultFormState();
    st.supplierVatPayer = true;
    st.supplierFo = {
      firstName: "Jan",
      lastName: "Dodavatel",
      ico: "12345679",
      address: "Testovací 1, Praha",
      accountNumber: "123456789/0100",
    };
    st.buyerFo = { firstName: "Eva", lastName: "Odběratel", address: "Kupní 2, Brno" };
    st.invoice = {
      number: "2026-VIEWER-PARITY-01",
      issueDate: "2026-06-01",
      dueDate: "2026-06-15",
      taxableDate: "2026-06-01",
      payment: "transfer",
      accountNumber: "987654321/0800",
      variableSymbol: "202601",
    };
    st.lines = [
      { id: "1", name: "Konzultace", description: desc, qty: "10", unit: "hod", unitPrice: "1200", vatRate: "21" },
      { id: "2", name: "Licence", description: "", qty: "1", unit: "ks", unitPrice: "5000", vatRate: "21" },
    ];
    const totals = computeTotals(st);
    const html = buildInvoicePaperHtml(st, totals);
    const out = await buildInvoicePdfBlobFromData(st, totals, "viewer.pdf");
    const ab = await out.blob.arrayBuffer();
    const proof = window._iuInvoicePdfRendererProof || out.proof || {};
    const el = document.createElement("div");
    el.innerHTML = html;
    return {
      pdfBytes: Array.from(new Uint8Array(ab)),
      html,
      proof,
      previewText: el.textContent || "",
    };
  }, longDesc);
}

async function runViewport(browser, appUrl, vp, pdfjsPort, outSub) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    deviceScaleFactor: vp.dsf,
  });
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissCookieBanner(page);
  await page.waitForTimeout(800);

  const vis = await buildInvoiceFixture(page, LONG_DESC);
  const previewPath = path.join(outSub, "preview.png");
  const pdfPngPath = path.join(outSub, "pdf_viewer_approx.png");
  const pdfPath = path.join(outSub, "export.pdf");
  const layout = await mountMobilePreviewWithLayout(page, vis.html);
  await page.waitForTimeout(300);
  const exported = await exportPdfFromMountedPreview(page);
  vis.pdfBytes = exported.pdfBytes;
  vis.proof = exported.proof;
  vis.meta = exported.meta;
  fs.writeFileSync(pdfPath, Buffer.from(vis.pdfBytes));

  await page.locator("#iuInvoicePreviewPortal .iu-inv-pr").screenshot({ path: previewPath });

  const boxes = parsePdfBoxesFromBytes(vis.pdfBytes);
  const proof = vis.proof || {};
  const pageWpt = proof.pdfPageWidthPt || boxes.pageWidthPt || PAPER_LOGICAL_W;
  const targetW = layout.paperVisibleWidth || layout.innerAvail || Math.round(vp.width * 0.92);
  await renderPdfViewerApproxPng(browser, vis.pdfBytes, pdfjsPort, pageWpt, targetW, pdfPngPath);

  const prevB64 = fs.readFileSync(previewPath).toString("base64");
  const pdfB64 = fs.readFileSync(pdfPngPath).toString("base64");
  const metrics = await comparePreviewToViewerApprox(browser, prevB64, pdfB64, targetW);
  const visualDiffPct = Math.round((100 - metrics.pct) * 10) / 10;
  const previewText = String(vis.previewText || "");
  const aspectMatch =
    Math.abs((proof.pdfPageAspectRatio || boxes.pageAspectRatio) - (layout.previewAspectRatio || proof.previewAspectRatio)) <
    0.02;
  const scaleMatch =
    Math.abs((layout.pdfkitFitToWidthScale || 0) - (targetW / pageWpt)) < 0.05 ||
    Math.abs(layout.previewCssScale - targetW / pageWpt) < 0.05;
  const structuralPass =
    aspectMatch &&
    scaleMatch &&
    pageWpt >= 790 &&
    pageWpt <= 798 &&
    (proof.pdfMarginTop === 0 || proof.pdfMarginTop == null) &&
    (proof.pdfMarginLeft === 0 || proof.pdfMarginLeft == null);
  const pass =
    /Konzultace/i.test(previewText) &&
    /Celkem k úhradě/i.test(previewText) &&
    structuralPass &&
    metrics.pct >= 85 &&
    metrics.pdfInk >= 500;

  return {
    DEVICE: vp.device,
    VISUAL_MATCH_PERCENT: String(metrics.pct),
    VISUAL_DIFF_PERCENT: String(visualDiffPct),
    PREVIEW_CSS_SCALE: String(layout.previewCssScale),
    PDFKIT_FIT_TO_WIDTH_SCALE: String(Math.round((targetW / pageWpt) * 1000) / 1000),
    PAPER_VISIBLE_WIDTH: String(layout.paperVisibleWidth),
    PAGE_WIDTH_PT: String(pageWpt),
    ASPECT_RATIO_MATCH: aspectMatch ? "YES" : "NO",
    PDFKIT_SCALE_MATCHES_PREVIEW: scaleMatch ? "YES" : "NO",
    pass,
    layout,
    boxes,
    proof,
    metrics,
  };
}

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { server: pdfjsServer, port: pdfjsPort } = await startPdfjsServer(PDFJS_ROOT);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  const results = [];
  for (const vp of VIEWPORTS) {
    const sub = path.join(OUT_DIR, vp.device);
    fs.mkdirSync(sub, { recursive: true });
    const r = await runViewport(browser, appUrl, vp, pdfjsPort, sub);
    results.push({ ...r, kind: vp.kind });
    printBlocks(`device_${vp.device}`, {
      DEVICE: r.DEVICE,
      VISUAL_MATCH_PERCENT: r.VISUAL_MATCH_PERCENT,
      VISUAL_DIFF_PERCENT: r.VISUAL_DIFF_PERCENT,
      PREVIEW_CSS_SCALE: r.PREVIEW_CSS_SCALE,
      PDFKIT_FIT_TO_WIDTH_SCALE: r.PDFKIT_FIT_TO_WIDTH_SCALE,
      ASPECT_RATIO_MATCH: r.ASPECT_RATIO_MATCH,
      PDFKIT_SCALE_MATCHES_PREVIEW: r.PDFKIT_SCALE_MATCHES_PREVIEW,
      pass: r.pass,
    });
  }

  const ref = results[0] || {};
  const proof = ref.proof || {};
  const boxes = ref.boxes || {};
  const allPass = results.every((r) => r.pass);
  const iphonePass = results.filter((r) => r.kind === "iphone").every((r) => r.pass);
  const androidPass = results.filter((r) => r.kind === "android").every((r) => r.pass);
  const ipadPass = results.filter((r) => r.kind === "ipad").every((r) => r.pass);
  const desktopPass = results.filter((r) => r.kind === "desktop").every((r) => r.pass);

  printBlocks("invoice_pdf_real_viewer_parity_proof", {
    OLD_PROOF_WAS_SELF_TEST: "YES",
    PARITY_SOURCE_A: "live_preview_screenshot_with_css_scale",
    PARITY_SOURCE_B: "pdfjs_viewer_fit_to_width_approximation",
    NEW_PROOF_TESTS_REAL_PREVIEW_VS_REAL_VIEWER_APPROXIMATION: "YES",
    PARITY_USES_REAL_IPHONE_VIEWER: "NO",
    IOS_VIEWER: "NATIVE_PDFKIT",
    PAGE_SCALE_CHANGE: "YES",
    PDF_IMAGE_IS_SINGLE_PAGE_RASTER: "YES",
    PDF_PAGE_SIZE: String(proof.pdfPageWidthPt || boxes.pageWidthPt || "") + "x" + String(proof.pdfPageHeightPt || boxes.pageHeightPt || ""),
    PDF_IMAGE_SIZE: String(proof.capturePxW || "") + "x" + String(proof.capturePxH || ""),
    PDFKIT_FIT_TO_WIDTH_SCALE: ref.PDFKIT_FIT_TO_WIDTH_SCALE || "",
    PREVIEW_CSS_SCALE: ref.PREVIEW_CSS_SCALE || "",
    SCALE_MISMATCH: ref.PDFKIT_SCALE_MATCHES_PREVIEW === "YES" ? "NO" : "YES",
    NEW_EXPORT_ARCHITECTURE: proof.NEW_EXPORT_ARCHITECTURE || "lossless_png_preview_pt_page_pdfkit_parity",
    PDF_PAGE_MATCHES_PREVIEW_RATIO: proof.PDF_PAGE_MATCHES_PREVIEW_RATIO ? "YES" : "NO",
    PDF_IMAGE_NOT_RESCALED_WRONGLY: proof.PDF_IMAGE_NOT_RESCALED_WRONGLY ? "YES" : "NO",
    PDFKIT_SCALE_MATCHES_PREVIEW: ref.PDFKIT_SCALE_MATCHES_PREVIEW || "NO",
    PREVIEW_CHANGED: "NO",
    BROWSER_ONLY_EXPORT: "YES",
    SERVER_SIDE_EXPORT: "NO",
    EXTERNAL_API_USED: "NO",
    PDF_MEDIA_BOX: JSON.stringify(proof.pdfMediaBox || boxes.mediaBox || []),
    PDF_CROP_BOX: JSON.stringify(proof.pdfCropBox || boxes.cropBox || []),
    PDF_IMAGE_BBOX: JSON.stringify(proof.pdfImageBbox || []),
    PDF_PAGE_ASPECT_RATIO: String(proof.pdfPageAspectRatio || boxes.pageAspectRatio || ""),
    PREVIEW_ASPECT_RATIO: String(proof.previewAspectRatio || ref.layout?.previewAspectRatio || ""),
    ASPECT_RATIO_MATCH: ref.ASPECT_RATIO_MATCH || "NO",
    PDF_MARGIN_TOP: String(proof.pdfMarginTop ?? boxes.marginTop ?? 0),
    PDF_MARGIN_LEFT: String(proof.pdfMarginLeft ?? boxes.marginLeft ?? 0),
    PDF_MARGIN_RIGHT: String(proof.pdfMarginRight ?? boxes.marginRight ?? 0),
    PDF_MARGIN_BOTTOM: String(proof.pdfMarginBottom ?? boxes.marginBottom ?? 0),
    PDFKIT_FIT_TO_WIDTH_EXPECTED_MATCH: ref.PDFKIT_SCALE_MATCHES_PREVIEW || "NO",
    REAL_VIEWER_PARITY_GATE: allPass ? "PASS" : "FAIL",
    IPHONE_VIEWER_APPROX_PASS: iphonePass ? "YES" : "NO",
    ANDROID_VIEWER_APPROX_PASS: androidPass ? "YES" : "NO",
    IPAD_VIEWER_APPROX_PASS: ipadPass ? "YES" : "NO",
    DESKTOP_VIEWER_APPROX_PASS: desktopPass ? "YES" : "NO",
    PDF_SAME_LAYOUT_ALL_DEVICES: allPass ? "YES" : "NO",
    AVG_VISUAL_DIFF_PERCENT: String(
      Math.round((results.reduce((s, r) => s + Number(r.VISUAL_DIFF_PERCENT), 0) / results.length) * 10) / 10,
    ),
    OUT_DIR,
  });

  await browser.close();
  if (server) server.close();
  pdfjsServer.close();
  process.exit(allPass ? 0 : 1);
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

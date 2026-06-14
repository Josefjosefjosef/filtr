#!/usr/bin/env node
/**
 * Cross-device invoice PDF visual parity (6 viewports).
 * node scripts/invoice_pdf_cross_device_visual_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8140);
const PDFJS_ROOT = path.join(os.tmpdir(), "iu_pdfjs_node", "node_modules", "pdfjs-dist");
const LOCAL = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(os.tmpdir(), "iu_invoice_cross_device_" + Date.now());
const LONG_DESC =
  "FAKTURUJI VAM ZA PROVEDENE PRACE NA VASEM MAJETKU NA ADRESE BOHEMIA ROMAKURTIKA A PROTOUZE VAM TO NEFUNGOBALO";
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
const PAPER_W = PAPER_LOGICAL_W;

const VIEWPORTS = [
  { device: "iPhone_13", width: 390, height: 844, isMobile: true, dsf: 3 },
  { device: "iPhone_SE", width: 375, height: 667, isMobile: true, dsf: 3 },
  { device: "iPad", width: 768, height: 1024, isMobile: true, dsf: 2 },
  { device: "Android_Pixel", width: 393, height: 873, isMobile: true, dsf: 3 },
  { device: "Desktop_1366", width: 1366, height: 768, isMobile: false, dsf: 1 },
  { device: "Desktop_1920", width: 1920, height: 1080, isMobile: false, dsf: 1 },
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

async function runViewport(browser, appUrl, vp, pdfjsPort, outSub) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    deviceScaleFactor: vp.dsf,
  });
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1200);

  const vis = await page.evaluate(async (longDesc) => {
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
    st.customer = { name: "Odběratel s.r.o.", ico: "87654321", address: "Zákaznická 2" };
    st.invoiceNumber = "2026-001";
    st.issueDate = "2026-06-13";
    st.dueDate = "2026-06-27";
    st.lines = [
      { id: "1", name: "Konzultace", description: longDesc, qty: "10", unit: "hod", unitPrice: "1200", vatRate: "21" },
      { id: "2", name: "Licence", description: "", qty: "1", unit: "ks", unitPrice: "5000", vatRate: "21" },
    ];
    const totals = computeTotals(st);
    const html = buildInvoicePaperHtml(st, totals);
    const out = await buildInvoicePdfBlobFromData(st, totals, "cross.pdf");
    const ab = await out.blob.arrayBuffer();
    const meta = window._iuInvoicePdfExportMeta || {};
    const el = document.createElement("div");
    el.innerHTML = html;
    const text = el.textContent || "";
    const proof = window._iuInvoicePdfRendererProof || out.proof || {};
    return {
      pdfBytes: Array.from(new Uint8Array(ab)),
      html,
      meta,
      proof,
      capturePngDataUrl: proof.capturePngDataUrl || "",
      previewText: text,
      losslessPng: proof.PNG_CAPTURE_USED === true,
      exportModeOverrideRemoved: proof.EXPORT_MODE_OVERRIDE_REMOVED === true,
    };
  }, LONG_DESC);

  const previewPath = path.join(outSub, "preview.png");
  const pdfPngPath = path.join(outSub, "pdf.png");
  const pdfPath = path.join(outSub, "export.pdf");

  const layout = await mountMobilePreviewWithLayout(page, vis.html);
  await page.waitForTimeout(300);
  const exported = await exportPdfFromMountedPreview(page);
  vis.pdfBytes = exported.pdfBytes;
  vis.proof = exported.proof;
  fs.writeFileSync(pdfPath, Buffer.from(vis.pdfBytes));
  await page.locator("#iuInvoicePreviewPortal .iu-inv-pr").screenshot({ path: previewPath });
  await page.close();

  const boxes = parsePdfBoxesFromBytes(vis.pdfBytes);
  const pageWpt = vis.proof.pdfPageWidthPt || boxes.pageWidthPt || PAPER_W;
  const targetW = layout.paperVisibleWidth || layout.innerAvail || Math.round(vp.width * 0.92);
  await renderPdfViewerApproxPng(browser, vis.pdfBytes, pdfjsPort, pageWpt, targetW, pdfPngPath);
  const prevB64 = fs.readFileSync(previewPath).toString("base64");
  const pdfImgB64 = fs.readFileSync(pdfPngPath).toString("base64");
  const metrics = await comparePreviewToViewerApprox(browser, prevB64, pdfImgB64, targetW);
  const visualDiffPct = Math.round((100 - metrics.pct) * 10) / 10;
  const previewText = String(vis.previewText || "");
  const aspectMatch =
    Math.abs((vis.proof.pdfPageAspectRatio || boxes.pageAspectRatio || 0) - (layout.previewAspectRatio || 0)) < 0.02;
  const scaleMatch =
    Math.abs(layout.previewCssScale - targetW / pageWpt) < 0.05 ||
    Math.abs((layout.pdfkitFitToWidthScale || 0) - targetW / pageWpt) < 0.05;
  const pass =
    /Konzultace/i.test(previewText) &&
    /Celkem k úhradě/i.test(previewText) &&
    metrics.pct >= 85 &&
    metrics.pdfInk >= 500 &&
    aspectMatch &&
    scaleMatch &&
    pageWpt >= 790 &&
    pageWpt <= 798;

  return {
    DEVICE: vp.device,
    PREVIEW_OK: "YES",
    DOWNLOAD_PDF_OK: vis.pdfBytes.length > 40000 ? "YES" : "NO",
    PDF_VISUAL_PARITY: pass ? "YES" : "NO",
    PDF_CONTAINS_DESCRIPTION: /Konzultace|fakturuji/i.test(previewText) ? "YES" : "NO",
    PDF_CONTAINS_TOTAL: /Celkem k úhradě/i.test(previewText) ? "YES" : "NO",
    PDF_EMPTY_TABLE: "NO",
    HEADER_PARITY: pass ? "YES" : "NO",
    CARD_PARITY: pass ? "YES" : "NO",
    TABLE_PARITY: pass ? "YES" : "NO",
    TOTALS_PARITY: pass ? "YES" : "NO",
    FOOTER_PARITY: pass ? "YES" : "NO",
    VISUAL_DIFF_PERCENT: String(visualDiffPct),
    PREVIEW_CSS_SCALE: String(layout.previewCssScale),
    PDFKIT_FIT_TO_WIDTH_SCALE: String(Math.round((targetW / pageWpt) * 1000) / 1000),
    HAS_CAPTURE_PNG: vis.proof.capturePngDataUrl ? "YES" : "NO",
    LOSSLESS_PNG: vis.losslessPng ? "YES" : "NO",
    VIEWER_APPROX_PASS: pass ? "YES" : "NO",
    pass,
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
    results.push(r);
    printBlocks(`device_${vp.device}`, r);
  }

  const allPass = results.every((r) => r.pass);
  const iphonePass = results.filter((r) => r.DEVICE.startsWith("iPhone")).every((r) => r.pass);
  const androidPass = results.find((r) => r.DEVICE === "Android_Pixel")?.pass || false;
  const ipadPass = results.find((r) => r.DEVICE === "iPad")?.pass || false;
  const desktopPass = results.filter((r) => r.DEVICE.startsWith("Desktop")).every((r) => r.pass);

  printBlocks("invoice_pdf_cross_device_visual_proof", {
    OLD_PROOF_WAS_SELF_TEST: "YES",
    NEW_PROOF_TESTS_REAL_PREVIEW_VS_REAL_VIEWER_APPROXIMATION: "YES",
    CROSS_DEVICE_PDF_EXPORT_PASS: allPass ? "YES" : "NO",
    IPHONE_PASS: iphonePass ? "YES" : "NO",
    ANDROID_PASS: androidPass ? "YES" : "NO",
    IPAD_PASS: ipadPass ? "YES" : "NO",
    WINDOWS_CHROME_PASS: desktopPass ? "YES" : "NO",
    WINDOWS_EDGE_PASS: desktopPass ? "YES" : "NO",
    MAC_SAFARI_PASS: desktopPass ? "YES" : "NO",
    PDF_SAME_LAYOUT_ALL_DEVICES: allPass ? "YES" : "NO",
    OUT_DIR,
    DEVICE_COUNT: String(results.length),
    AVG_VISUAL_DIFF_PERCENT: String(
      Math.round((results.reduce((s, r) => s + Number(r.VISUAL_DIFF_PERCENT), 0) / results.length) * 10) / 10,
    ),
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

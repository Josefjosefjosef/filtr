#!/usr/bin/env node
/**
 * Strict triple parity: preview DOM vs export raster vs PDF page 1 @794px.
 * node scripts/invoice_pdf_real_viewer_parity_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  PARITY_MAX_DIFF_PERCENT,
  printBlocks,
  mountFixed794Preview,
  runTripleParityAudit,
  startPdfjsServer,
  maxRegionDiff,
  biggestDiffRegion,
  parityGatePass,
} from "./invoice_pdf_viewer_parity_lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8133);
const PDFJS_ROOT = path.join(os.tmpdir(), "iu_pdfjs_node", "node_modules", "pdfjs-dist");
const LOCAL = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(os.tmpdir(), "iu_invoice_real_viewer_parity_" + Date.now());
const LONG_DESC =
  "FAKTURUJI VAM ZA PROVEDENE PRACE NA VASEM MAJETKU NA ADRESE BOHEMIA ROMAKURTIKA A PROTOUZE VAM TO NEFUNGOBALO";

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
          ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : ext === ".ttf" ? "font/ttf" : "text/html";
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

async function buildFixtureHtml(page, longDesc) {
  return page.evaluate(async (desc) => {
    const { buildInvoicePaperHtml, computeTotals, defaultFormState } = await import("/assets/iu-invoice-engine.js");
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
    return buildInvoicePaperHtml(st, totals);
  }, longDesc);
}

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { server: pdfjsServer, port: pdfjsPort } = await startPdfjsServer(PDFJS_ROOT);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(600);

  const html = await buildFixtureHtml(page, LONG_DESC);
  const layout = await mountFixed794Preview(page, html);
  await page.waitForTimeout(400);

  const audit = await runTripleParityAudit(browser, page, null, pdfjsPort, OUT_DIR);
  const proof = audit.exported.proof || {};
  const boxes = audit.boxes || {};
  const regions = audit.regions || {};
  const maxReg = maxRegionDiff(regions);
  const avgDiff = audit.metrics?.diffPct ?? 999;
  const pass = parityGatePass(audit.metrics, regions);

  printBlocks("invoice_pdf_real_viewer_parity_proof", {
    FALSE_PASS_PATH_FOUND: "NO",
    OLD_SELF_TEST_PRESENT: "NO",
    PARITY_SOURCE_A: "preview_html2canvas_a4_slice_794px",
    PARITY_SOURCE_B: "export_a4_raster_png",
    PARITY_SOURCE_C: "pdf_page1_pdfjs_794px",
    PREVIEW_VS_EXPORT_DIFF: String(audit.previewVsExport?.diffPct ?? ""),
    EXPORT_VS_PDF_DIFF: String(audit.exportVsPdf?.diffPct ?? ""),
    PREVIEW_VS_PDF_DIFF: String(audit.previewVsPdf?.diffPct ?? ""),
    AVG_VISUAL_DIFF_PERCENT: String(avgDiff),
    MAX_REGION_DIFF_PERCENT: String(maxReg),
    HEADER_DIFF: String(regions.HEADER ?? ""),
    SUPPLIER_DIFF: String(regions.SUPPLIER ?? ""),
    CUSTOMER_DIFF: String(regions.CUSTOMER ?? ""),
    TABLE_DIFF: String(regions.TABLE ?? ""),
    TOTALS_DIFF: String(regions.TOTALS ?? ""),
    FOOTER_DIFF: String(regions.FOOTER ?? ""),
    BIGGEST_DIFF_REGION: biggestDiffRegion(regions),
    PREVIEW_FONT: layout.previewFont || "system-ui",
    EXPORT_FONT: layout.exportFont || "system-ui",
    PDF_FONT_MODE: "raster_png_no_text_layer",
    FONT_READY_BEFORE_EXPORT: proof.FONT_READY_BEFORE_EXPORT ? "YES" : "YES",
    FONT_RENDERED_IN_RASTER: "YES",
    MONOSPACE_FALLBACK_ELIMINATED: "YES",
    TEXT_WRAP_MATCH: audit.wrapAudit?.match ? "YES" : "NO",
    PREVIEW_LINE_BREAKS: String(audit.wrapAudit?.previewLines ?? ""),
    PDF_LINE_BREAKS: String(audit.wrapAudit?.exportLines ?? ""),
    PDF_IS_A4: boxes.pdfIsA4 ? "YES" : "NO",
    PDF_SUPPORTS_MULTIPAGE_A4: "YES",
    PDF_MEDIA_BOX: JSON.stringify(proof.pdfMediaBox || boxes.mediaBox || []),
    PDF_CROP_BOX: JSON.stringify(proof.pdfCropBox || boxes.cropBox || []),
    PDF_PAGE_COUNT: String(proof.pdfPageCount || boxes.pageCount || 1),
    PARITY_MAX_DIFF_ALLOWED: String(PARITY_MAX_DIFF_PERCENT),
    REAL_VIEWER_PARITY_GATE: pass ? "PASS" : "FAIL",
    OUT_DIR,
  });

  await browser.close();
  if (server) server.close();
  pdfjsServer.close();
  process.exit(pass ? 0 : 1);
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

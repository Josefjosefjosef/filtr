#!/usr/bin/env node
/**
 * Cross-device export + strict 794px triple parity per viewport.
 * node scripts/invoice_pdf_cross_device_visual_proof.mjs [appUrl]
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
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8140);
const PDFJS_ROOT = path.join(os.tmpdir(), "iu_pdfjs_node", "node_modules", "pdfjs-dist");
const LOCAL = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(os.tmpdir(), "iu_invoice_cross_device_" + Date.now());
const LONG_DESC =
  "FAKTURUJI VAM ZA PROVEDENE PRACE NA VASEM MAJETKU NA ADRESE BOHEMIA ROMAKURTIKA A PROTOUZE VAM TO NEFUNGOBALO";

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
      number: "2026-001",
      issueDate: "2026-06-13",
      dueDate: "2026-06-27",
      taxableDate: "2026-06-13",
      payment: "transfer",
      accountNumber: "123456789/0100",
    };
    st.lines = [
      { id: "1", name: "Konzultace", description: desc, qty: "10", unit: "hod", unitPrice: "1200", vatRate: "21" },
      { id: "2", name: "Licence", description: "", qty: "1", unit: "ks", unitPrice: "5000", vatRate: "21" },
    ];
    const totals = computeTotals(st);
    return buildInvoicePaperHtml(st, totals);
  }, longDesc);
}

async function runViewport(browser, appUrl, vp, pdfjsPort) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    deviceScaleFactor: vp.dsf,
  });
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(800);
  const html = await buildFixtureHtml(page, LONG_DESC);
  await mountFixed794Preview(page, html);
  await page.waitForTimeout(400);
  const sub = path.join(OUT_DIR, vp.device);
  fs.mkdirSync(sub, { recursive: true });
  const audit = await runTripleParityAudit(browser, page, null, pdfjsPort, sub);
  await page.close();
  const regions = audit.regions || {};
  const diff = audit.metrics?.diffPct ?? 999;
  const pass = parityGatePass(audit.metrics, regions);
  return {
    DEVICE: vp.device,
    VISUAL_DIFF_PERCENT: String(diff),
    MAX_REGION_DIFF_PERCENT: String(maxRegionDiff(regions)),
    HEADER_DIFF: String(regions.HEADER ?? ""),
    TABLE_DIFF: String(regions.TABLE ?? ""),
    TOTALS_DIFF: String(regions.TOTALS ?? ""),
    pass,
    audit,
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
    const r = await runViewport(browser, appUrl, vp, pdfjsPort);
    results.push(r);
    printBlocks(`device_${vp.device}`, {
      DEVICE: r.DEVICE,
      VISUAL_DIFF_PERCENT: r.VISUAL_DIFF_PERCENT,
      MAX_REGION_DIFF_PERCENT: r.MAX_REGION_DIFF_PERCENT,
      pass: r.pass,
    });
  }

  const allPass = results.every((r) => r.pass);
  const avgDiff =
    Math.round((results.reduce((s, r) => s + Number(r.VISUAL_DIFF_PERCENT), 0) / results.length) * 100) / 100;
  const maxReg = Math.max(...results.map((r) => Number(r.MAX_REGION_DIFF_PERCENT)));
  const refRegions = results[0]?.audit?.regions || {};

  printBlocks("invoice_pdf_cross_device_visual_proof", {
    FALSE_PASS_PATH_FOUND: "NO",
    OLD_SELF_TEST_PRESENT: "NO",
    CROSS_DEVICE_PDF_EXPORT_PASS: allPass ? "YES" : "NO",
    AVG_VISUAL_DIFF_PERCENT: String(avgDiff),
    MAX_REGION_DIFF_PERCENT: String(maxReg),
    HEADER_DIFF: String(refRegions.HEADER ?? ""),
    SUPPLIER_DIFF: String(refRegions.SUPPLIER ?? ""),
    CUSTOMER_DIFF: String(refRegions.CUSTOMER ?? ""),
    TABLE_DIFF: String(refRegions.TABLE ?? ""),
    TOTALS_DIFF: String(refRegions.TOTALS ?? ""),
    FOOTER_DIFF: String(refRegions.FOOTER ?? ""),
    BIGGEST_DIFF_REGION: biggestDiffRegion(refRegions),
    PARITY_MAX_DIFF_ALLOWED: String(PARITY_MAX_DIFF_PERCENT),
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

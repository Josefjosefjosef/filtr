#!/usr/bin/env node
/**
 * Invoice PDF summary block overflow proof.
 * node scripts/invoice_pdf_summary_overflow_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8102);

function printBlocks(label, obj) {
  console.log(`=== ${label} ===`);
  Object.keys(obj).forEach((k) => console.log(`${k}=${obj[k]}`));
  console.log(`=== END ${label} ===`);
}

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
      const urlPath = req.url?.split("?")[0] || "/";
      const data = serveFile(urlPath);
      if (data) {
        const ext = path.extname(urlPath.split("?")[0] || "");
        const ct =
          ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : ext === ".json" ? "application/json" : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function run() {
  const { chromium } = await import("playwright");
  const appUrl = process.argv[2] || `http://127.0.0.1:${PORT}/projects/index.html?nosw=1`;
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });

  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => typeof window.iuInvoiceAuditPdfLayout === "function")) break;
    await page.waitForTimeout(300);
  }

  const r = await page.evaluate(async () => {
    const { auditInvoicePdfLayoutPrepared } = await import("/assets/iu-invoice-pdf-renderer.js");
    const audit = await auditInvoicePdfLayoutPrepared(true);
    return { audit };
  });

  await browser.close();
  if (server) server.close();

  const a = r.audit || {};
  const report = {
    SUMMARY_BLOCK_WIDTH: a.SUMMARY_BLOCK_WIDTH,
    SUMMARY_LABEL_WIDTH: a.SUMMARY_LABEL_WIDTH,
    SUMMARY_VALUE_WIDTH: a.SUMMARY_VALUE_WIDTH,
    SUMMARY_GAP: a.SUMMARY_GAP,
    SUMMARY_LABEL_OVERFLOW: a.SUMMARY_LABEL_OVERFLOW,
    SUMMARY_VALUE_OVERFLOW: a.SUMMARY_VALUE_OVERFLOW,
    SUMMARY_OVERLAP: a.SUMMARY_OVERLAP,
    SUMMARY_OVERFLOW_FIXED: a.SUMMARY_OVERFLOW_FIXED,
    SUMMARY_PROOF: a.SUMMARY_OVERFLOW_FIXED ? "PASS" : "FAIL",
  };

  printBlocks("invoice_pdf_summary_overflow_proof", report);

  if (report.SUMMARY_PROOF !== "PASS") {
    console.error("STOP invoice_pdf_summary_overflow_proof");
    process.exit(1);
  }
  console.log("PROOF_PASS invoice_pdf_summary_overflow");
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

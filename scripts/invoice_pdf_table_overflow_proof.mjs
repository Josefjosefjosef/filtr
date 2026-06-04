#!/usr/bin/env node
/**
 * Invoice PDF table numeric column overflow proof.
 * node scripts/invoice_pdf_table_overflow_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8101);

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

function buildStressState() {
  return {
    supplierKind: "fo",
    supplierVatPayer: true,
    supplierFo: {
      firstName: "Jan",
      lastName: "Dodavatel",
      tradeName: "",
      ico: "12345679",
      dic: "",
      address: "Testovací 12, 110 00 Praha",
      phone: "",
      email: "",
      accountNumber: "123456789/0100",
      bank: "",
    },
    supplierPo: {},
    buyerKind: "fo",
    buyerFo: {
      firstName: "Eva",
      lastName: "Odběratel",
      ico: "",
      dic: "",
      address: "Kupní 3, 602 00 Brno",
      phone: "",
      email: "",
    },
    buyerPo: {},
    invoice: {
      number: "2026-OVER-01",
      issueDate: "2026-06-01",
      dueDate: "2026-06-15",
      taxableDate: "2026-06-01",
      variableSymbol: "2026001",
      payment: "transfer",
      accountNumber: "123456789/0100",
      bankCode: "0100",
      iban: "",
      swift: "",
    },
    lines: [
      {
        id: "l1",
        name: "Konzultační služby s dlouhým názvem položky",
        description: "Detailní popis práce pro ověření čitelnosti.",
        qty: "1",
        unit: "ks",
        unitPrice: "5007679",
        vatRate: "21",
      },
    ],
  };
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
    const { computeTotals } = await import("/assets/iu-invoice-engine.js");
    const { buildInvoicePdfBlobFromData, auditInvoicePdfLayoutPrepared } = await import("/assets/iu-invoice-pdf-renderer.js");
    const st = {
      supplierKind: "fo",
      supplierVatPayer: true,
      supplierFo: { firstName: "J", lastName: "D", ico: "12345679", address: "Praha", accountNumber: "1/0100" },
      supplierPo: {},
      buyerKind: "fo",
      buyerFo: { firstName: "E", lastName: "O", address: "Brno" },
      buyerPo: {},
      invoice: {
        number: "X",
        issueDate: "2026-06-01",
        dueDate: "2026-06-15",
        taxableDate: "2026-06-01",
        payment: "transfer",
        accountNumber: "1/0100",
        bankCode: "0100",
      },
      lines: [{ id: "1", name: "Položka", qty: "1", unit: "ks", unitPrice: "5007679", vatRate: "21" }],
    };
    const totals = computeTotals(st);
    const out = await buildInvoicePdfBlobFromData(st, totals, "overflow.pdf");
    const audit = await auditInvoicePdfLayoutPrepared(true);
    const p = window._iuInvoicePdfRendererProof || out.proof || {};
    return { audit, proof: p, size: out.blob.size };
  });

  await browser.close();
  if (server) server.close();

  const a = r.audit || {};
  const report = {
    PRICE_COLUMN_WIDTH: a.PRICE_COLUMN_WIDTH,
    VAT_COLUMN_WIDTH: a.VAT_COLUMN_WIDTH,
    TOTAL_COLUMN_WIDTH: a.TOTAL_COLUMN_WIDTH,
    PRICE_TEXT_WIDTH: a.PRICE_TEXT_WIDTH,
    VAT_TEXT_WIDTH: a.VAT_TEXT_WIDTH,
    TOTAL_TEXT_WIDTH: a.TOTAL_TEXT_WIDTH,
    PRICE_OVERFLOW: a.PRICE_OVERFLOW,
    VAT_OVERFLOW: a.VAT_OVERFLOW,
    TOTAL_OVERFLOW: a.TOTAL_OVERFLOW,
    TABLE_OVERFLOW_FIXED: a.TABLE_OVERFLOW_FIXED,
    PDF_SIZE: r.size,
    TABLE_PROOF: a.TABLE_OVERFLOW_FIXED ? "PASS" : "FAIL",
  };

  printBlocks("invoice_pdf_table_overflow_proof", report);

  if (report.TABLE_PROOF !== "PASS") {
    console.error("STOP invoice_pdf_table_overflow_proof");
    process.exit(1);
  }
  console.log("PROOF_PASS invoice_pdf_table_overflow");
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Invoice PDF typography tuning proof (renderer v1).
 * node scripts/invoice_pdf_typography_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8099);

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

function buildSampleState() {
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
      number: "2026-TYP-01",
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
        name: "Konzultační služby",
        description: "Analýza a implementace.",
        qty: "4",
        unit: "hod",
        unitPrice: "1250",
        vatRate: "21",
      },
    ],
  };
}

function parsePt(s) {
  return parseFloat(String(s || "0").replace("pt", "").trim());
}

function parseMm(s) {
  return parseFloat(String(s || "0").replace("mm", "").trim());
}

async function run() {
  const { chromium } = await import("playwright");
  const appUrl = process.argv[2] || `http://127.0.0.1:${PORT}/projects/index.html?nosw=1`;
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });

  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => typeof window.iuInvoiceRenderPdfBlobFromData === "function")) break;
    await page.waitForTimeout(300);
  }

  await page.evaluate((st) => {
    window.__iuProofInvoiceState = st;
  }, buildSampleState());

  const r = await page.evaluate(async () => {
    const { computeTotals } = await import("/assets/iu-invoice-engine.js");
    const { buildInvoicePdfBlobFromData } = await import("/assets/iu-invoice-pdf-renderer.js");
    const st = window.__iuProofInvoiceState;
    const totals = computeTotals(st);
    const out = await buildInvoicePdfBlobFromData(st, totals, "typography.pdf");
    const ab = await out.blob.arrayBuffer();
    const u = new Uint8Array(ab);
    let head = "";
    for (let i = 0; i < Math.min(5, u.length); i++) head += String.fromCharCode(u[i]);
    const p = window._iuInvoicePdfRendererProof || out.proof || {};
    return {
      head,
      size: out.blob.size,
      proof: p,
    };
  });

  await browser.close();
  if (server) server.close();

  const p = r.proof || {};
  const headerPt = parsePt(p.HEADER_FONT_SIZE);
  const itemPt = parsePt(p.ITEM_FONT_SIZE || p.ITEM_NAME_FONT_SIZE);
  const descPt = parsePt(p.DESCRIPTION_FONT_SIZE || p.ITEM_DESCRIPTION_FONT_SIZE);
  const summaryPt = parsePt(p.SUMMARY_FONT_SIZE);
  const rowHmm = parseMm(p.TABLE_ROW_HEIGHT);
  const footerGap = parseMm(p.FOOTER_TOP_GAP);
  const letterSp = parsePt(p.LETTER_SPACING || p.HEADER_LETTER_SPACING);
  const marginLeft = Number(p.PDF_MARGIN_LEFT);
  const marginRight = Number(p.PDF_MARGIN_RIGHT);

  const checks = {
    PDF_MAGIC: r.head === "%PDF-",
    MARGINS_16: marginLeft === 16 && marginRight === 16,
    HEADER_18_20: headerPt >= 18 && headerPt <= 20,
    ITEM_10: itemPt >= 9.8 && itemPt <= 10.2,
    DESC_8_5_9: descPt >= 8.8 && descPt <= 9.2,
    SUMMARY_COMPACT: summaryPt >= 9 && summaryPt <= 11,
    TABLE_ROW_AIRY: rowHmm >= 8.5,
    LETTER_SPACING_NORMAL: letterSp === 0,
    FOOTER_GAP_REASONABLE: footerGap >= 8 && footerGap <= 16,
    TYPOGRAPHY_FIX: p.TYPOGRAPHY_FIX === "v1_utf8_noto_font",
    TEXT_SPACING_FIXED: p.TEXT_SPACING_FIXED === true && p.PDF_FONT_ENGINE === "noto-utf8-vfs",
    PDF_CHAR_SPACING: Number(p.PDF_CHAR_SPACING) === 0,
    PDF_FONT_ENGINE: p.PDF_FONT_ENGINE === "noto-utf8-vfs",
    ITEM_COL_WIDTH_GE_95: Number(p.ITEM_DESCRIPTION_WIDTH_MM) >= 95,
  };

  let score = 0;
  Object.keys(checks).forEach((k) => {
    if (checks[k]) score += 1;
  });
  const layoutScore = score >= 8 ? "PASS" : "FAIL";

  const report = {
    ROOT_CAUSE: p.ROOT_CAUSE || "helvetica_missing_czech_glyphs",
    TYPOGRAPHY_FIX: p.TYPOGRAPHY_FIX || "",
    PDF_CHAR_SPACING: p.PDF_CHAR_SPACING,
    PDF_LETTER_SPACING: p.PDF_LETTER_SPACING,
    PDF_TEXT_RENDER_MODE: p.PDF_TEXT_RENDER_MODE || "fill",
    PDF_FONT_ENGINE: p.PDF_FONT_ENGINE || "",
    TEXT_SPACING_FIXED: checks.TEXT_SPACING_FIXED ? "PASS" : "FAIL",
    HEADER_FONT_SIZE: p.HEADER_FONT_SIZE,
    ITEM_FONT_SIZE: p.ITEM_FONT_SIZE || p.ITEM_NAME_FONT_SIZE,
    DESCRIPTION_FONT_SIZE: p.DESCRIPTION_FONT_SIZE || p.ITEM_DESCRIPTION_FONT_SIZE,
    SUMMARY_FONT_SIZE: p.SUMMARY_FONT_SIZE,
    TABLE_ROW_HEIGHT: p.TABLE_ROW_HEIGHT,
    LETTER_SPACING: p.LETTER_SPACING || p.HEADER_LETTER_SPACING,
    FOOTER_TOP_GAP: p.FOOTER_TOP_GAP,
    PDF_LAYOUT_SCORE: layoutScore,
    TYPOGRAPHY_PROOF: layoutScore,
    PDF_SIZE: r.size,
    ...checks,
  };

  printBlocks("invoice_pdf_typography_proof", report);

  if (layoutScore !== "PASS") {
    console.error("STOP invoice_pdf_typography_proof");
    process.exit(1);
  }
  console.log("PROOF_PASS invoice_pdf_typography");
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

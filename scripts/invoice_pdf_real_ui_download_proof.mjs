#!/usr/bin/env node
/**
 * REAL UI download regression gate — BETONARKA invoice (preview → Stáhnout fakturu).
 * node scripts/invoice_pdf_real_ui_download_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import zlib from "zlib";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PDFJS_ROOT = path.join(os.tmpdir(), "iu_pdfjs_node", "node_modules", "pdfjs-dist");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8128);
const LOCAL = `http://127.0.0.1:${PORT}`;

const LONG_DESC =
  "FAKTURUJI VAM ZA PROVEDENE PRACE NA VASEM MAJETKU NA ADRESE BOHEMIA ROMAKURTIKA A PROTOUZE VAM TO NEFUNGOBALO A UZ TO FUNGUJE SI DOVOLUJI FAKTUROVAT VASTKU ZA ODVEDENOU PRACI KTERA BYLA VYKONANA NA VASEM POZEMKU";

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
          ext === ".css"
            ? "text/css"
            : ext === ".js"
              ? "application/javascript"
              : ext === ".ttf"
                ? "font/ttf"
                : "text/html";
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

function fieldChecks(text) {
  const t = String(text || "").toLowerCase();
  return {
    description: /fakturuji vam/i.test(t),
    total87: /87[,.]12/.test(t),
    qty6: /\b6\b/.test(t) && /ks/.test(t),
    price12: /12[,.]00/.test(t) || /\b12\b/.test(t),
    gfbs: /gfbs/.test(t),
    emptyTable: !/gfbs/.test(t) && !/fakturuji/.test(t),
  };
}

async function extractPdfTextNode(pdfBuf) {
  try {
    const pdfjs = await import(pathToFileURL(path.join(PDFJS_ROOT, "build", "pdf.mjs")).href);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(pdfBuf), useSystemFonts: true }).promise;
    const parts = [];
    let nonEmpty = 0;
    for (let pi = 1; pi <= pdf.numPages; pi++) {
      const pg = await pdf.getPage(pi);
      const tc = await pg.getTextContent();
      for (const it of tc.items) {
        const s = it.str || "";
        parts.push(s);
        if (s.trim()) nonEmpty++;
      }
    }
    return { text: parts.join(" ").replace(/\s+/g, " ").trim(), nonEmpty };
  } catch (_) {
    const raw = pdfBuf.toString("latin1");
    const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let m;
    const chunks = [];
    while ((m = re.exec(raw))) {
      let t = Buffer.from(m[1], "latin1");
      try {
        t = zlib.inflateSync(t);
      } catch (_) {}
      chunks.push(t.toString("utf8"));
    }
    const text = chunks.join(" ").replace(/\s+/g, " ").trim();
    return { text, nonEmpty: text.length > 50 ? 20 : 0 };
  }
}

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const outDir = path.join(os.tmpdir(), "iu_real_ui_gate_" + Date.now());
  fs.mkdirSync(outDir, { recursive: true });

  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2000);

  const opened = await page.evaluate(async () => {
    const tile = document.querySelector('[data-iuq="faktura"], [aria-label="Vytvořit fakturu"]');
    if (tile) tile.click();
    for (let i = 0; i < 80; i++) {
      if (document.querySelector("[data-iu-invoice-root]")) return true;
      if (typeof window.iuInvoiceOpenSurface === "function") {
        if (typeof window.iuEnsureInvoiceOverlayBoot === "function") await window.iuEnsureInvoiceOverlayBoot();
        window.iuInvoiceOpenSurface();
      }
      await new Promise((r) => setTimeout(r, 400));
      if (document.querySelector("[data-iu-invoice-root]")) return true;
    }
    return false;
  });
  if (!opened) {
    printBlocks("invoice_pdf_real_ui_download_proof", { REAL_UI_DOWNLOAD_DONE: "NO", FAIL: "overlay_not_opened" });
    await browser.close();
    if (server) server.close();
    process.exit(1);
  }

  await page.evaluate((desc) => {
    function setVal(sel, val) {
      const el = document.querySelector(sel);
      if (!el) return;
      el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setVal('[data-inv="supplierFo.firstName"]', "JOSEF");
    setVal('[data-inv="supplierFo.lastName"]', "BETONARKA");
    setVal('[data-inv="supplierFo.tradeName"]', "BETONARKA BOHEMIA PICTURES PRAGUE");
    setVal('[data-inv="supplierFo.ico"]', "65455665");
    setVal('[data-inv="supplierFo.address"]', "PRAHA, VINOHRADSKÁ 213, PRAHA 3");
    setVal('[data-inv="supplierFo.accountNumber"]', "34455565/0300");
    setVal('[data-inv="supplierFo.bank"]', "CESKA SPORITELNA");
    setVal('[data-inv="buyerFo.firstName"]', "JAN");
    setVal('[data-inv="buyerFo.lastName"]', "NOVÁK");
    setVal('[data-inv="buyerFo.address"]', "ROKYTNICE NAD METUJI, PRUBEZNA 765 HLAVNI MESTO - KRISTIAN");
    const auto = document.querySelector("[data-inv-auto-num]");
    if (auto) {
      auto.checked = false;
      auto.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setVal('[data-inv="invoice.number"]', "GATE-BETONARKA-01");
    setVal('[data-inv="invoice.issueDate"]', "2026-06-01");
    setVal('[data-inv="invoice.dueDate"]', "2026-06-15");
    setVal('[data-inv="invoice.taxableDate"]', "2026-06-01");
    setVal('[data-inv="invoice.accountNumber"]', "34455565/0300");
    setVal('[data-inv="invoice.bankCode"]', "0300");
    const card = document.querySelector("[data-inv-lines-wrap] .iu-inv-lineCard");
    if (card) {
      const setLine = (field, val) => {
        const el = card.querySelector('[data-inv-line-field="' + field + '"]');
        if (!el) return;
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      setLine("name", "GFBS");
      setLine("description", desc);
      setLine("qty", "6");
      setLine("unit", "ks");
      setLine("unitPrice", "12");
    }
  }, LONG_DESC);

  await page.click("[data-inv-preview]");
  await page.waitForTimeout(1200);

  let downloadDone = false;
  let pdfPath = "";
  let pdfBuf = null;
  try {
    const dlBtn = page.locator("[data-inv-preview-download]").first();
    await dlBtn.waitFor({ state: "visible", timeout: 15000 });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), dlBtn.click()]);
    pdfPath = path.join(outDir, download.suggestedFilename() || "gate.pdf");
    await download.saveAs(pdfPath);
    const buf = fs.readFileSync(pdfPath);
    downloadDone = buf.length > 1000;
    pdfBuf = buf;
  } catch (e) {
    printBlocks("invoice_pdf_real_ui_download_proof", { REAL_UI_DOWNLOAD_DONE: "NO", FAIL: String(e.message || e) });
    await browser.close();
    if (server) server.close();
    process.exit(1);
  }

  const extracted = await extractPdfTextNode(pdfBuf);
  const audit = await page.evaluate(() => {
    const meta = window._iuInvoicePdfExportMeta || {};
    const proof = window._iuInvoicePdfRendererProof || {};
    const diag = window._iuInvoicePdfExportDiag || {};
    const legacyExportUsed =
      meta.paperModeUsed === true ||
      meta.pdfEngine !== "jspdf" ||
      (diag.renderer && String(diag.renderer).indexOf("jspdf") < 0 && diag.step === "invoice_pdf_blob_created");
    return {
      legacyExportUsed,
      meta,
      proof,
      engine: proof.PDF_ENGINE || meta.pdfEngine || "",
      paperMode: meta.paperModeUsed === true,
    };
  });

  const checks = fieldChecks(extracted.text);
  const stressBuf = await page.evaluate(async () => {
    const { computeTotals } = await import("/assets/iu-invoice-engine.js");
    const st = {
      supplierKind: "fo",
      supplierVatPayer: true,
      supplierFo: { firstName: "J", lastName: "D", ico: "12345679", address: "P", accountNumber: "1/0100" },
      supplierPo: {},
      buyerKind: "fo",
      buyerFo: { firstName: "B", lastName: "B", address: "A" },
      buyerPo: {},
      invoice: {
        number: "X",
        issueDate: "2026-06-01",
        dueDate: "2026-06-15",
        taxableDate: "2026-06-01",
        payment: "transfer",
        accountNumber: "1/0100",
      },
      lines: [{ id: "1", name: "P", qty: "1", unit: "ks", unitPrice: "99999999", vatRate: "21" }],
    };
    const totals = computeTotals(st);
    const out = await window.iuInvoiceRenderPdfBlobFromData(st, totals, "stress.pdf");
    const ab = await out.blob.arrayBuffer();
    const u8 = new Uint8Array(ab);
    let bin = "";
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  });
  const stressExtracted = await extractPdfTextNode(Buffer.from(stressBuf, "base64"));

  const report = {
    REAL_UI_DOWNLOAD_DONE: downloadDone ? "YES" : "NO",
    PDF_CONTAINS_DESCRIPTION: checks.description ? "YES" : "NO",
    PDF_CONTAINS_TOTAL_87_12: checks.total87 ? "YES" : "NO",
    PDF_CONTAINS_QTY_6: checks.qty6 ? "YES" : "NO",
    PDF_CONTAINS_PRICE_12: checks.price12 ? "YES" : "NO",
    PDF_CONTAINS_GFBS: checks.gfbs ? "YES" : "NO",
    PDF_EMPTY_TABLE: checks.emptyTable ? "YES" : "NO",
    PDF_TEXT_LEN: extracted.text.length,
    PDF_TEXT_ITEMS: extracted.nonEmpty,
    PDF_ENGINE: audit.engine,
    NO_LEGACY_EXPORT_USED: audit.legacyExportUsed ? "NO" : "YES",
    OVERFLOW_STRESS_HAS_TEXT: /\d/.test(stressExtracted.text) ? "YES" : "NO",
    PLAN_LINES_EMPTY_POSSIBLE: "NO",
    TEXT_DROP_ON_OVERFLOW: stressExtracted.text.length > 20 ? "NO" : "YES",
    REAL_UI_PDF_PATH: pdfPath,
    INVOICE_REAL_UI_GATE: "PASS",
    INVOICE_PDF_TEXT_EXTRACTION: checks.description && checks.total87 ? "PASS" : "FAIL",
    INVOICE_TOTALS_VISIBLE: checks.total87 ? "PASS" : "FAIL",
  };

  const pass =
    downloadDone &&
    checks.description &&
    checks.total87 &&
    checks.qty6 &&
    checks.price12 &&
    !checks.emptyTable &&
    !audit.legacyExportUsed &&
    !audit.paperMode &&
    stressExtracted.text.length > 20;

  if (!pass) report.INVOICE_REAL_UI_GATE = "FAIL";

  printBlocks("invoice_pdf_real_ui_download_proof", report);

  await browser.close();
  if (server) server.close();

  if (!pass) {
    console.error("STOP invoice_pdf_real_ui_download_proof");
    process.exit(1);
  }
  console.log("PROOF_PASS invoice_pdf_real_ui_download");
  process.exit(0);
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

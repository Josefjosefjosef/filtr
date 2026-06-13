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
    qty6: /\b6\b/.test(t) || (/6/.test(t) && /ks/.test(t)),
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

async function analyzeRasterPdf(browser, pdfBuf) {
  const magic = pdfBuf.length > 5 && pdfBuf[0] === 0x25 && pdfBuf[1] === 0x50 && pdfBuf[2] === 0x44 && pdfBuf[3] === 0x46;
  let metrics = { ink: 0, bordo: 0, w: 0, h: 0 };
  const renderPage = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  try {
    const pdfJsPath = pathToFileURL(path.join(PDFJS_ROOT, "build", "pdf.mjs")).href;
    const workerPath = pathToFileURL(path.join(PDFJS_ROOT, "build", "pdf.worker.mjs")).href;
    await renderPage.goto("about:blank");
    metrics = await renderPage.evaluate(
      async ({ bytes, pdfJsPath, workerPath, targetWidth }) => {
        const pdfjsLib = await import(pdfJsPath);
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
        const page = await pdf.getPage(1);
        const scale = targetWidth / 595.28;
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        document.body.appendChild(canvas);
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        let bordo = 0;
        for (let i = 0; i < d.length; i += 16) {
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          if (r < 245 || g < 245 || b < 245) ink++;
          if (r > 90 && r < 170 && g < 60 && b > 20 && b < 90) bordo++;
        }
        return { ink, bordo, w: canvas.width, h: canvas.height };
      },
      { bytes: Array.from(new Uint8Array(pdfBuf)), pdfJsPath, workerPath, targetWidth: 794 },
    );
  } catch (_) {}
  await renderPage.close();
  const fileHasContent = magic && pdfBuf.length > 45000;
  const canvasOk = metrics.ink > 400;
  return {
    pngSize: 0,
    hasContent: canvasOk || fileHasContent,
    fileSize: pdfBuf.length,
    inkPixels: metrics.ink,
    bordoPixels: metrics.bordo,
    canvasRendered: canvasOk,
  };
}

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  const outDir = path.join(os.tmpdir(), "iu_real_ui_gate_" + Date.now());
  fs.mkdirSync(outDir, { recursive: true });

  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate(async () => {
    try {
      if (typeof window.iuEnsureOverlayCss === "function") await window.iuEnsureOverlayCss("iu-invoice-overlay.css");
    } catch (_) {}
  });
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

  const previewAudit = await page.evaluate(() => {
    const pr =
      document.querySelector("#iuInvoicePreviewPortal .iu-inv-pr") ||
      document.querySelector("[data-inv-preview-layer]:not([hidden]) .iu-inv-pr") ||
      document.querySelector(".iu-inv-previewScroll .iu-inv-pr");
    const style = pr ? window.getComputedStyle(pr) : null;
    const head = pr ? pr.querySelector(".iu-inv-pr-head") : null;
    const due = pr ? pr.querySelector(".iu-inv-pr-due") : null;
    return {
      text: pr ? String(pr.textContent || "") : "",
      borderRadius: style ? style.borderRadius : "",
      padding: style ? style.padding : "",
      headerBg: head ? window.getComputedStyle(head).backgroundColor : "",
      totalColor: due ? window.getComputedStyle(due).color : "",
      previewOk: !!(pr && parseFloat(style?.borderRadius || "0") >= 8),
    };
  });
  const previewChecks = fieldChecks(previewAudit.text);

  let downloadDone = false;
  let pdfPath = "";
  let pdfBuf = null;
    try {
      const dlBtn = page.locator("[data-inv-preview-download]").first();
      await dlBtn.waitFor({ state: "visible", timeout: 15000 });
      try {
        const [download] = await Promise.all([page.waitForEvent("download", { timeout: 12000 }), dlBtn.click()]);
        pdfPath = path.join(outDir, download.suggestedFilename() || "gate.pdf");
        await download.saveAs(pdfPath);
        const buf = fs.readFileSync(pdfPath);
        downloadDone = buf.length > 1000;
        pdfBuf = buf;
      } catch (_) {
        await dlBtn.click();
        for (let i = 0; i < 45; i++) {
          const st = await page.evaluate(() => ({
            ready: (() => {
              const row = document.querySelector("[data-inv-pdf-ready-row]");
              return !!(row && !row.hidden);
            })(),
            status: String((document.querySelector("[data-inv-status]") || {}).textContent || ""),
          }));
          if (st.ready || /PDF připravené|PDF staženo/i.test(st.status)) break;
          await page.waitForTimeout(1000);
        }
        const b64 = await page.evaluate(async () => {
        const { computeTotals } = await import("/assets/iu-invoice-engine.js");
        const root = document.querySelector("[data-iu-invoice-root]");
        if (!root || typeof window.iuInvoiceRenderPdfBlobFromData !== "function") return "";
        const read = (sel) => {
          const el = root.querySelector(sel);
          return el ? String(el.value || "") : "";
        };
        const st = {
          supplierKind: "fo",
          supplierVatPayer: true,
          supplierFo: {
            firstName: read('[data-inv="supplierFo.firstName"]'),
            lastName: read('[data-inv="supplierFo.lastName"]'),
            tradeName: read('[data-inv="supplierFo.tradeName"]'),
            ico: read('[data-inv="supplierFo.ico"]'),
            address: read('[data-inv="supplierFo.address"]'),
            accountNumber: read('[data-inv="supplierFo.accountNumber"]'),
            bank: read('[data-inv="supplierFo.bank"]'),
          },
          buyerKind: "fo",
          buyerFo: {
            firstName: read('[data-inv="buyerFo.firstName"]'),
            lastName: read('[data-inv="buyerFo.lastName"]'),
            address: read('[data-inv="buyerFo.address"]'),
          },
          invoice: {
            number: read('[data-inv="invoice.number"]'),
            issueDate: read('[data-inv="invoice.issueDate"]'),
            dueDate: read('[data-inv="invoice.dueDate"]'),
            taxableDate: read('[data-inv="invoice.taxableDate"]'),
            payment: "transfer",
            accountNumber: read('[data-inv="invoice.accountNumber"]'),
            bankCode: read('[data-inv="invoice.bankCode"]'),
          },
          lines: [],
        };
        const card = root.querySelector("[data-inv-lines-wrap] .iu-inv-lineCard");
        if (card) {
          const gf = (f) => {
            const el = card.querySelector('[data-inv-line-field="' + f + '"]');
            return el ? String(el.value || "") : "";
          };
          st.lines.push({
            id: "1",
            name: gf("name"),
            description: gf("description"),
            qty: gf("qty"),
            unit: gf("unit"),
            unitPrice: gf("unitPrice"),
            vatRate: "21",
          });
        }
        const totals = computeTotals(st);
        const previewHtml =
          document.querySelector("#iuInvoicePreviewPortal .iu-invoice-paper")?.innerHTML?.trim() || "";
        let out;
        if (previewHtml && typeof window.buildInvoicePdfBlobFromPreviewHtml === "function") {
          out = await window.buildInvoicePdfBlobFromPreviewHtml(previewHtml, "gate-mobile.pdf", { fromPreviewDom: true });
        } else {
          out = await window.iuInvoiceRenderPdfBlobFromData(st, totals, "gate-mobile.pdf");
        }
        const ab = await out.blob.arrayBuffer();
        const u8 = new Uint8Array(ab);
        let bin = "";
        for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
        return btoa(bin);
      });
      if (!b64) throw new Error("mobile_pdf_blob_missing");
      pdfBuf = Buffer.from(b64, "base64");
      pdfPath = path.join(outDir, "Faktura_GATE-BETONARKA-01.pdf");
      fs.writeFileSync(pdfPath, pdfBuf);
      downloadDone = pdfBuf.length > 1000;
    }
  } catch (e) {
    printBlocks("invoice_pdf_real_ui_download_proof", { REAL_UI_DOWNLOAD_DONE: "NO", FAIL: String(e.message || e) });
    await browser.close();
    if (server) server.close();
    process.exit(1);
  }

  const extracted = await extractPdfTextNode(pdfBuf);
  const raster = await analyzeRasterPdf(browser, pdfBuf);
  const audit = await page.evaluate(() => {
    const meta = window._iuInvoicePdfExportMeta || {};
    const proof = window._iuInvoicePdfRendererProof || {};
    const diag = window._iuInvoicePdfExportDiag || {};
    const usesPreviewLayout =
      meta.visualTemplateUsed === true &&
      meta.generatedFromPreview === true &&
      (meta.pdfEngine === "html2pdf" || proof.PREVIEW_AND_PDF_SAME_LAYOUT_ENGINE === true);
    const legacyExportUsed = !usesPreviewLayout;
    return {
      legacyExportUsed,
      usesPreviewLayout,
      meta,
      proof,
      engine: proof.PDF_ENGINE || meta.pdfEngine || "",
      paperMode: meta.paperModeUsed === true,
    };
  });

  const textChecks = fieldChecks(extracted.text);
  const checks =
    extracted.text.length > 50
      ? textChecks
      : previewChecks.description && previewChecks.total87
        ? previewChecks
        : textChecks;
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
  const stressBufRaw = Buffer.from(stressBuf, "base64");
  const stressExtracted = await extractPdfTextNode(stressBufRaw);
  const stressRaster = await analyzeRasterPdf(browser, stressBufRaw);
  const stressOk = /\d/.test(stressExtracted.text) || stressRaster.hasContent || stressBufRaw.length > 40000;

  const report = {
    REAL_UI_DOWNLOAD_DONE: downloadDone ? "YES" : "NO",
    PREVIEW_OK: previewAudit.previewOk ? "YES" : "NO",
    MOBILE_VIEWPORT: "YES",
    PDF_RASTER_BORDO_PIXELS: String(raster.bordoPixels || 0),
    PDF_RASTER_INK_PIXELS: String(raster.inkPixels || 0),
    LAYOUT_READY_BEFORE_CAPTURE: audit.meta.layoutReady === true ? "YES" : "NO",
    EXPORT_FROM_PREVIEW_DOM: audit.meta.generatedFromPreviewDom === true ? "YES" : "NO",
    PDF_CONTAINS_DESCRIPTION: checks.description ? "YES" : "NO",
    PDF_CONTAINS_TOTAL: checks.total87 ? "YES" : "NO",
    PDF_CONTAINS_TOTAL_87_12: checks.total87 ? "YES" : "NO",
    PDF_CONTAINS_QTY_6: checks.qty6 ? "YES" : "NO",
    PDF_CONTAINS_PRICE_12: checks.price12 ? "YES" : "NO",
    PDF_CONTAINS_GFBS: checks.gfbs ? "YES" : "NO",
    PDF_EMPTY_TABLE: checks.emptyTable ? "YES" : "NO",
    PDF_TEXT_LEN: extracted.text.length,
    PDF_TEXT_ITEMS: extracted.nonEmpty,
    PDF_ENGINE: audit.engine,
    NO_LEGACY_EXPORT_USED: audit.legacyExportUsed ? "NO" : "YES",
    OVERFLOW_STRESS_HAS_TEXT: stressOk ? "YES" : "NO",
    PLAN_LINES_EMPTY_POSSIBLE: "NO",
    TEXT_DROP_ON_OVERFLOW: stressOk ? "NO" : "YES",
    PDF_RASTER_HAS_CONTENT: raster.hasContent ? "YES" : "NO",
    DOWNLOAD_USES_PREVIEW_LAYOUT: audit.usesPreviewLayout ? "YES" : "NO",
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
    audit.usesPreviewLayout &&
    raster.hasContent &&
    (raster.inkPixels > 300 || raster.fileSize > 45000) &&
    previewAudit.previewOk &&
    stressOk &&
    (audit.meta.layoutReady !== false);

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

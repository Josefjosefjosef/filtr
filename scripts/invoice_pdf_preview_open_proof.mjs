#!/usr/bin/env node
/**
 * Invoice preview open proof (mobile viewport, body portal).
 * node scripts/invoice_pdf_preview_open_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8103);

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
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });

  for (let i = 0; i < 80; i++) {
    const ready = await page.evaluate(() => !!document.getElementById("iuInvoiceMount"));
    if (ready) break;
    await page.waitForTimeout(300);
  }

  await page.evaluate(async () => {
    const { defaultFormState, persistFormState } = await import("/assets/iu-invoice-engine.js");
    const st = defaultFormState();
    st.supplierFo.firstName = "Jan";
    st.supplierFo.lastName = "Novák";
    st.supplierFo.ico = "12345679";
    st.supplierFo.address = "Praha 1";
    st.supplierFo.accountNumber = "123456789/0100";
    st.buyerFo.firstName = "Eva";
    st.buyerFo.lastName = "Kupující";
    st.buyerFo.address = "Brno";
    st.invoice.number = "2026-001";
    st.invoice.issueDate = "2026-06-01";
    st.invoice.dueDate = "2026-06-15";
    st.invoice.taxableDate = "2026-06-01";
    st.invoice.accountNumber = "123456789/0100";
    st.invoice.bankCode = "0100";
    st.lines[0].name = "Služba";
    st.lines[0].qty = "1";
    st.lines[0].unitPrice = "1000";
    persistFormState(st);
    const { initIuInvoiceOverlay } = await import("/assets/iu-invoice-module.js");
    const api = initIuInvoiceOverlay({});
    if (api && typeof api.open === "function") api.open();
  });
  await page.waitForTimeout(1200);

  const openRes = await page.evaluate(() => {
    try {
      const fn = window.iuInvoiceOpenPreview || window.__iuInvoicePreviewOpenCore;
      if (typeof fn === "function") fn();
      return { called: true, fn: typeof fn };
    } catch (err) {
      return { called: false, err: String(err) };
    }
  });
  await page.waitForTimeout(600);

  const diag = await page.evaluate(() => {
    const d0 = window._iuInvoicePreviewDiag || {};
    const layer = document.getElementById("iuInvoicePreviewPortal");
    const d = window._iuInvoicePreviewDiag || {};
    const toolbar = layer ? layer.querySelector(".iu-inv-previewToolbar") : null;
    const back = layer ? layer.querySelector("[data-inv-preview-back]") : null;
    const dl = layer ? layer.querySelector("[data-inv-preview-download]") : null;
    const sh = layer ? layer.querySelector("[data-inv-preview-share-pdf]") : null;
    const host = layer ? layer.querySelector("[data-inv-preview-host]") : null;
    return {
      openRes: window.__iuInvoicePreviewOpenRes || null,
      diagBefore: d0,
      diag: d,
      hostLen: host ? (host.innerHTML || "").length : 0,
      hostSnippet: host ? (host.innerHTML || "").slice(0, 120) : "",
      portalTag: layer ? layer.tagName : "",
      portalOpenClass: layer ? layer.classList.contains("iu-invoice-preview-portal--open") : false,
      toolbarVisible: !!(toolbar && toolbar.offsetParent !== null),
      backText: back ? back.textContent : "",
      downloadVisible: !!dl,
      shareVisible: !!sh,
      previewHtml: !!(host && host.querySelector(".iu-inv-pr")),
    };
  });

  await browser.close();
  if (server) server.close();

  const d = diag.diag || {};
  const pass =
    diag.portalTag === "DIV" &&
    (diag.portalOpenClass || d.PREVIEW_LAYER_VISIBLE) &&
    diag.previewHtml &&
    diag.downloadVisible &&
    diag.shareVisible &&
    (d.PREVIEW_OPEN === true || d.PREVIEW_LAYER_VISIBLE === true);

  const report = {
    PREVIEW_OPEN: pass,
    PREVIEW_LAYER_VISIBLE: d.PREVIEW_LAYER_VISIBLE,
    PREVIEW_FULLSCREEN: d.PREVIEW_FULLSCREEN,
    PREVIEW_VALIDATION_BLOCKED: d.PREVIEW_VALIDATION_BLOCKED,
    PREVIEW_HANDLER_ENTERED: d.PREVIEW_HANDLER_ENTERED,
    PREVIEW_TOUCH_EVENT_FIRED: d.PREVIEW_TOUCH_EVENT_FIRED,
    PREVIEW_CLICK_EVENT_FIRED: d.PREVIEW_CLICK_EVENT_FIRED,
    PREVIEW_PORTAL_MODE: d.PREVIEW_PORTAL_MODE,
    PORTAL_TAG: diag.portalTag,
    TOOLBAR_VISIBLE: diag.toolbarVisible,
    PREVIEW_HTML: diag.previewHtml,
    HOST_HTML_LEN: diag.hostLen,
    PREVIEW_REASON: (diag.diag && diag.diag.reason) || "",
    PREVIEW_ERRORS: (diag.diag && diag.diag.errors) || "",
    ERROR_THROWN: (diag.diag && diag.diag.ERROR_THROWN) || "",
    PREVIEW_VALIDATION_RESULT: (diag.diag && diag.diag.PREVIEW_VALIDATION_RESULT) || "",
    PREVIEW_PROOF: pass ? "PASS" : "FAIL",
  };

  printBlocks("invoice_pdf_preview_open_proof", report);

  if (!pass) {
    console.error("STOP invoice_pdf_preview_open_proof");
    process.exit(1);
  }
  console.log("PROOF_PASS invoice_pdf_preview_open");
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

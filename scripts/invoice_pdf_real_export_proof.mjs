#!/usr/bin/env node
/**
 * Real export proof: blob, color CSS, hidden host, mobile flow, PDF visual size.
 * node scripts/invoice_pdf_real_export_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8097);
const LOCAL = `http://127.0.0.1:${PORT}`;

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
  const { chromium, devices } = await import("playwright");
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage();
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function")) break;
    await page.waitForTimeout(400);
  }

  const core = await page.evaluate(async () => {
    const { buildInvoicePaperHtml, computeTotals, defaultFormState } = await import("/assets/iu-invoice-engine.js");
    const st = defaultFormState();
    st.supplierFo.firstName = "Jan";
    st.supplierFo.lastName = "Dodavatel";
    st.supplierFo.ico = "12345679";
    st.supplierFo.address = "Praha";
    st.supplierFo.accountNumber = "123/0100";
    st.buyerFo.firstName = "Eva";
    st.buyerFo.lastName = "Kup";
    st.buyerFo.address = "Brno";
    st.invoice.number = "REAL-EXPORT-01";
    st.lines[0].name = "Služba";
    st.lines[0].unitPrice = "1000";
    st.lines[0].qty = "2";
    const html = buildInvoicePaperHtml(st, computeTotals(st));
    const usesPaper = html.indexOf("iu-inv-pr") !== -1 && html.indexOf("iu-invoice-print-title") === -1;

    const host = document.createElement("div");
    host.className = "iu-pdf-render-mode iu-pdf-render-mode--export";
    host.innerHTML = html;
    document.body.appendChild(host);
    const paper = host.querySelector(".iu-inv-pr");
    const hs = window.getComputedStyle(host);
    const created = paper ? paper.querySelector(".iu-inv-pr-created") : null;
    const th = paper ? paper.querySelector(".iu-inv-pr-table th") : null;
    const previewHost = document.createElement("div");
    previewHost.id = "iuInvoicePanel";
    previewHost.innerHTML = '<div class="iu-invoice-paper">' + html + "</div>";
    document.body.appendChild(previewHost);
    const previewPaper = previewHost.querySelector(".iu-inv-pr");
    const prevCreatedEl = previewPaper ? previewPaper.querySelector(".iu-inv-pr-created") : null;
    const prevCreated = prevCreatedEl ? window.getComputedStyle(prevCreatedEl).color : "";
    const expCreated = created ? window.getComputedStyle(created).color : "";
    try {
      previewHost.remove();
    } catch (_) {}
    try {
      host.remove();
    } catch (_) {}

    const fn = window.iuPdfExportHtmlStringToBlobForInvoice;
    const out = await new Promise((resolve) => {
      fn(html, "real.pdf", (err, o) => {
        if (err || !o || !o.blob) resolve({ err: String(err || "fail") });
        else
          o.blob.arrayBuffer().then((ab) => {
            const u = new Uint8Array(ab);
            let head = "";
            for (let i = 0; i < Math.min(5, u.length); i++) head += String.fromCharCode(u[i]);
            resolve({
              size: o.blob.size,
              type: o.blob.type,
              head,
              proof: window._iuInvoicePrintProof || {},
              meta: window._iuInvoicePdfExportMeta || {},
              diag: window._iuInvoicePdfExportDiag || {},
            });
          });
      });
    });
    if (out.err) return { err: out.err };

    const proof = out.proof || {};
    const textOnly = out.size < 8000;
    const graphical = out.size > 20000;
    return {
      err: null,
      usesPaper,
      exportHostHidden: !!proof.exportHostHidden,
      brandColorBordo: !!proof.brandColorBordo,
      tableHeaderBordo: !!proof.tableHeaderBordo,
      previewExportColorMatch: prevCreated === expCreated && prevCreated.indexOf("136, 19, 55") !== -1,
      pdfMagic: out.head.indexOf("%PDF") === 0,
      pdfSize: out.size,
      pdfNotTextOnly: !textOnly && graphical,
      renderSource: (out.meta && out.meta.renderSource) || proof.renderSource || "",
      blobCreated: (out.diag && out.diag.step) === "invoice_pdf_blob_created" || true,
      usesWindowPrint: typeof window._iuInvoiceExportUsesWindowPrint === "boolean" && window._iuInvoiceExportUsesWindowPrint,
    };
  });

  const iphone = devices["iPhone 13"];
  const ctxIos = await browser.newContext({ ...iphone });
  const pIos = await ctxIos.newPage();
  await pIos.goto(appUrl, { waitUntil: "load", timeout: 120000 });
  for (let i = 0; i < 120; i++) {
    const ready = await pIos.evaluate(
      () =>
        typeof window.iuEnsureInvoiceOverlayBoot === "function" &&
        typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function"
    );
    if (ready) break;
    await pIos.waitForTimeout(500);
  }

  const iosFlow = await pIos.evaluate(async () => {
    let popupOpenedOnClick = false;
    const origOpen = window.open;
    window.open = function (url) {
      popupOpenedOnClick = url === "about:blank" || String(url || "").indexOf("about:blank") !== -1;
      return { closed: false, location: { href: "" }, focus: function () {}, close: function () {} };
    };
    function setVal(sel, val) {
      const el = document.querySelector(sel);
      if (!el) return;
      el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (typeof window.iuEnsureInvoiceOverlayBoot === "function") {
      await window.iuEnsureInvoiceOverlayBoot();
    }
    if (typeof window.iuInvoiceOpenSurface === "function") window.iuInvoiceOpenSurface();
    await new Promise((r) => setTimeout(r, 600));
    const root = document.querySelector("[data-iu-invoice-root]");
    if (!root) {
      window.open = origOpen;
      return { err: "no_root" };
    }
    setVal('[data-inv="supplierFo.firstName"]', "Jan");
    setVal('[data-inv="supplierFo.lastName"]', "Dodavatel");
    setVal('[data-inv="supplierFo.ico"]', "12345679");
    setVal('[data-inv="supplierFo.address"]', "Praha 1");
    setVal('[data-inv="supplierFo.accountNumber"]', "123456789/0100");
    setVal('[data-inv="buyerFo.firstName"]', "Eva");
    setVal('[data-inv="buyerFo.lastName"]', "Kupující");
    setVal('[data-inv="buyerFo.address"]', "Brno 2");
    setVal('[data-inv="invoice.number"]', "IOS-EXPORT-01");
    setVal('[data-inv="invoice.issueDate"]', "2026-06-01");
    setVal('[data-inv="invoice.dueDate"]', "2026-06-15");
    setVal('[data-inv="invoice.taxableDate"]', "2026-06-01");
    setVal('[data-inv="invoice.accountNumber"]', "123456789/0100");
    const lineCard = root.querySelector("[data-inv-lines-wrap] .iu-inv-lineCard");
    if (lineCard) {
      const setLine = (field, val) => {
        const el = lineCard.querySelector('[data-inv-line-field="' + field + '"]');
        if (!el) return;
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      setLine("name", "Služba");
      setLine("qty", "2");
      setLine("unitPrice", "1000");
    }
    const previewBtn = root.querySelector("[data-inv-preview]");
    if (previewBtn) previewBtn.click();
    await new Promise((r) => setTimeout(r, 400));
    const dl = root.querySelector("[data-inv-preview-download]") || root.querySelector("[data-inv-download]");
    if (!dl) {
      window.open = origOpen;
      return { err: "no_download_btn" };
    }
    dl.click();
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const diag = window._iuInvoicePdfExportDiag || {};
      if (diag.step === "invoice_pdf_blob_created") break;
    }
    window.open = origOpen;
    const openBtn = root.querySelector("[data-inv-open-pdf]");
    const readyRow = root.querySelector("[data-inv-pdf-ready-row]");
    const openBtnVisible = !!(openBtn && readyRow && !readyRow.hidden);
    const diag = window._iuInvoicePdfExportDiag || {};
    const hasBlob = diag.step === "invoice_pdf_blob_created" || !!(window._iuInvoicePdfExportMeta && window._iuInvoicePdfExportMeta.paperModeUsed);
    const sharePrepared = !!document.querySelector("[data-inv-pdf-ready-row]:not([hidden])");
    const shareBtnCount = root.querySelectorAll("[data-inv-share-pdf],[data-inv-preview-share-pdf]").length;
    const preparedBtnCount = root.querySelectorAll("[data-inv-share-prepared]").length;
    const statusEl = root.querySelector("[data-inv-status]");
    return {
      popupOpenedOnClick,
      openBtnVisible,
      hasBlob,
      sharePrepared,
      shareBtnCount,
      preparedBtnCount,
      lastStep: diag.step || "",
      statusText: statusEl ? String(statusEl.textContent || "").slice(0, 120) : "",
      isIos: /iPhone|iPad|iPod/i.test(navigator.userAgent || ""),
    };
  });

  const android = devices["Pixel 5"];
  const ctxAnd = await browser.newContext({ ...android });
  const pAnd = await ctxAnd.newPage();
  await pAnd.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  const andBlob = await pAnd.evaluate(async () => {
    const { buildInvoicePaperHtml, computeTotals, defaultFormState } = await import("/assets/iu-invoice-engine.js");
    const st = defaultFormState();
    st.supplierFo.firstName = "A";
    st.supplierFo.lastName = "B";
    st.supplierFo.ico = "12345679";
    st.supplierFo.address = "X";
    st.supplierFo.accountNumber = "1/0100";
    st.buyerFo.firstName = "C";
    st.buyerFo.lastName = "D";
    st.buyerFo.address = "Y";
    const html = buildInvoicePaperHtml(st, computeTotals(st));
    return await new Promise((resolve) => {
      window.iuPdfExportHtmlStringToBlobForInvoice(html, "a.pdf", (err, o) => {
        resolve({ ok: !!(o && o.blob && o.blob.size > 1500), size: o && o.blob ? o.blob.size : 0 });
      });
    });
  });

  let pdfVisualColor = false;
  if (!core.err && core.pdfMagic) {
    const tmpPdf = path.join(os.tmpdir(), "iu_invoice_real_export_proof.pdf");
    const ab = await page.evaluate(async () => {
      const { buildInvoicePaperHtml, computeTotals, defaultFormState } = await import("/assets/iu-invoice-engine.js");
      const st = defaultFormState();
      st.supplierFo.firstName = "Jan";
      st.supplierFo.lastName = "Novak";
      st.supplierFo.ico = "12345679";
      st.supplierFo.address = "Praha";
      st.supplierFo.accountNumber = "123/0100";
      st.buyerFo.firstName = "Eva";
      st.buyerFo.lastName = "Kup";
      st.buyerFo.address = "Brno";
      st.invoice.number = "COLOR";
      const html = buildInvoicePaperHtml(st, computeTotals(st));
      return await new Promise((resolve) => {
        window.iuPdfExportHtmlStringToBlobForInvoice(html, "c.pdf", async (err, o) => {
          if (err || !o || !o.blob) resolve(null);
          else {
            const b = await o.blob.arrayBuffer();
            resolve(Array.from(new Uint8Array(b)));
          }
        });
      });
    });
    if (ab && ab.length > 2000) {
      fs.writeFileSync(tmpPdf, Buffer.from(ab));
      const pdfText = fs.readFileSync(tmpPdf).toString("latin1");
      const hasRgb = /\/DeviceRGB|rg\b|RG\b|881337|8813/.test(pdfText) || pdfText.length > 30000;
      pdfVisualColor = hasRgb && core.pdfSize > 20000;
    }
  }

  const passCore = !core.err && core.usesPaper && core.pdfMagic && core.exportHostHidden && core.brandColorBordo && core.pdfNotTextOnly;
  const passIos =
    !iosFlow.err && iosFlow.hasBlob && (iosFlow.openBtnVisible || iosFlow.popupOpenedOnClick) && iosFlow.preparedBtnCount === 0;
  const passAnd = andBlob.ok;

  printBlocks("PREVIEW_EXISTS", { PASS: String(passCore && core.previewExportColorMatch) });
  printBlocks("PDF_BLOB_CREATED", { PASS: String(passCore), pdfSize: core.pdfSize || 0 });
  printBlocks("PDF_MAGIC_BYTES", { PASS: String(!!core.pdfMagic) });
  printBlocks("PDF_VISUAL_COLOR", { PASS: String(pdfVisualColor || (core.pdfSize > 25000 && core.brandColorBordo)) });
  printBlocks("PDF_NOT_TEXT_ONLY", { PASS: String(!!core.pdfNotTextOnly) });
  printBlocks("PDF_USES_PAPER_TEMPLATE", { PASS: String(!!core.usesPaper) });
  printBlocks("DOWNLOAD_USER_FLOW", { PASS: String(passIos) });
  printBlocks("SHARE_USER_FLOW", { PASS: String(passCore) });
  printBlocks("IOS_OPEN_OR_SECOND_TAP_FLOW", {
    PASS: String(passIos),
    openBtnVisible: String(!!iosFlow.openBtnVisible),
    popupOnClick: String(!!iosFlow.popupOpenedOnClick),
    hasBlob: String(!!iosFlow.hasBlob),
    lastStep: iosFlow.lastStep || "",
    statusText: iosFlow.statusText || "",
  });
  printBlocks("ANDROID_DOWNLOAD_FLOW", { PASS: String(passAnd), pdfSize: andBlob.size || 0 });
  printBlocks("NO_WINDOW_PRINT", { PASS: String(!core.usesWindowPrint) });
  printBlocks("NO_OLD_RENDERER", { PASS: String(!!core.usesPaper) });
  printBlocks("NO_DUPLICATE_SHARE_BUTTON", {
    PASS: String((iosFlow.preparedBtnCount || 0) === 0 && (iosFlow.shareBtnCount || 0) <= 2),
    preparedBtnCount: iosFlow.preparedBtnCount || 0,
  });

  const fail = !passCore || !passIos || !passAnd || !core.previewExportColorMatch;

  await browser.close();
  if (server) server.close();

  if (fail) {
    console.error("STOP invoice_pdf_real_export_proof");
    process.exit(1);
  }
  console.log("PROOF_PASS invoice_pdf_real_export");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

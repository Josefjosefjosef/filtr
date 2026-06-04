#!/usr/bin/env node
/**
 * Page composition audit: preview vs export vs PDF page box.
 * node scripts/invoice_pdf_page_composition_audit.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8097);
const LOCAL = `http://127.0.0.1:${PORT}`;
const PAPER_W = 794;

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
      const data = serveFile(req.url?.split("?")[0] || "/");
      if (data) {
        const ext = path.extname((req.url || "").split("?")[0] || "");
        const ct =
          ext === ".css"
            ? "text/css"
            : ext === ".js"
              ? "application/javascript"
              : "text/html";
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

function diff(a, b) {
  if (a == null || b == null) return "";
  return String(Math.round(a - b));
}

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  const { chromium } = await import("playwright");
  const engineHref = pathToFileURL(path.join(ROOT, "assets", "iu-invoice-engine.js")).href;
  const { buildInvoicePaperHtml, computeTotals, defaultFormState } = await import(engineHref);
  const st = defaultFormState();
  Object.assign(st, {
    supplierVatPayer: true,
    supplierFo: {
      firstName: "Jan",
      lastName: "Dodavatel",
      ico: "12345679",
      address: "Testovací 1, Praha",
      accountNumber: "123456789/0100",
    },
    buyerFo: { firstName: "Eva", lastName: "Odběratel", address: "Kupní 2, Brno" },
    invoice: {
      number: "2026-COMP-01",
      issueDate: "2026-06-01",
      dueDate: "2026-06-15",
      taxableDate: "2026-06-01",
      payment: "transfer",
      accountNumber: "987654321/0800",
      variableSymbol: "202601",
    },
    lines: [
      { name: "Konzultace", description: "Analýza a implementace", qty: "10", unit: "hod", unitPrice: "1200", vatRate: "21" },
      { name: "Licence", description: "", qty: "1", unit: "ks", unitPrice: "5000", vatRate: "21" },
    ],
  });
  const html = buildInvoicePaperHtml(st, computeTotals(st));

  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(appUrl, { waitUntil: "load", timeout: 120000 });
  await page.evaluate(async () => {
    const cssLink = document.querySelector('link[href*="iu-invoice-overlay.css"]');
    if (cssLink) {
      cssLink.href = "/assets/iu-invoice-overlay.css?v=iu-invoice-pdf-capture-v19";
      await new Promise((res) => {
        cssLink.onload = () => res();
        cssLink.onerror = () => res();
      });
    }
  });
  for (let i = 0; i < 100; i++) {
    const ok = await page.evaluate(() => typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function");
    if (ok) break;
    await page.waitForTimeout(400);
  }

  const audit = await page.evaluate(async (previewHtml) => {
    function measureBlocks(rootEl) {
      const blocks = {};
      if (!rootEl) return blocks;
      const pr = rootEl.getBoundingClientRect();
      function put(key, sel) {
        const el = rootEl.querySelector(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        blocks[key] = {
          x: Math.round(r.left - pr.left),
          y: Math.round(r.top - pr.top),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      }
      put("header", ".iu-inv-pr-head");
      put("supplier", ".iu-inv-pr-grid > div:first-child");
      put("customer", ".iu-inv-pr-grid > div:last-child");
      put("bank", ".iu-inv-pr-bank");
      put("table", ".iu-inv-pr-table");
      put("summary", ".iu-inv-pr-totals");
      put("footer", ".iu-inv-pr-foot");
      return blocks;
    }

    const panel = document.createElement("div");
    panel.id = "iuInvoicePanel";
    panel.style.cssText = "position:fixed;left:0;top:0;z-index:1;background:#fafafa;padding:20px;width:820px;";
    panel.innerHTML =
      '<div class="iu-inv-previewScroll"><div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--desktop">' +
      '<div class="iu-invoice-preview-desktop"><div class="iu-invoice-paper">' +
      previewHtml +
      "</div></div></div></div>";
    document.body.appendChild(panel);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 200));

    const previewPaper = panel.querySelector(".iu-invoice-paper");
    if (previewPaper) {
      previewPaper.style.width = "794px";
      previewPaper.style.maxWidth = "794px";
      previewPaper.style.minWidth = "794px";
    }
    const previewPage = panel.querySelector(".iu-inv-pr");
    const previewBlocks = measureBlocks(previewPage || previewPaper);
    const previewW = previewPaper ? Math.round(previewPaper.offsetWidth || 0) : 0;
    const previewH = previewPaper ? Math.round(previewPaper.scrollHeight || previewPaper.offsetHeight || 0) : 0;

    const pdfBlob = await new Promise((resolve, reject) => {
      window.iuPdfExportHtmlStringToBlobForInvoice(previewHtml, "comp.pdf", (err, o) => {
        if (err || !o || !o.blob) reject(err || new Error("no_blob"));
        else resolve(o.blob);
      });
    });
    const ab = await pdfBlob.arrayBuffer();
    const comp = window._iuInvoicePdfCompositionProof || {};
    const exportBlocks = comp.exportBlocks || {};
    panel.remove();

    return {
      pdfBytes: Array.from(new Uint8Array(ab)),
      pdfSize: pdfBlob.size,
      previewDocumentWidth: previewW,
      previewDocumentHeight: previewH,
      exportDocumentWidth: comp.exportDocumentWidth || comp.previewDocumentWidth || 0,
      exportDocumentHeight: comp.exportDocumentHeight || comp.previewDocumentHeight || 0,
      canvasWidth: comp.canvasWidth || 0,
      canvasHeight: comp.canvasHeight || 0,
      captureHeight: comp.captureHeight || 0,
      pdfPageWidth: comp.pdfPageWidth || 0,
      pdfPageHeight: comp.pdfPageHeight || 0,
      contentBoxWidth: comp.contentBoxWidth || 0,
      contentBoxHeight: comp.contentBoxHeight || 0,
      leftMargin: comp.leftMargin || 0,
      rightMargin: comp.rightMargin || 0,
      topMargin: comp.topMargin || 0,
      bottomMargin: comp.bottomMargin || 0,
      effectiveScale: comp.effectiveScale || 0,
      html2canvasScale: comp.html2canvasScale || 0,
      devicePixelRatio: comp.devicePixelRatio || window.devicePixelRatio || 1,
      viewportWidth: comp.viewportWidth || window.innerWidth,
      viewportHeight: comp.viewportHeight || window.innerHeight,
      fitToPageActive: !!comp.fitToPageActive,
      shrinkToFitActive: !!comp.shrinkToFitActive,
      jsPdfFormat: JSON.stringify(comp.jsPdfFormat || null),
      previewBlocks,
      exportBlocks,
    };
  }, html);

  const pdfPath = path.join(os.tmpdir(), "iu_invoice_comp_audit_" + Date.now() + ".pdf");
  fs.writeFileSync(pdfPath, Buffer.from(audit.pdfBytes));

  const pdfBox = await page.evaluate(async ({ pdfBytes, paperW }) => {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const data = { data: new Uint8Array(pdfBytes) };
    const pdf = await pdfjsLib.getDocument(data).promise;
    const p = await pdf.getPage(1);
    const vp = p.getViewport({ scale: 1 });
    const base = p.getViewport({ scale: 1 });
    const scale = paperW / base.width;
    const renderVp = p.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = renderVp.width;
    c.height = renderVp.height;
    await p.render({ canvasContext: c.getContext("2d"), viewport: renderVp }).promise;
    const ctx = c.getContext("2d");
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width,
      minY = c.height,
      maxX = 0,
      maxY = 0;
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        const r = img[i],
          g = img[i + 1],
          b = img[i + 2];
        if (r < 250 || g < 250 || b < 250) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    return {
      pdfRenderWidth: Math.round(renderVp.width),
      pdfRenderHeight: Math.round(renderVp.height),
      pdfNativeWidth: Math.round(vp.width),
      pdfNativeHeight: Math.round(vp.height),
      contentLeft: minX === c.width ? 0 : minX,
      contentTop: minY === c.height ? 0 : minY,
      contentWidth: maxX > minX ? maxX - minX : 0,
      contentHeight: maxY > minY ? maxY - minY : 0,
    };
  }, { pdfBytes: audit.pdfBytes, paperW: PAPER_W });

  const pb = audit.previewBlocks || {};
  const eb = audit.exportBlocks || {};
  const effScale =
    pdfBox.contentWidth > 0 && audit.exportDocumentWidth > 0
      ? Math.round((pdfBox.contentWidth / audit.exportDocumentWidth) * 1000) / 1000
      : audit.effectiveScale;

  const headerXDiff = diff(pb.header?.x, eb.header?.x);
  const headerYDiff = diff(pb.header?.y, eb.header?.y);
  const supplierWidthDiff = diff(pb.supplier?.width, eb.supplier?.width);
  const customerWidthDiff = diff(pb.customer?.width, eb.customer?.width);
  const tableWidthDiff = diff(pb.table?.width, eb.table?.width);
  const summaryXDiff = diff(pb.summary?.x, eb.summary?.x);
  const summaryYDiff = diff(pb.summary?.y, eb.summary?.y);
  const footerYDiff = diff(pb.footer?.y, eb.footer?.y);

  const pageBoxDiff = Math.abs(audit.exportDocumentHeight - audit.captureHeight) > 40;
  const contentBoxDiff = Math.abs(pdfBox.contentWidth - audit.exportDocumentWidth) > 40;
  const fitActive = audit.fitToPageActive || effScale < 0.95;
  const shrinkActive = audit.shrinkToFitActive || effScale < 0.95;

  const blockOk =
    Math.abs(Number(headerXDiff)) <= 4 &&
    Math.abs(Number(headerYDiff)) <= 4 &&
    Math.abs(Number(supplierWidthDiff)) <= 8 &&
    Math.abs(Number(customerWidthDiff)) <= 8 &&
    Math.abs(Number(tableWidthDiff)) <= 12 &&
    Math.abs(Number(summaryXDiff)) <= 12 &&
    Math.abs(Number(summaryYDiff)) <= 12;

  const compositionOk =
    audit.exportDocumentWidth === PAPER_W &&
    !pageBoxDiff &&
    !fitActive &&
    !shrinkActive &&
    pdfBox.contentTop <= 20 &&
    blockOk;

  printBlocks("invoice_pdf_page_composition_audit", {
    PASS: compositionOk ? "true" : "false",
    ROOT_CAUSE: pageBoxDiff
      ? "canvas_page_height_mismatch_min_height_or_fixed_capture_height"
      : fitActive
        ? "html2pdf_fit_to_page_shrink"
        : contentBoxDiff
          ? "pdf_content_box_width_mismatch"
          : blockOk
            ? "none"
            : "export_preview_block_geometry_mismatch",
    PAGE_BOX_DIFFERENCE: pageBoxDiff ? "true" : "false",
    CONTENT_BOX_DIFFERENCE: contentBoxDiff ? "true" : "false",
    PREVIEW_DOCUMENT_WIDTH: String(audit.previewDocumentWidth),
    PREVIEW_DOCUMENT_HEIGHT: String(audit.previewDocumentHeight),
    EXPORT_DOCUMENT_WIDTH: String(audit.exportDocumentWidth),
    EXPORT_DOCUMENT_HEIGHT: String(audit.exportDocumentHeight),
    CAPTURE_HEIGHT: String(audit.captureHeight),
    CANVAS_WIDTH: String(audit.canvasWidth),
    CANVAS_HEIGHT: String(audit.canvasHeight),
    PDF_PAGE_WIDTH: String(pdfBox.pdfNativeWidth),
    PDF_PAGE_HEIGHT: String(pdfBox.pdfNativeHeight),
    PDF_RENDER_WIDTH: String(pdfBox.pdfRenderWidth),
    PDF_RENDER_HEIGHT: String(pdfBox.pdfRenderHeight),
    PDF_CONTENT_LEFT: String(pdfBox.contentLeft),
    PDF_CONTENT_TOP: String(pdfBox.contentTop),
    PDF_CONTENT_WIDTH: String(pdfBox.contentWidth),
    PDF_CONTENT_HEIGHT: String(pdfBox.contentHeight),
    CONTENT_BOX_WIDTH: String(audit.contentBoxWidth),
    CONTENT_BOX_HEIGHT: String(audit.contentBoxHeight),
    LEFT_MARGIN: String(audit.leftMargin),
    TOP_MARGIN: String(pdfBox.contentTop),
    EFFECTIVE_SCALE: String(effScale),
    HTML2CANVAS_SCALE: String(audit.html2canvasScale),
    DEVICE_PIXEL_RATIO: String(audit.devicePixelRatio),
    VIEWPORT_WIDTH: String(audit.viewportWidth),
    VIEWPORT_HEIGHT: String(audit.viewportHeight),
    FIT_TO_PAGE_ACTIVE: fitActive ? "true" : "false",
    SHRINK_TO_FIT_ACTIVE: shrinkActive ? "true" : "false",
    JSPDF_FORMAT: audit.jsPdfFormat,
    HEADER_X_DIFF: headerXDiff,
    HEADER_Y_DIFF: headerYDiff,
    SUPPLIER_WIDTH_DIFF: supplierWidthDiff,
    CUSTOMER_WIDTH_DIFF: customerWidthDiff,
    TABLE_WIDTH_DIFF: tableWidthDiff,
    SUMMARY_X_DIFF: summaryXDiff,
    SUMMARY_Y_DIFF: summaryYDiff,
    FOOTER_Y_DIFF: footerYDiff,
    REAL_LAYOUT_MATCH: compositionOk ? "PASS" : "FAIL",
    PDF_SIZE: String(audit.pdfSize),
    PDF_FILE: pdfPath,
  });

  await browser.close();
  if (server) server.close();
  process.exit(compositionOk ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

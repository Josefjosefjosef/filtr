#!/usr/bin/env node
/**
 * DOM parity diagnostic: preview vs capture host snapshots + exact diffs.
 * node scripts/invoice_pdf_dom_parity_diagnostic.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8097);
const LOCAL = `http://127.0.0.1:${PORT}`;

function printBlocks(label, obj) {
  console.log(`=== ${label} ===`);
  Object.keys(obj).forEach((k) => console.log(`${k}=${typeof obj[k] === "object" ? JSON.stringify(obj[k]) : obj[k]}`));
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

function diffBlocks(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out = {};
  keys.forEach((k) => {
    const va = a && a[k];
    const vb = b && b[k];
    if (!va || !vb) {
      out[k + "_MISSING"] = !va ? "preview" : "capture";
      return;
    }
    out[k + "_X_DIFF"] = (vb.x || 0) - (va.x || 0);
    out[k + "_Y_DIFF"] = (vb.y || 0) - (va.y || 0);
    out[k + "_W_DIFF"] = (vb.width || 0) - (va.width || 0);
    out[k + "_H_DIFF"] = (vb.height || 0) - (va.height || 0);
  });
  return out;
}

function diffCols(a, b) {
  const out = {};
  const len = Math.max((a || []).length, (b || []).length);
  for (let i = 0; i < len; i++) {
    out["col" + (i + 1) + "_DIFF"] = (b && b[i] ? b[i] : 0) - (a && a[i] ? a[i] : 0);
  }
  return out;
}

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { chromium, devices } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const iphone = devices["iPhone 13"];
  const ctx = await browser.newContext({ ...iphone });
  const page = await ctx.newPage();

  await page.goto(appUrl, { waitUntil: "load", timeout: 120000 });
  for (let i = 0; i < 120; i++) {
    const ready = await page.evaluate(
      () =>
        typeof window.iuEnsureInvoiceOverlayBoot === "function" &&
        typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function",
    );
    if (ready) break;
    await page.waitForTimeout(500);
  }

  const diag = await page.evaluate(async () => {
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
    await new Promise((r) => setTimeout(r, 700));
    const panel = document.getElementById("iuInvoicePanel");
    const root = document.querySelector("[data-iu-invoice-root]");
    if (!root) return { err: "no_root" };

    setVal('[data-inv="supplierFo.firstName"]', "Jan");
    setVal('[data-inv="supplierFo.lastName"]', "Dodavatel");
    setVal('[data-inv="supplierFo.ico"]', "12345679");
    setVal('[data-inv="supplierFo.address"]', "Praha 1");
    setVal('[data-inv="supplierFo.accountNumber"]', "123456789/0100");
    setVal('[data-inv="buyerFo.firstName"]', "Eva");
    setVal('[data-inv="buyerFo.lastName"]', "Kupující");
    setVal('[data-inv="buyerFo.address"]', "Brno 2");
    setVal('[data-inv="invoice.number"]', "DOM-PARITY-01");
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
      setLine("name", "Konzultace");
      setLine("description", "Analýza");
      setLine("qty", "10");
      setLine("unitPrice", "1200");
    }
    const previewBtn = root.querySelector("[data-inv-preview]");
    const preLayer = root.querySelector("[data-inv-preview-layer]");
    const preHost = preLayer && preLayer.querySelector("[data-inv-preview-host]");
    if (previewBtn) previewBtn.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 800));

    let layer =
      (panel && panel.querySelector("[data-inv-preview-layer]:not([hidden])")) ||
      root.querySelector("[data-inv-preview-layer]");
    let previewOpenUi = !!(layer && !layer.hidden);
    let forcedPreviewDom = false;

    const { buildInvoicePaperHtml, computeTotals, defaultFormState } = await import("/assets/iu-invoice-engine.js");
    const st = defaultFormState();
    Object.assign(st, {
      supplierFo: {
        firstName: "Jan",
        lastName: "Dodavatel",
        ico: "12345679",
        address: "Praha 1",
        accountNumber: "123456789/0100",
      },
      buyerFo: { firstName: "Eva", lastName: "Kupující", address: "Brno 2" },
      invoice: {
        number: "DOM-PARITY-01",
        issueDate: "2026-06-01",
        dueDate: "2026-06-15",
        taxableDate: "2026-06-01",
        payment: "transfer",
        accountNumber: "123456789/0100",
      },
      lines: [
        {
          id: "l1",
          name: "Konzultace",
          description: "Analýza",
          qty: "10",
          unit: "hod",
          unitPrice: "1200",
          vatRate: "21",
        },
      ],
    });
    const html = buildInvoicePaperHtml(st, computeTotals(st));

    if (!previewOpenUi && preLayer && preHost) {
      forcedPreviewDom = true;
      const innerAvail = Math.max(260, (preHost.clientWidth || 360) - 24);
      const sc = Math.min(1, innerAvail / 794);
      preHost.innerHTML =
        '<div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--mobile">' +
        '<div class="iu-invoice-preview-mobile">' +
        '<div class="iu-invoice-preview-scale" style="width:794px;transform:scale(' +
        sc +
        ');transform-origin:top center">' +
        '<div class="iu-invoice-paper">' +
        html +
        "</div></div></div></div>";
      preLayer.hidden = false;
      preLayer.classList.remove("iu-inv-guard-hidden");
      layer = preLayer;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 200));
    }

    const statusEl = root.querySelector("[data-inv-status]");
    const statusText = statusEl ? String(statusEl.textContent || "").trim() : "";

    if (!layer) {
      layer =
        (panel && panel.querySelector("[data-inv-preview-layer]")) ||
        root.querySelector("[data-inv-preview-layer]");
    }
    const layerOpen = previewOpenUi && !!(layer && !layer.hidden);
    const layerRect = layer && !layer.hidden ? layer.getBoundingClientRect() : null;
    const layerVisible =
      layerRect && layerRect.width > 50 && layerRect.height > 50 && layerRect.top >= -2;
    const previewDiag = window._iuInvoicePreviewDiag || {};

    const previewPage =
      (layer && layer.querySelector(".iu-inv-pr")) ||
      root.querySelector("[data-inv-preview-layer] .iu-inv-pr");
    const previewHost = previewPage ? previewPage.closest(".iu-invoice-paper") || previewPage.parentElement : null;

    await new Promise((resolve, reject) => {
      window.iuPdfExportHtmlStringToBlobForInvoice(html, "dom-parity.pdf", (err, o) => {
        if (err || !o || !o.blob) reject(err || new Error("export_fail"));
        else resolve(o.blob);
      });
    });

    const domParity = window._iuInvoicePdfDomParity || {};
    const previewSnap = domParity.preview || {};
    const captureSnap = domParity.capture || {};

    function snapMetrics(pageEl, hostEl) {
      if (!pageEl) return null;
      const cs = window.getComputedStyle(pageEl);
      const table = pageEl.querySelector(".iu-inv-pr-table thead tr");
      const cols = [];
      if (table) {
        for (let i = 0; i < table.cells.length; i++) cols.push(table.cells[i].offsetWidth || 0);
      }
      const title = pageEl.querySelector(".iu-inv-pr-title");
      const fm = title
        ? {
            fontSize: getComputedStyle(title).fontSize,
            fontWeight: getComputedStyle(title).fontWeight,
            lineHeight: getComputedStyle(title).lineHeight,
          }
        : {};
      const totals = pageEl.querySelector(".iu-inv-pr-totals");
      let summaryBox = null;
      if (totals) {
        summaryBox = {
          x: totals.offsetLeft,
          y: totals.offsetTop,
          width: totals.offsetWidth,
          height: totals.offsetHeight,
        };
      }
      const blocks = {};
      function putBlock(key, sel) {
        const el = pageEl.querySelector(sel);
        if (!el) return;
        blocks[key] = {
          x: el.offsetLeft,
          y: el.offsetTop,
          width: el.offsetWidth,
          height: el.offsetHeight,
        };
      }
      putBlock("header", ".iu-inv-pr-head");
      putBlock("supplier", ".iu-inv-pr-grid > div:first-child");
      putBlock("customer", ".iu-inv-pr-grid > div:last-child");
      putBlock("bank", ".iu-inv-pr-bank");
      putBlock("table", ".iu-inv-pr-table");
      putBlock("summary", ".iu-inv-pr-totals");
      putBlock("footer", ".iu-inv-pr-foot");
      return {
        hostHtml: hostEl ? hostEl.outerHTML.slice(0, 4000) : pageEl.outerHTML.slice(0, 4000),
        computedWidth: pageEl.offsetWidth || Math.round(pageEl.getBoundingClientRect().width),
        scrollWidth: pageEl.scrollWidth,
        scrollHeight: pageEl.scrollHeight,
        fontMetrics: fm,
        tableColumnWidths: cols,
        summaryBox,
        blocks,
        padding: cs.padding,
        margin: cs.margin,
      };
    }

    const livePreview = snapMetrics(previewPage, previewHost);
    const liveCapture = captureSnap.computedWidth
      ? {
          hostHtml: "(from export snapshot)",
          computedWidth: captureSnap.computedWidth,
          scrollWidth: captureSnap.scrollWidth,
          scrollHeight: captureSnap.scrollHeight,
          fontMetrics: captureSnap.fontMetrics || {},
          tableColumnWidths: captureSnap.tableColumnWidths || [],
          summaryBox: captureSnap.summaryBox || captureSnap.blocks?.summary || null,
        }
      : null;

    return {
      err: null,
      statusText,
      bodyPreviewOpen: document.body.classList.contains("iu-invoice-preview-open"),
      preClickHasLayer: !!preLayer,
      preClickHasHost: !!preHost,
      preClickHasPreviewBtn: !!previewBtn,
      panelLayerHidden: panel?.querySelector("[data-inv-preview-layer]")?.hidden,
      rootLayerHidden: root.querySelector("[data-inv-preview-layer]")?.hidden,
      layerHiddenAttr: layer ? layer.hidden : true,
      hostHasPaper: !!(layer && layer.querySelector(".iu-inv-pr")),
      previewDownloadInRoot: !!root.querySelector("[data-inv-preview-download]"),
      PREVIEW_OPEN: layerOpen && layerVisible,
      PREVIEW_OPEN_UI: previewOpenUi,
      FORCED_PREVIEW_DOM: forcedPreviewDom,
      PREVIEW_DIAG: JSON.stringify(previewDiag),
      layerHidden: layer ? layer.hidden : true,
      layerParent: layer && layer.parentElement ? layer.parentElement.id || layer.parentElement.className.slice(0, 60) : "",
      layerRect: layerRect
        ? { w: Math.round(layerRect.width), h: Math.round(layerRect.height), t: Math.round(layerRect.top) }
        : null,
      PREVIEW_HOST_HTML: livePreview ? livePreview.hostHtml : "",
      CAPTURE_HOST_HTML: domParity.captureHostHtml || "",
      CAPTURE_HOST_HTML_LEN: domParity.captureHostHtmlLen || 0,
      PREVIEW_COMPUTED_WIDTH: livePreview ? livePreview.computedWidth : 0,
      CAPTURE_COMPUTED_WIDTH: liveCapture ? liveCapture.computedWidth : 0,
      PREVIEW_SCROLL_WIDTH: livePreview ? livePreview.scrollWidth : 0,
      CAPTURE_SCROLL_WIDTH: liveCapture ? liveCapture.scrollWidth : 0,
      PREVIEW_SCROLL_HEIGHT: livePreview ? livePreview.scrollHeight : 0,
      CAPTURE_SCROLL_HEIGHT: liveCapture ? liveCapture.scrollHeight : 0,
      PREVIEW_FONT_METRICS: livePreview ? livePreview.fontMetrics : {},
      CAPTURE_FONT_METRICS: liveCapture ? liveCapture.fontMetrics : {},
      PREVIEW_TABLE_COLUMN_WIDTHS: livePreview ? livePreview.tableColumnWidths : [],
      CAPTURE_TABLE_COLUMN_WIDTHS: liveCapture ? liveCapture.tableColumnWidths : [],
      PREVIEW_SUMMARY_BOX: livePreview ? livePreview.summaryBox : null,
      CAPTURE_SUMMARY_BOX: liveCapture ? liveCapture.summaryBox : null,
      previewBlocks: livePreview?.blocks || previewSnap.blocks || {},
      captureBlocks: captureSnap.blocks || {},
      previewHostHtmlLen: domParity.previewHostHtmlLen || 0,
      captureHostHtmlLen: domParity.captureHostHtmlLen || 0,
    };
  });

  if (diag.err) {
    printBlocks("DOM_PARITY_DIAGNOSTIC", { err: diag.err, PASS: false });
    await browser.close();
    if (server) server.close();
    process.exit(1);
  }

  const blockDiff = diffBlocks(diag.previewBlocks, diag.captureBlocks);
  const colDiff = diffCols(diag.PREVIEW_TABLE_COLUMN_WIDTHS, diag.CAPTURE_TABLE_COLUMN_WIDTHS);
  const widthDiff = (diag.CAPTURE_COMPUTED_WIDTH || 0) - (diag.PREVIEW_COMPUTED_WIDTH || 0);
  const scrollWDiff = (diag.CAPTURE_SCROLL_WIDTH || 0) - (diag.PREVIEW_SCROLL_WIDTH || 0);
  const scrollHDiff = (diag.CAPTURE_SCROLL_HEIGHT || 0) - (diag.PREVIEW_SCROLL_HEIGHT || 0);

  let summaryDiff = null;
  if (diag.PREVIEW_SUMMARY_BOX && diag.CAPTURE_SUMMARY_BOX) {
    summaryDiff = {
      x: diag.CAPTURE_SUMMARY_BOX.x - diag.PREVIEW_SUMMARY_BOX.x,
      y: diag.CAPTURE_SUMMARY_BOX.y - diag.PREVIEW_SUMMARY_BOX.y,
      w: diag.CAPTURE_SUMMARY_BOX.width - diag.PREVIEW_SUMMARY_BOX.width,
      h: diag.CAPTURE_SUMMARY_BOX.height - diag.PREVIEW_SUMMARY_BOX.height,
    };
  }

  printBlocks("PREVIEW_OPEN", {
    PASS: diag.PREVIEW_OPEN,
    PREVIEW_OPEN_UI: diag.PREVIEW_OPEN_UI,
    FORCED_PREVIEW_DOM: diag.FORCED_PREVIEW_DOM,
    layerHidden: diag.layerHidden,
    layerParent: diag.layerParent,
    layerRect: JSON.stringify(diag.layerRect),
    statusText: diag.statusText || "",
    bodyPreviewOpen: diag.bodyPreviewOpen,
    panelLayerHidden: diag.panelLayerHidden,
    rootLayerHidden: diag.rootLayerHidden,
    hostHasPaper: diag.hostHasPaper,
    previewDownloadInRoot: diag.previewDownloadInRoot,
  });

  printBlocks("DOM_PARITY_DIFF", {
    WIDTH_DIFF: widthDiff,
    SCROLL_WIDTH_DIFF: scrollWDiff,
    SCROLL_HEIGHT_DIFF: scrollHDiff,
    TABLE_COLUMN_DIFF: JSON.stringify(colDiff),
    SUMMARY_BOX_DIFF: JSON.stringify(summaryDiff || {}),
    BLOCK_RECT_DIFF: JSON.stringify(blockDiff),
  });

  printBlocks("DOM_SNAPSHOT", {
    PREVIEW_HOST_HTML: (diag.PREVIEW_HOST_HTML || "").slice(0, 500),
    CAPTURE_HOST_HTML: (diag.CAPTURE_HOST_HTML || "").slice(0, 500),
    PREVIEW_COMPUTED_WIDTH: diag.PREVIEW_COMPUTED_WIDTH,
    CAPTURE_COMPUTED_WIDTH: diag.CAPTURE_COMPUTED_WIDTH,
    WIDTH_DIFF: widthDiff,
    PREVIEW_SCROLL_WIDTH: diag.PREVIEW_SCROLL_WIDTH,
    CAPTURE_SCROLL_WIDTH: diag.CAPTURE_SCROLL_WIDTH,
    SCROLL_WIDTH_DIFF: scrollWDiff,
    PREVIEW_SCROLL_HEIGHT: diag.PREVIEW_SCROLL_HEIGHT,
    CAPTURE_SCROLL_HEIGHT: diag.CAPTURE_SCROLL_HEIGHT,
    SCROLL_HEIGHT_DIFF: scrollHDiff,
    PREVIEW_FONT_METRICS: JSON.stringify(diag.PREVIEW_FONT_METRICS),
    CAPTURE_FONT_METRICS: JSON.stringify(diag.CAPTURE_FONT_METRICS),
    PREVIEW_TABLE_COLUMN_WIDTHS: JSON.stringify(diag.PREVIEW_TABLE_COLUMN_WIDTHS),
    CAPTURE_TABLE_COLUMN_WIDTHS: JSON.stringify(diag.CAPTURE_TABLE_COLUMN_WIDTHS),
    PREVIEW_SUMMARY_BOX: JSON.stringify(diag.PREVIEW_SUMMARY_BOX),
    CAPTURE_SUMMARY_BOX: JSON.stringify(diag.CAPTURE_SUMMARY_BOX),
  });

  printBlocks("BLOCK_RECT_DIFF", blockDiff);
  printBlocks("TABLE_COLUMN_DIFF", colDiff);
  printBlocks("SUMMARY_BOX_DIFF", summaryDiff || { note: "missing_summary_box" });

  const layoutMatch =
    widthDiff === 0 &&
    Object.keys(colDiff).every((k) => colDiff[k] === 0) &&
    Object.keys(blockDiff).every((k) => !k.endsWith("_DIFF") || blockDiff[k] === 0);

  printBlocks("VERDICT", {
    PREVIEW_OPEN: diag.PREVIEW_OPEN ? "PASS" : "FAIL",
    COLUMN_WIDTH_MATCH: Object.keys(colDiff).every((k) => colDiff[k] === 0) ? "PASS" : "FAIL",
    LAYOUT_MATCH: layoutMatch ? "PASS" : "FAIL",
    REAL_LAYOUT_MATCH: "PENDING_DEVICE",
    HOTOVO: "NE",
    note: "REAL_LAYOUT_MATCH requires real iPhone screenshot confirmation",
  });

  const outDir = path.join(os.tmpdir(), "iu_invoice_dom_parity_" + Date.now());
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "preview_host_snippet.html"), diag.PREVIEW_HOST_HTML || "");
  fs.writeFileSync(path.join(outDir, "diagnostic.json"), JSON.stringify({ ...diag, blockDiff, colDiff, summaryDiff }, null, 2));
  printBlocks("ARTIFACTS", { outDir });

  await browser.close();
  if (server) server.close();

  if (!diag.PREVIEW_OPEN_UI) process.exit(1);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

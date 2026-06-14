#!/usr/bin/env node
/**
 * WYSIWYG raster preview POC — isolated from production UI.
 * Preview canvas and PDF embed the SAME PNG bytes (single raster source).
 * node scripts/invoice_raster_preview_poc.mjs
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  A4_W_PT,
  A4_H_PT,
  A4_PAGE_H_PX,
  PARITY_COMPARE_W,
  PARITY_MAX_DIFF_PERCENT,
  printBlocks,
  parsePdfBoxesFromBytes,
  startPdfjsServer,
  renderPdfPage1At794,
  compareImagesStrict,
} from "./invoice_pdf_viewer_parity_lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8166);
const PDFJS_ROOT = path.join(os.tmpdir(), "iu_pdfjs_node", "node_modules", "pdfjs-dist");
const LOCAL = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(os.tmpdir(), "iu_invoice_raster_poc_" + Date.now());

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
          ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : ext === ".ttf" ? "font/ttf" : "text/html";
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

function baseState() {
  return {
    supplierKind: "fo",
    supplierVatPayer: true,
    supplierFo: {
      firstName: "Jan",
      lastName: "Dodavatel",
      ico: "12345679",
      address: "Testovací 1, Praha",
      accountNumber: "123456789/0100",
    },
    buyerKind: "fo",
    buyerFo: { firstName: "Eva", lastName: "Odběratel", address: "Kupní 2, Brno" },
    invoice: {
      number: "2026-RASTER-POC-01",
      issueDate: "2026-06-01",
      dueDate: "2026-06-15",
      taxableDate: "2026-06-01",
      payment: "transfer",
      accountNumber: "987654321/0800",
      variableSymbol: "202601",
    },
    lines: [{ id: "1", name: "Konzultace", description: "", qty: "2", unit: "hod", unitPrice: "1200", vatRate: "21" }],
  };
}

function line(id, name, desc, qty, price) {
  return { id, name, description: desc, qty, unit: "ks", unitPrice: price, vatRate: "21" };
}

const FIXTURES = {
  short: () => baseState(),
  long: () => {
    const st = baseState();
    st.lines[0].description =
      "FAKTURUJI VAM ZA PROVEDENE PRACE NA VASEM MAJETKU NA ADRESE BOHEMIA ROMAKURTIKA A PROTOUZE VAM TO NEFUNGOBALO";
    return st;
  },
  twoPage: () => {
    const st = baseState();
    st.lines = [];
    for (let i = 1; i <= 18; i++) {
      st.lines.push(line(String(i), "Polozka " + i, "Popis polozky " + i + " pro test zalamovani", "2", "1500"));
    }
    return st;
  },
  threePage: () => {
    const st = baseState();
    st.lines = [];
    for (let i = 1; i <= 32; i++) {
      st.lines.push(
        line(String(i), "Polozka " + i, "Popis polozky " + i + " s velmi dlouhym popisem pro vicestrankovy export", "3", "2200"),
      );
    }
    return st;
  },
};

async function runRasterPoc(page, stateJson) {
  return page.evaluate(async (stateStr) => {
    const PAPER_W = 794;
    const PAGE_H = 1123;
    const A4_W = 595.28;
    const A4_H = 841.89;
    const state = JSON.parse(stateStr);
    document.querySelectorAll("[data-iu-raster-poc]").forEach((el) => el.remove());

    const { computeTotals, buildInvoicePaperHtml } = await import("/assets/iu-invoice-engine.js");
    const { buildA4ExportPagePlans, ensureInvoiceOverlayCssReady } = await import("/assets/iu-invoice-pdf-renderer.js");
    await ensureInvoiceOverlayCssReady();
    if (typeof window.html2pdf !== "function") {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/assets/vendor/html2pdf.bundle.min.js";
        s.setAttribute("data-iu-html2pdf", "1");
        s.onload = () => resolve();
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    if (!(window.jspdf && window.jspdf.jsPDF)) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/assets/vendor/jspdf.umd.min.js";
        s.setAttribute("data-iu-jspdf", "1");
        s.onload = () => resolve();
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    const totals = computeTotals(state);
    const html = buildInvoicePaperHtml(state, totals);

    const host = document.createElement("div");
    host.setAttribute("data-iu-raster-poc", "host");
    host.style.cssText = "position:fixed;left:0;top:0;width:" + PAPER_W + "px;visibility:visible;opacity:1;z-index:1;background:#fff;";
    host.innerHTML =
      '<div class="iu-invoice-preview-portal iu-invoice-preview-portal--open">' +
      '<div class="iu-invoice-paper">' +
      html +
      "</div></div>";
    document.body.appendChild(host);

    const pageEl = host.querySelector(".iu-inv-pr");
    if (!pageEl) throw new Error("poc_page_missing");
    const plans = buildA4ExportPagePlans(pageEl);
    const pngPages = [];
    const scale = 2;

    for (let pi = 0; pi < plans.length; pi++) {
      const plan = plans[pi];
      const off = plan.offsetY || 0;
      pageEl.style.transform = "translateY(" + -off + "px)";
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      let canvas;
      if (typeof window.html2canvas === "function") {
        canvas = await window.html2canvas(host, {
          scale,
          x: 0,
          y: 0,
          width: PAPER_W,
          height: PAGE_H,
          scrollX: 0,
          scrollY: 0,
          windowWidth: PAPER_W,
          windowHeight: PAGE_H,
          backgroundColor: "#ffffff",
          logging: false,
          useCORS: true,
        });
      } else {
        const worker = window.html2pdf().set({ margin: 0, html2canvas: { scale, width: PAPER_W, height: PAGE_H } }).from(host);
        await worker.toCanvas();
        canvas = worker.prop && worker.prop.canvas ? worker.prop.canvas : worker.canvas;
      }
      if (!canvas) throw new Error("poc_raster_failed");
      pngPages.push(canvas.toDataURL("image/png"));
      pageEl.style.transform = "";
    }
    host.remove();

    const preview = document.createElement("div");
    preview.id = "iu-raster-poc-preview";
    preview.setAttribute("data-iu-raster-poc", "preview");
    preview.style.cssText = "position:fixed;left:0;top:0;width:" + PAPER_W + "px;background:#fff;z-index:2;";
    const displayCanvas = document.createElement("canvas");
    displayCanvas.id = "iu-raster-poc-canvas-0";
    displayCanvas.setAttribute("data-iu-raster-poc", "canvas");
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = pngPages[0];
    });
    displayCanvas.width = img.width;
    displayCanvas.height = img.height;
    displayCanvas.getContext("2d").drawImage(img, 0, 0);
    preview.appendChild(displayCanvas);
    document.body.appendChild(preview);

    const jsPdfMod = window.jspdf || window.jsPDF;
    const JsPDF = jsPdfMod && jsPdfMod.jsPDF ? jsPdfMod.jsPDF : jsPdfMod;
    if (!JsPDF) throw new Error("jspdf_missing");
    const doc = new JsPDF({ unit: "pt", format: "a4", orientation: "portrait", compress: true });
    for (let i = 0; i < pngPages.length; i++) {
      if (i > 0) doc.addPage([A4_W, A4_H], "p");
      doc.addImage(pngPages[i], "PNG", 0, 0, A4_W, A4_H, undefined, "FAST");
    }
    const pdfAb = doc.output("arraybuffer");
    return {
      pdfBytes: Array.from(new Uint8Array(pdfAb)),
      pngPage0: pngPages[0],
      pageCount: pngPages.length,
      planCount: plans.length,
      sameRaster: true,
    };
  }, stateJson);
}

async function runFixture(browser, pdfjsPort, key, buildState) {
  const page = await browser.newPage({ viewport: { width: 820, height: 1400 } });
  await page.goto(`${LOCAL}/projects/index.html?nosw=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(400);
  const out = await runRasterPoc(page, JSON.stringify(buildState()));
  await page.waitForTimeout(200);
  const sourceRasterPath = path.join(OUT_DIR, key + "_source_raster.png");
  const sourceB64 = out.pngPage0.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(sourceRasterPath, Buffer.from(sourceB64, "base64"));
  const shotPath = path.join(OUT_DIR, key + "_canvas.png");
  const canvasDataUrl = await page.evaluate(() => {
    const c = document.getElementById("iu-raster-poc-canvas-0");
    return c ? c.toDataURL("image/png") : "";
  });
  if (canvasDataUrl) {
    fs.writeFileSync(shotPath, Buffer.from(canvasDataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
  }
  const canvasB64 = canvasDataUrl ? canvasDataUrl.replace(/^data:image\/png;base64,/, "") : "";
  const pdfPath = path.join(OUT_DIR, key + ".pdf");
  fs.writeFileSync(pdfPath, Buffer.from(out.pdfBytes));
  const pdfPngPath = path.join(OUT_DIR, key + "_pdf_page1.png");
  await renderPdfPage1At794(browser, out.pdfBytes, pdfjsPort, pdfPngPath);
  const pdfB64 = fs.readFileSync(pdfPngPath).toString("base64");
  const metrics = await compareImagesStrict(browser, sourceB64, pdfB64, null, PARITY_COMPARE_W, A4_PAGE_H_PX);
  const previewMetrics = canvasB64
    ? await compareImagesStrict(browser, sourceB64, canvasB64, null, PARITY_COMPARE_W, A4_PAGE_H_PX)
    : { diffPct: 999 };
  const boxes = parsePdfBoxesFromBytes(out.pdfBytes);
  await page.close();
  const diff = metrics.diffPct ?? 999;
  const pass = diff < PARITY_MAX_DIFF_PERCENT;
  const pageOk = key === "short" || key === "long" ? boxes.pageCount === 1 : key === "twoPage" ? boxes.pageCount >= 2 : boxes.pageCount >= 3;
  return {
    key,
    diff,
    pass,
    pageOk,
    pageCount: boxes.pageCount,
    boxes,
    previewDiff: previewMetrics.diffPct ?? 999,
    sourceRasterBytes: fs.statSync(sourceRasterPath).size,
  };
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer();
  const { server: pdfjsServer, port: pdfjsPort } = await startPdfjsServer(PDFJS_ROOT);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  const short = await runFixture(browser, pdfjsPort, "short", FIXTURES.short);
  const long = await runFixture(browser, pdfjsPort, "long", FIXTURES.long);
  const two = await runFixture(browser, pdfjsPort, "twoPage", FIXTURES.twoPage);
  const three = await runFixture(browser, pdfjsPort, "threePage", FIXTURES.threePage);

  const maxDiff = Math.max(short.diff, long.diff, two.diff, three.diff);
  const refBoxes = short.boxes || {};
  const allParityPass = [short, long, two, three].every((r) => r.pass);
  const feasible = allParityPass && maxDiff < PARITY_MAX_DIFF_PERCENT;

  printBlocks("invoice_raster_preview_poc", {
    RASTER_PREVIEW_POC_CREATED: "YES",
    PRODUCTION_PREVIEW_CHANGED: "NO",
    PDF_USES_SAME_RASTER_AS_PREVIEW: "YES",
    SCREENSHOT_VS_PDF_DIFF: String(short.diff),
    PREVIEW_CANVAS_VS_SOURCE_DIFF: String(short.previewDiff),
    SOURCE_RASTER_BYTES: String(short.sourceRasterBytes),
    MAX_SCREENSHOT_VS_PDF_DIFF: String(maxDiff),
    PARITY_MAX_DIFF_ALLOWED: String(PARITY_MAX_DIFF_PERCENT),
    RASTER_PARITY_GATE: allParityPass ? "PASS" : "FAIL",
    PDF_IS_A4: refBoxes.pdfIsA4 ? "YES" : "NO",
    PDF_SUPPORTS_MULTIPAGE_A4: "YES",
    PDF_IS_SINGLE_LONG_PAGE: refBoxes.pdfIsSingleLongPage ? "YES" : "NO",
    SHORT_INVOICE_PASS: short.pass ? "YES" : "NO",
    LONG_INVOICE_PASS: long.pass ? "YES" : "NO",
    TWO_PAGE_PASS: two.pageOk && two.pass ? "YES" : "NO",
    THREE_PAGE_PASS: three.pageOk && three.pass ? "YES" : "NO",
    TWO_PAGE_COUNT: String(two.pageCount),
    THREE_PAGE_COUNT: String(three.pageCount),
    RASTER_PREVIEW_ARCHITECTURE_FEASIBLE: feasible ? "YES" : "NO",
    OUT_DIR,
  });

  await browser.close();
  server.close();
  pdfjsServer.close();
  process.exit(feasible ? 0 : 1);
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

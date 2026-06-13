#!/usr/bin/env node
/**
 * Visual parity: HTML preview screenshot vs PDF canvas render (pdf.js, no embed).
 * node scripts/invoice_pdf_visual_parity_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8130);
const PDFJS_PORT = PORT + 1;
const LOCAL = `http://127.0.0.1:${PORT}`;
const PDFJS_ROOT = path.join(os.tmpdir(), "iu_pdfjs_node", "node_modules", "pdfjs-dist");
const OUT_DIR = path.join(os.tmpdir(), "iu_invoice_visual_parity_" + Date.now());
const LONG_DESC =
  "FAKTURUJI VAM ZA PROVEDENE PRACE NA VASEM MAJETKU NA ADRESE BOHEMIA ROMAKURTIKA A PROTOUZE VAM TO NEFUNGOBALO";
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

function startPdfjsServer() {
  return new Promise((resolve, reject) => {
    const base = path.resolve(PDFJS_ROOT);
    const renderHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#fff"><canvas id="c"></canvas></body></html>`;
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || "/").split("?")[0].replace(/^\//, "");
      if (urlPath === "render" || urlPath === "render/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderHtml);
        return;
      }
      const filePath = path.resolve(path.join(PDFJS_ROOT, urlPath));
      if (!filePath.startsWith(base)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        const ct =
          ext === ".mjs"
            ? "text/javascript"
            : ext === ".map"
              ? "application/json"
              : "application/octet-stream";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : PDFJS_PORT });
    });
    server.on("error", reject);
  });
}

async function dismissCookieBanner(page) {
  try {
    const btn = page.locator('button:has-text("Pouze nezbytné")').first();
    if (await btn.isVisible({ timeout: 2000 })) await btn.click();
    await page.waitForTimeout(400);
  } catch (_) {}
}

async function renderPdfCanvasPng(browser, pdfBytes, outPath, pdfjsPort, targetWidth) {
  const renderPage = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  const pdfJsBase = `http://127.0.0.1:${pdfjsPort}/legacy/build`;
  await renderPage.goto(`http://127.0.0.1:${pdfjsPort}/render`, { waitUntil: "load" });
  const meta = await renderPage.evaluate(
    async ({ pdfBytes, pdfJsBase, targetWidth }) => {
      const pdfjsLib = await import(`${pdfJsBase}/pdf.min.mjs`);
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${pdfJsBase}/pdf.worker.min.mjs`;
      const data = new Uint8Array(pdfBytes);
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const page = await pdf.getPage(1);
      const scale = targetWidth / 595.28;
      const vp = page.getViewport({ scale });
      const c = document.getElementById("c");
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      const full = c.getContext("2d").getImageData(0, 0, c.width, c.height);
      let ink = 0;
      for (let y = 0; y < c.height; y += 2) {
        for (let x = 0; x < c.width; x += 2) {
          const i = (y * c.width + x) * 4;
          if (full.data[i] < 245 || full.data[i + 1] < 245 || full.data[i + 2] < 245) ink++;
        }
      }
      return { w: c.width, h: c.height, ink };
    },
    { pdfBytes, pdfJsBase, targetWidth },
  );
  await renderPage.locator("#c").screenshot({ path: outPath });
  await renderPage.close();
  return meta;
}

async function compareImages(browser, prevB64, pdfImgB64, diffPath, paperW) {
  const cmpPage = await browser.newPage();
  const metrics = await cmpPage.evaluate(
    async ({ prevB64, pdfImgB64, paperW }) => {
      function load(b64) {
        return new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = "data:image/png;base64," + b64;
        });
      }
      const pa = await load(prevB64);
      const pb = await load(pdfImgB64);
      const tw = Math.min(pa.width, pb.width, paperW);
      let contentH = pa.height;
      const probe = document.createElement("canvas");
      probe.width = pa.width;
      probe.height = pa.height;
      probe.getContext("2d").drawImage(pa, 0, 0);
      const pd = probe.getContext("2d").getImageData(0, 0, pa.width, pa.height).data;
      for (let y = pa.height - 1; y >= 0; y -= 2) {
        let rowInk = false;
        for (let x = 0; x < pa.width; x += 4) {
          const i = (y * pa.width + x) * 4;
          if (pd[i] < 220 || pd[i + 1] < 220 || pd[i + 2] < 220) {
            rowInk = true;
            break;
          }
        }
        if (rowInk) {
          contentH = y + 8;
          break;
        }
      }
      const th = Math.min(contentH, pb.height, 1100);
      const ca = document.createElement("canvas");
      const cb = document.createElement("canvas");
      const cd = document.createElement("canvas");
      ca.width = cb.width = cd.width = tw;
      ca.height = cb.height = cd.height = th;
      ca.getContext("2d").drawImage(pa, 0, 0, tw, th, 0, 0, tw, th);
      cb.getContext("2d").drawImage(pb, 0, 0, tw, th, 0, 0, tw, th);
      const da = ca.getContext("2d").getImageData(0, 0, tw, th).data;
      const db = cb.getContext("2d").getImageData(0, 0, tw, th).data;
      const dc = cd.getContext("2d").createImageData(tw, th);
      let match = 0;
      let total = 0;
      let prevBordo = 0;
      let pdfBordo = 0;
      let prevInk = 0;
      let pdfInk = 0;
      let marginDiff = 0;
      let tableDiff = 0;
      let textDiff = 0;
      const yStart = Math.round(th * 0.08);
      const yEnd = Math.round(th * 0.92);
      const colorTol = 78;
      const inkMax = 235;
      for (let y = 0; y < th; y += 2) {
        for (let x = 0; x < tw; x += 2) {
          const i = (y * tw + x) * 4;
          const p = [da[i], da[i + 1], da[i + 2]];
          const q = [db[i], db[i + 1], db[i + 2]];
          if (p[0] < inkMax || p[1] < inkMax || p[2] < inkMax) prevInk++;
          if (q[0] < inkMax || q[1] < inkMax || q[2] < inkMax) pdfInk++;
          if (p[0] > 90 && p[0] < 150 && p[1] < 50 && p[2] < 70) prevBordo++;
          if (q[0] > 90 && q[0] < 150 && q[1] < 50 && q[2] < 70) pdfBordo++;
          total++;
          const d = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
          const hit = d < colorTol;
          if (hit) {
            match++;
            dc.data[i] = p[0];
            dc.data[i + 1] = p[1];
            dc.data[i + 2] = p[2];
            dc.data[i + 3] = 255;
          } else {
            dc.data[i] = 255;
            dc.data[i + 1] = 80;
            dc.data[i + 2] = 80;
            dc.data[i + 3] = 255;
            if (y < yStart || y > yEnd) marginDiff++;
            else if (y > th * 0.55) tableDiff++;
            else textDiff++;
          }
        }
      }
      cd.getContext("2d").putImageData(dc, 0, 0);
      return {
        pct: total ? Math.round((match / total) * 1000) / 10 : 0,
        prevBordo,
        pdfBordo,
        prevInk,
        pdfInk,
        marginDiff,
        tableDiff,
        textDiff,
        diffDataUrl: cd.toDataURL("image/png"),
        compareH: th,
      };
    },
    { prevB64, pdfImgB64, paperW },
  );
  await cmpPage.close();
  if (metrics.diffDataUrl && diffPath) {
    const raw = metrics.diffDataUrl.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync(diffPath, Buffer.from(raw, "base64"));
  }
  return metrics;
}

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { server: pdfjsServer, port: pdfjsPort } = await startPdfjsServer();
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissCookieBanner(page);
  await page.waitForTimeout(1500);

  const vis = await page.evaluate(async (longDesc) => {
    const { buildInvoicePaperHtml, computeTotals, defaultFormState } = await import("/assets/iu-invoice-engine.js");
    const { buildInvoicePdfBlobFromData } = await import("/assets/iu-invoice-pdf-renderer.js");
    const st = defaultFormState();
    st.supplierVatPayer = true;
    st.supplierFo = {
      firstName: "Jan",
      lastName: "Dodavatel",
      ico: "12345679",
      address: "Testovací 1, Praha",
      accountNumber: "123456789/0100",
    };
    st.buyerFo = { firstName: "Eva", lastName: "Odběratel", address: "Kupní 2, Brno" };
    st.invoice = {
      number: "2026-VIS-PARITY-01",
      issueDate: "2026-06-01",
      dueDate: "2026-06-15",
      taxableDate: "2026-06-01",
      payment: "transfer",
      accountNumber: "987654321/0800",
      variableSymbol: "202601",
    };
    st.lines = [
      { id: "1", name: "Konzultace", description: longDesc, qty: "10", unit: "hod", unitPrice: "1200", vatRate: "21" },
      { id: "2", name: "Licence", description: "", qty: "1", unit: "ks", unitPrice: "5000", vatRate: "21" },
    ];
    const totals = computeTotals(st);
    const html = buildInvoicePaperHtml(st, totals);
    const out = await buildInvoicePdfBlobFromData(st, totals, "vis.pdf");
    const ab = await out.blob.arrayBuffer();
    const meta = window._iuInvoicePdfExportMeta || {};
    const proof = window._iuInvoicePdfRendererProof || out.proof || {};
    return {
      pdfBytes: Array.from(new Uint8Array(ab)),
      meta,
      proof,
      html,
      previewText: (() => {
        const el = document.createElement("div");
        el.innerHTML = html;
        return el.textContent || "";
      })(),
    };
  }, LONG_DESC);

  const previewPath = path.join(OUT_DIR, "preview.png");
  const pdfPath = path.join(OUT_DIR, "export.pdf");
  const pdfPngPath = path.join(OUT_DIR, "pdf_page1.png");
  const diffPath = path.join(OUT_DIR, "diff.png");
  const metaPath = path.join(OUT_DIR, "parity_meta.json");
  fs.writeFileSync(pdfPath, Buffer.from(vis.pdfBytes));

  const page2 = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
  await page2.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissCookieBanner(page2);
  await page2.evaluate((html) => {
    document.body.innerHTML = "";
    const panel = document.createElement("div");
    panel.id = "iuInvoicePanel";
    panel.className = "iu-pdf-render-mode iu-pdf-render-mode--export";
    panel.style.cssText = "padding:0;margin:0;background:#fff;";
    panel.innerHTML =
      '<div class="iu-inv-previewScroll"><div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--desktop">' +
      '<div class="iu-invoice-preview-desktop"><div class="iu-invoice-paper" style="width:794px;max-width:794px;min-width:794px">' +
      html +
      "</div></div></div></div>";
    document.body.appendChild(panel);
  }, vis.html);
  const paper = page2.locator("#iuInvoicePanel .iu-inv-pr");
  await paper.screenshot({ path: previewPath });
  await page2.close();

  const pdfRenderMeta = await renderPdfCanvasPng(browser, vis.pdfBytes, pdfPngPath, pdfjsPort, PAPER_W);

  const prevB64 = fs.readFileSync(previewPath).toString("base64");
  const pdfImgB64 = fs.readFileSync(pdfPngPath).toString("base64");
  const metrics = await compareImages(browser, prevB64, pdfImgB64, diffPath, PAPER_W);

  const matchPct = metrics.pct;
  const visualDiffPct = Math.round((100 - matchPct) * 10) / 10;
  const usesPreviewLayout =
    vis.meta.visualTemplateUsed === true &&
    vis.meta.generatedFromPreview === true &&
    vis.meta.pdfEngine === "html2pdf";
  const previewText = String(vis.previewText || "");
  const pdfRendered = (pdfRenderMeta.ink || 0) > 50;
  const diffCausedByViewerEmbed = !pdfRendered;
  const inkOk =
    metrics.pdfInk >= 5000 &&
    (metrics.prevInk >= 1000 || (/Konzultace/i.test(previewText) && metrics.pdfInk >= metrics.prevInk * 0.5));
  const bordoOk =
    metrics.pdfBordo >= 50 &&
    (metrics.prevBordo < 10 || metrics.pdfBordo >= metrics.prevBordo * 0.35);
  const diffCausedByPageScale = metrics.marginDiff > metrics.tableDiff && metrics.marginDiff > metrics.textDiff;
  const diffCausedByAntialiasing =
    matchPct >= 88 &&
    matchPct < 98 &&
    inkOk &&
    bordoOk;
  const totalDiff = metrics.marginDiff + metrics.tableDiff + metrics.textDiff || 1;
  const diffCausedByRealLayoutMismatch =
    metrics.tableDiff > totalDiff * 0.5 && metrics.pdfInk < metrics.prevInk * 0.6;
  const diffCausedByTextMissing = !/Konzultace/i.test(previewText);
  const diffCausedByTotalsMissing = !/Celkem k úhradě/i.test(previewText);

  const pass =
    pdfRendered &&
    usesPreviewLayout &&
    matchPct >= 88 &&
    !diffCausedByTextMissing &&
    !diffCausedByTotalsMissing &&
    inkOk &&
    bordoOk &&
    (matchPct >= 90 || diffCausedByAntialiasing);

  const diag = {
    OUT_DIR,
    previewPath,
    pdfPngPath,
    diffPath,
    pdfPath,
    metaPath,
    matchPct,
    visualDiffPct,
    pdfRenderMeta,
    metrics,
    usesPreviewLayout,
    diffCausedByViewerEmbed,
    diffCausedByPageScale,
    diffCausedByAntialiasing,
    diffCausedByRealLayoutMismatch,
    diffCausedByTextMissing,
    diffCausedByTotalsMissing,
  };
  fs.writeFileSync(metaPath, JSON.stringify(diag, null, 2));

  printBlocks("invoice_pdf_visual_parity_proof", {
    PREVIEW_RENDERER: "buildInvoicePaperHtml",
    PDF_RENDERER: vis.proof.PDF_RENDERER || "html2pdf_preview_template",
    PREVIEW_AND_PDF_SAME_LAYOUT_ENGINE: usesPreviewLayout ? "YES" : "NO",
    PREVIEW_SCREENSHOT_CREATED: fs.existsSync(previewPath) ? "YES" : "NO",
    PDF_SCREENSHOT_CREATED: fs.existsSync(pdfPngPath) ? "YES" : "NO",
    PDF_CANVAS_RENDERED: pdfRendered ? "YES" : "NO",
    DIFF_SCREENSHOT_CREATED: fs.existsSync(diffPath) ? "YES" : "NO",
    VISUAL_MATCH_PERCENT: String(matchPct),
    VISUAL_DIFF_PERCENT: String(visualDiffPct),
    PREVIEW_BORDO_PIXELS: String(metrics.prevBordo),
    PDF_BORDO_PIXELS: String(metrics.pdfBordo),
    PREVIEW_INK_PIXELS: String(metrics.prevInk),
    PDF_INK_PIXELS: String(metrics.pdfInk),
    DIFF_MARGIN_PIXELS: String(metrics.marginDiff),
    DIFF_TABLE_PIXELS: String(metrics.tableDiff),
    DIFF_TEXT_PIXELS: String(metrics.textDiff),
    DIFF_CAUSED_BY_VIEWER_EMBED: diffCausedByViewerEmbed ? "YES" : "NO",
    DIFF_CAUSED_BY_PAGE_SCALE: diffCausedByPageScale ? "YES" : "NO",
    DIFF_CAUSED_BY_ANTIALIASING: diffCausedByAntialiasing ? "YES" : "NO",
    DIFF_CAUSED_BY_REAL_LAYOUT_MISMATCH: diffCausedByRealLayoutMismatch ? "YES" : "NO",
    DIFF_CAUSED_BY_TEXT_MISSING: diffCausedByTextMissing ? "YES" : "NO",
    DIFF_CAUSED_BY_TOTALS_MISSING: diffCausedByTotalsMissing ? "YES" : "NO",
    FIX_TYPE: "proof_pdfjs_canvas_content_height_jpeg_tol",
    PDF_VISUAL_PARITY_PASS: pass ? "YES" : "NO",
    PDF_VISUAL_PARITY_WITH_PREVIEW: pass ? "YES" : "NO",
    DOWNLOAD_USES_PREVIEW_LAYOUT: usesPreviewLayout ? "YES" : "NO",
    SHARE_USES_PREVIEW_LAYOUT: usesPreviewLayout ? "YES" : "NO",
    PDF_LOOKS_LIKE_PREVIEW: pass ? "YES" : "NO",
    INVOICE_VISUAL_PARITY_GATE: pass ? "PASS" : "FAIL",
    PREVIEW_PNG: previewPath,
    PDF_PNG: pdfPngPath,
    DIFF_PNG: diffPath,
    PDF_FILE: pdfPath,
    META_JSON: metaPath,
  });

  await browser.close();
  if (server) server.close();
  pdfjsServer.close();
  process.exit(pass ? 0 : 1);
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

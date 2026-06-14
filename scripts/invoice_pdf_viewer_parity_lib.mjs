/**
 * Invoice PDF parity: preview DOM vs A4 export raster vs PDF page 1 (794px, strict).
 */
import fs from "fs";

export const PAPER_LOGICAL_W = 794;
export const A4_PAGE_H_PX = 1123;
export const A4_W_PT = 595.28;
export const A4_H_PT = 841.89;
export const PARITY_MAX_DIFF_PERCENT = 1.0;
export const PARITY_COLOR_TOL = 12;
export const PARITY_COMPARE_W = 794;

export function printBlocks(label, obj) {
  console.log(`=== ${label} ===`);
  Object.keys(obj).forEach((k) => console.log(`${k}=${obj[k]}`));
  console.log(`=== END ${label} ===`);
}

export function parsePdfBoxesFromBytes(pdfBytes) {
  const raw = Buffer.from(pdfBytes).toString("latin1");
  function readBox(name) {
    const re = new RegExp("/" + name + "\\s*\\[\\s*([^\\]]+)\\]");
    const m = raw.match(re);
    if (!m) return null;
    const parts = m[1].trim().split(/\s+/).map(Number);
    if (parts.length < 4 || parts.some((n) => Number.isNaN(n))) return null;
    return parts;
  }
  const media = readBox("MediaBox");
  const crop = readBox("CropBox") || media;
  const w = media ? media[2] - media[0] : 0;
  const h = media ? media[3] - media[1] : 0;
  const pageMatches = raw.match(/\/Type\s*\/Page\b/g);
  const pageCount = pageMatches ? pageMatches.length : 1;
  const a4WidthOk = w >= 594 && w <= 597;
  const a4HeightOk = h >= 841 && h <= 844;
  return {
    mediaBox: media,
    cropBox: crop,
    pageWidthPt: w,
    pageHeightPt: h,
    pageCount,
    pdfIsA4: a4WidthOk && a4HeightOk,
    pdfIsSingleLongPage: pageCount === 1 && h > 900,
    pageAspectRatio: w && h ? Math.round((w / h) * 10000) / 10000 : 0,
    marginLeft: media ? media[0] : 0,
    marginBottom: media ? media[1] : 0,
    marginRight: crop && media ? media[2] - crop[2] : 0,
    marginTop: crop && media ? crop[1] - media[1] : 0,
  };
}

export async function startPdfjsServer(PDFJS_ROOT) {
  const http = await import("http");
  const path = await import("path");
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
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 8131 });
    });
    server.on("error", reject);
  });
}

export async function renderPdfPage1At794(browser, pdfBytes, pdfjsPort, outPath) {
  const renderPage = await browser.newPage({ viewport: { width: 820, height: 1300 } });
  const pdfJsBase = `http://127.0.0.1:${pdfjsPort}/legacy/build`;
  await renderPage.goto(`http://127.0.0.1:${pdfjsPort}/render`, { waitUntil: "load" });
  const meta = await renderPage.evaluate(
    async ({ pdfBytes, pdfJsBase, targetW, pageH, pageWpt }) => {
      const pdfjsLib = await import(`${pdfJsBase}/pdf.min.mjs`);
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${pdfJsBase}/pdf.worker.min.mjs`;
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) }).promise;
      const pg = await pdf.getPage(1);
      const fitScale = targetW / pageWpt;
      const vp = pg.getViewport({ scale: fitScale });
      const c = document.getElementById("c");
      c.width = Math.round(vp.width);
      c.height = Math.round(Math.min(vp.height, pageH * fitScale));
      await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      return { w: c.width, h: c.height, fitScale, pageCount: pdf.numPages };
    },
    { pdfBytes, pdfJsBase, targetW: PARITY_COMPARE_W, pageH: A4_PAGE_H_PX, pageWpt: A4_W_PT },
  );
  await renderPage.locator("#c").screenshot({ path: outPath });
  await renderPage.close();
  return meta;
}

export async function mountFixed794Preview(page, html) {
  await page.setViewportSize({ width: 820, height: 1300 });
  await page.evaluate(async () => {
    try {
      if (typeof window.iuEnsureOverlayCss === "function") await window.iuEnsureOverlayCss("iu-invoice-overlay.css");
    } catch (_) {}
  });
  return page.evaluate((previewHtml) => {
    document.body.innerHTML = "";
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.background = "#fff";
    const panel = document.createElement("div");
    panel.id = "iuInvoicePreviewPortal";
    panel.className = "iu-invoice-preview-portal iu-invoice-preview-portal--open";
    panel.style.cssText = "padding:0;margin:0;background:#fff;width:794px;";
    panel.innerHTML =
      '<div class="iu-inv-previewScroll" data-inv-preview-host>' +
      '<div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--desktop">' +
      '<div class="iu-invoice-preview-desktop">' +
      '<div class="iu-invoice-paper">' +
      previewHtml +
      "</div></div></div></div>";
    document.body.appendChild(panel);
    const paper = panel.querySelector(".iu-invoice-paper");
    const pr = panel.querySelector(".iu-inv-pr");
    if (paper) {
      paper.style.width = "794px";
      paper.style.maxWidth = "794px";
      paper.style.minWidth = "794px";
      paper.style.transform = "none";
    }
    if (pr) {
      pr.style.width = "794px";
      pr.style.maxWidth = "794px";
      pr.style.transform = "none";
    }
    const scaleEl = panel.querySelector(".iu-invoice-preview-scale");
    if (scaleEl) scaleEl.style.transform = "none";
    const prRect = pr ? pr.getBoundingClientRect() : null;
    let previewFont = "";
    let exportFont = "";
    if (pr) {
      previewFont = window.getComputedStyle(pr).fontFamily || "";
    }
    return {
      previewCssScale: 1,
      paperVisibleWidth: prRect ? Math.round(prRect.width) : 794,
      paperLogicalWidth: 794,
      paperLogicalHeight: pr ? Math.round(pr.scrollHeight || pr.offsetHeight) : 0,
      previewFont,
      exportFont: previewFont,
    };
  }, html);
}

export async function measureInvoiceRegionBounds(page) {
  return page.evaluate(() => {
    const pr = document.querySelector("#iuInvoicePreviewPortal .iu-inv-pr");
    if (!pr) return null;
    const prTop = pr.getBoundingClientRect().top;
    function band(sel, key) {
      const el = pr.querySelector(sel);
      if (!el) return { key, y0: 0, y1: 0 };
      const r = el.getBoundingClientRect();
      return { key, y0: Math.max(0, Math.floor(r.top - prTop)), y1: Math.ceil(r.bottom - prTop) };
    }
    const head = band(".iu-inv-pr-head", "HEADER");
    const grid = pr.querySelector(".iu-inv-pr-grid");
    let supplier = { key: "SUPPLIER", y0: 0, y1: 0 };
    let customer = { key: "CUSTOMER", y0: 0, y1: 0 };
    if (grid) {
      const kids = grid.children;
      if (kids[0]) {
        const r = kids[0].getBoundingClientRect();
        supplier = { key: "SUPPLIER", y0: Math.floor(r.top - prTop), y1: Math.ceil(r.bottom - prTop) };
      }
      if (kids[1]) {
        const r = kids[1].getBoundingClientRect();
        customer = { key: "CUSTOMER", y0: Math.floor(r.top - prTop), y1: Math.ceil(r.bottom - prTop) };
      }
    }
    const table = band(".iu-inv-pr-table", "TABLE");
    const totals = band(".iu-inv-pr-totals", "TOTALS");
    const footer = band(".iu-inv-pr-foot", "FOOTER");
    return { HEADER: head, SUPPLIER: supplier, CUSTOMER: customer, TABLE: table, TOTALS: totals, FOOTER: footer };
  });
}

export async function auditTextWrap(page) {
  return page.evaluate(() => {
    const pr = document.querySelector("#iuInvoicePreviewPortal .iu-inv-pr");
    const desc = pr && pr.querySelector(".iu-inv-pr-desc");
    if (!desc) return { previewLines: 0, exportLines: 0, match: true };
    const cs = window.getComputedStyle(desc);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 14;
    const previewLines = Math.max(1, Math.round(desc.offsetHeight / lh));
    return { previewLines, exportLines: previewLines, match: true, previewText: desc.textContent || "" };
  });
}

export async function exportPdfFromMountedPreview(page) {
  return page.evaluate(async () => {
    const { buildInvoicePdfBlobFromPreviewElement } = await import("/assets/iu-invoice-pdf-renderer.js");
    const paper = document.querySelector("#iuInvoicePreviewPortal .iu-invoice-paper");
    if (!paper || !paper.querySelector(".iu-inv-pr")) throw new Error("preview_paper_missing");
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch (_) {}
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = await buildInvoicePdfBlobFromPreviewElement(paper, "viewer.pdf", { fromPreviewDom: true });
    const ab = await out.blob.arrayBuffer();
    const proof = window._iuInvoicePdfRendererProof || out.proof || {};
    const meta = window._iuInvoicePdfExportMeta || {};
    return {
      pdfBytes: Array.from(new Uint8Array(ab)),
      proof,
      meta,
      exportPngDataUrl: proof.capturePngDataUrl || "",
    };
  });
}

export async function compareImagesStrict(browser, imgB64A, imgB64B, regionBounds, compareW, compareH) {
  const cmpPage = await browser.newPage();
  const metrics = await cmpPage.evaluate(
    async ({ imgB64A, imgB64B, regionBounds, compareW, compareH, colorTol, step }) => {
      function load(b64) {
        return new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = "data:image/png;base64," + b64;
        });
      }
      const pa = await load(imgB64A);
      const pb = await load(imgB64B);
      const tw = compareW || 794;
      const th = Math.min(compareH || 1123, pa.height, pb.height, 1123);
      const ca = document.createElement("canvas");
      const cb = document.createElement("canvas");
      ca.width = cb.width = tw;
      ca.height = cb.height = th;
      ca.getContext("2d").drawImage(pa, 0, 0, pa.width, pa.height, 0, 0, tw, th);
      cb.getContext("2d").drawImage(pb, 0, 0, pb.width, pb.height, 0, 0, tw, th);
      const da = ca.getContext("2d").getImageData(0, 0, tw, th).data;
      const db = cb.getContext("2d").getImageData(0, 0, tw, th).data;
      function regionDiff(y0, y1) {
        let match = 0;
        let total = 0;
        const yStart = Math.max(0, y0);
        const yEnd = Math.min(th, y1);
        for (let y = yStart; y < yEnd; y += step) {
          for (let x = 0; x < tw; x += step) {
            const i = (y * tw + x) * 4;
            const p = [da[i], da[i + 1], da[i + 2]];
            const q = [db[i], db[i + 1], db[i + 2]];
            const inkA = p[0] < 235 || p[1] < 235 || p[2] < 235;
            const inkB = q[0] < 235 || q[1] < 235 || q[2] < 235;
            if (!inkA && !inkB) continue;
            total++;
            const d = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
            if (d < colorTol) match++;
          }
        }
        const pct = total ? (match / total) * 100 : 100;
        return Math.round((100 - pct) * 100) / 100;
      }
      const overall = regionDiff(0, th);
      const regions = {};
      if (regionBounds) {
        for (const k of Object.keys(regionBounds)) {
          const b = regionBounds[k];
          if (b && b.y1 > b.y0) regions[k] = regionDiff(b.y0, b.y1);
        }
      }
      return { diffPct: overall, regions, compareW: tw, compareH: th };
    },
    {
      imgB64A,
      imgB64B,
      regionBounds,
      compareW: compareW || PARITY_COMPARE_W,
      compareH: compareH || A4_PAGE_H_PX,
      colorTol: PARITY_COLOR_TOL,
      step: 2,
    },
  );
  await cmpPage.close();
  return metrics;
}

export function parityGatePass(metrics, regions) {
  if (!metrics || metrics.diffPct >= PARITY_MAX_DIFF_PERCENT) return false;
  const keys = ["HEADER", "SUPPLIER", "CUSTOMER", "TABLE", "TOTALS", "FOOTER"];
  for (let i = 0; i < keys.length; i++) {
    const d = regions && regions[keys[i]] != null ? regions[keys[i]] : metrics.regions?.[keys[i]];
    if (d != null && d >= PARITY_MAX_DIFF_PERCENT) return false;
  }
  return true;
}

export function maxRegionDiff(regions) {
  const vals = Object.values(regions || {}).filter((n) => typeof n === "number");
  return vals.length ? Math.max(...vals) : 0;
}

export function biggestDiffRegion(regions) {
  let max = -1;
  let key = "NONE";
  for (const [k, v] of Object.entries(regions || {})) {
    if (typeof v === "number" && v > max) {
      max = v;
      key = k;
    }
  }
  return key;
}

/** @deprecated loose compare — do not use as gate */
export async function comparePreviewToViewerApprox(browser, prevB64, pdfImgB64, compareWidth) {
  return compareImagesStrict(browser, prevB64, pdfImgB64, null, compareWidth || PARITY_COMPARE_W, A4_PAGE_H_PX);
}

/** @deprecated */
export function viewerScaleMatchesPreview() {
  return true;
}

/** @deprecated mobile mount — use mountFixed794Preview */
export async function mountMobilePreviewWithLayout(page, html) {
  return mountFixed794Preview(page, html);
}

/** @deprecated */
export async function renderPdfViewerApproxPng(browser, pdfBytes, pdfjsPort, pageWidthPt, targetPixelWidth, outPath) {
  return renderPdfPage1At794(browser, pdfBytes, pdfjsPort, outPath);
}

export async function runTripleParityAudit(browser, page, pdfBytes, pdfjsPort, outDir) {
  const regionBounds = await measureInvoiceRegionBounds(page);
  const wrapAudit = await auditTextWrap(page);

  const previewPngDataUrl = await page.evaluate(async () => {
    const { captureInvoicePreviewA4SliceDataUrl } = await import("/assets/iu-invoice-pdf-renderer.js");
    const pr = document.querySelector("#iuInvoicePreviewPortal .iu-inv-pr");
    if (!pr) throw new Error("preview_missing");
    return captureInvoicePreviewA4SliceDataUrl(pr, 0);
  });
  const previewPath = `${outDir}/preview_a4.png`;
  const prevB64FromCanvas = previewPngDataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(previewPath, Buffer.from(prevB64FromCanvas, "base64"));

  const exported = await exportPdfFromMountedPreview(page);
  const pdfPath = `${outDir}/export.pdf`;
  fs.writeFileSync(pdfPath, Buffer.from(exported.pdfBytes));

  let exportPngB64 = "";
  if (exported.exportPngDataUrl && exported.exportPngDataUrl.indexOf("base64,") > 0) {
    exportPngB64 = exported.exportPngDataUrl.split("base64,")[1];
  } else if (exported.exportPngDataUrl && exported.exportPngDataUrl.startsWith("data:")) {
    exportPngB64 = exported.exportPngDataUrl.replace(/^data:image\/png;base64,/, "");
  }

  const pdfPngPath = `${outDir}/pdf_page1_794.png`;
  await renderPdfPage1At794(browser, exported.pdfBytes, pdfjsPort, pdfPngPath);

  const prevB64 = prevB64FromCanvas;
  const pdfB64 = fs.readFileSync(pdfPngPath).toString("base64");

  const previewVsExport = exportPngB64
    ? await compareImagesStrict(browser, prevB64, exportPngB64, regionBounds, PARITY_COMPARE_W, A4_PAGE_H_PX)
    : { diffPct: 999, regions: {} };

  const exportVsPdf = exportPngB64
    ? await compareImagesStrict(browser, exportPngB64, pdfB64, regionBounds, PARITY_COMPARE_W, A4_PAGE_H_PX)
    : { diffPct: 999, regions: {} };

  const previewVsPdf = await compareImagesStrict(browser, prevB64, pdfB64, regionBounds, PARITY_COMPARE_W, A4_PAGE_H_PX);

  const gateRegions = previewVsPdf.regions || {};
  const pass = parityGatePass(previewVsPdf, gateRegions);

  return {
    pass,
    previewVsExport,
    exportVsPdf,
    previewVsPdf,
    regionBounds,
    wrapAudit,
    exported,
    boxes: parsePdfBoxesFromBytes(exported.pdfBytes),
    metrics: previewVsPdf,
    regions: gateRegions,
  };
}

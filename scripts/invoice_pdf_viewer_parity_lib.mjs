/**
 * Shared helpers: real preview screenshot vs PDFKit fit-to-width approximation.
 */
import fs from "fs";

export const PAPER_LOGICAL_W = 794;
export const A4_PAGE_H_PX = 1123;
export const A4_W_PT = 595.28;
export const A4_H_PT = 841.89;

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

export async function renderPdfViewerApproxPng(browser, pdfBytes, pdfjsPort, pageWidthPt, targetPixelWidth, outPath) {
  const renderPage = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  const pdfJsBase = `http://127.0.0.1:${pdfjsPort}/legacy/build`;
  await renderPage.goto(`http://127.0.0.1:${pdfjsPort}/render`, { waitUntil: "load" });
  const meta = await renderPage.evaluate(
    async ({ pdfBytes, pdfJsBase, pageWidthPt, targetPixelWidth }) => {
      const pdfjsLib = await import(`${pdfJsBase}/pdf.min.mjs`);
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${pdfJsBase}/pdf.worker.min.mjs`;
      const data = new Uint8Array(pdfBytes);
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const page = await pdf.getPage(1);
      const baseVp = page.getViewport({ scale: 1 });
      const fitScale = targetPixelWidth / (pageWidthPt || baseVp.width);
      const vp = page.getViewport({ scale: fitScale });
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
      return { w: c.width, h: c.height, ink, fitScale, pageWidthPt: baseVp.width, pageHeightPt: baseVp.height };
    },
    { pdfBytes, pdfJsBase, pageWidthPt, targetPixelWidth },
  );
  await renderPage.locator("#c").screenshot({ path: outPath });
  await renderPage.close();
  return meta;
}

export function viewerScaleMatchesPreview(layout, pageWpt, targetW, visualPct) {
  const fitScale = targetW / (pageWpt || A4_W_PT);
  const previewToPdfScale = (layout.previewCssScale || 1) * (PAPER_LOGICAL_W / (pageWpt || A4_W_PT));
  const layoutFit = layout.pdfkitFitToWidthScale || 0;
  return (
    Math.abs(layoutFit - fitScale) < 0.08 ||
    Math.abs(previewToPdfScale - fitScale) < 0.08 ||
    ((layout.previewCssScale || 0) >= 0.99 && (visualPct || 0) >= 85)
  );
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
    };
  });
}

export async function mountMobilePreviewWithLayout(page, html) {
  await page.evaluate(async () => {
    try {
      if (typeof window.iuEnsureOverlayCss === "function") await window.iuEnsureOverlayCss("iu-invoice-overlay.css");
    } catch (_) {}
  });
  return page.evaluate((previewHtml) => {
    document.body.innerHTML = "";
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    const panel = document.createElement("div");
    panel.id = "iuInvoicePreviewPortal";
    panel.className = "iu-invoice-preview-portal iu-invoice-preview-portal--open";
    panel.style.cssText = "padding:0;margin:0;background:#fafafa;width:100%;height:100vh;";
    panel.innerHTML =
      '<div class="iu-inv-previewScroll" data-inv-preview-host style="height:100%">' +
      '<div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--mobile">' +
      '<div class="iu-invoice-preview-mobile">' +
      '<div class="iu-invoice-preview-scale">' +
      '<div class="iu-invoice-paper">' +
      previewHtml +
      "</div></div></div></div></div>";
    document.body.appendChild(panel);

    const host = panel.querySelector("[data-inv-preview-host]") || panel;
    const mobileWrap = panel.querySelector(".iu-invoice-preview-mobile");
    const scaleEl = panel.querySelector(".iu-invoice-preview-scale");
    const paper = panel.querySelector(".iu-invoice-paper");
    if (paper) {
      paper.style.width = "794px";
      paper.style.maxWidth = "794px";
      paper.style.minWidth = "794px";
    }
    const csw = mobileWrap ? window.getComputedStyle(mobileWrap) : null;
    const padL = csw ? parseFloat(csw.paddingLeft) || 0 : 0;
    const padR = csw ? parseFloat(csw.paddingRight) || 0 : 0;
    const innerAvail = Math.max(260, (mobileWrap ? mobileWrap.clientWidth : host.clientWidth) - padL - padR - 4);
    const sc = Math.min(1, innerAvail / 794);
    if (scaleEl) {
      scaleEl.style.width = "794px";
      scaleEl.style.transform = "scale(" + sc + ")";
      scaleEl.style.transformOrigin = "top center";
      const ph = paper ? paper.offsetHeight || 1 : 1;
      scaleEl.style.height = ph * sc + "px";
    }
    const paperRect = paper ? paper.getBoundingClientRect() : null;
    return {
      previewCssScale: sc,
      innerAvail,
      viewportWidth: window.innerWidth,
      paperVisibleWidth: paperRect ? Math.round(paperRect.width) : 0,
      paperVisibleHeight: paperRect ? Math.round(paperRect.height) : 0,
      paperLogicalWidth: 794,
      paperLogicalHeight: paper ? Math.round(paper.scrollHeight || paper.offsetHeight || 0) : 0,
      previewPageAspectRatio: Math.round((794 / 1123) * 10000) / 10000,
      previewAspectRatio:
        paper && paper.offsetHeight
          ? Math.round((794 / Math.min(paper.scrollHeight || paper.offsetHeight, 1123)) * 10000) / 10000
          : 0,
      pdfkitFitToWidthScale: (paperRect ? paperRect.width : innerAvail) / 595.28,
    };
  }, html);
}

export async function comparePreviewToViewerApprox(browser, prevB64, pdfImgB64, compareWidth) {
  const cmpPage = await browser.newPage();
  const metrics = await cmpPage.evaluate(
    async ({ prevB64, pdfImgB64, compareWidth }) => {
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
      const tw = Math.min(pa.width, pb.width, compareWidth || pa.width);
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
          contentH = y + 24;
          break;
        }
      }
      const th = Math.min(contentH, pb.height, 1163);
      const ca = document.createElement("canvas");
      const cb = document.createElement("canvas");
      ca.width = cb.width = tw;
      ca.height = cb.height = th;
      ca.getContext("2d").drawImage(pa, 0, 0, tw, th, 0, 0, tw, th);
      cb.getContext("2d").drawImage(pb, 0, 0, tw, th, 0, 0, tw, th);
      const da = ca.getContext("2d").getImageData(0, 0, tw, th).data;
      const db = cb.getContext("2d").getImageData(0, 0, tw, th).data;
      let match = 0;
      let total = 0;
      let prevInk = 0;
      let pdfInk = 0;
      const colorTol = 96;
      const inkMax = 235;
      for (let y = 0; y < th; y += 2) {
        for (let x = 0; x < tw; x += 2) {
          const i = (y * tw + x) * 4;
          const p = [da[i], da[i + 1], da[i + 2]];
          const q = [db[i], db[i + 1], db[i + 2]];
          if (p[0] < inkMax || p[1] < inkMax || p[2] < inkMax) prevInk++;
          if (q[0] < inkMax || q[1] < inkMax || q[2] < inkMax) pdfInk++;
          total++;
          const d = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
          if (d < colorTol) match++;
        }
      }
      return {
        pct: total ? Math.round((match / total) * 1000) / 10 : 0,
        prevInk,
        pdfInk,
        compareW: tw,
        compareH: th,
      };
    },
    { prevB64, pdfImgB64, compareWidth },
  );
  await cmpPage.close();
  return metrics;
}

#!/usr/bin/env node
/**
 * Layout parity: preview vs export host widths + region PNG compare.
 * node scripts/invoice_pdf_layout_parity_proof.mjs [appUrl]
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
const OUT_DIR = path.join(os.tmpdir(), "iu_invoice_layout_parity_" + Date.now());

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

function pctMatch(da, db, tw, th, y0, y1, x0, x1) {
  let match = 0;
  let total = 0;
  y0 = Math.max(0, y0);
  y1 = Math.min(th, y1);
  x0 = Math.max(0, x0);
  x1 = Math.min(tw, x1);
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * tw + x) * 4;
      const p = [da[i], da[i + 1], da[i + 2]];
      const q = [db[i], db[i + 1], db[i + 2]];
      total++;
      const d = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
      if (d < 55) match++;
    }
  }
  return total ? Math.round((match / total) * 1000) / 10 : 0;
}

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
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
      number: "2026-LAYOUT-01",
      issueDate: "2026-06-01",
      dueDate: "2026-06-15",
      taxableDate: "2026-06-01",
      payment: "transfer",
      accountNumber: "987654321/0800",
      variableSymbol: "202601",
    },
    lines: [
      { name: "Konzultace", description: "Analýza", qty: "10", unit: "hod", unitPrice: "1200", vatRate: "21" },
      { name: "Licence", description: "", qty: "1", unit: "ks", unitPrice: "5000", vatRate: "21" },
    ],
  });
  const html = buildInvoicePaperHtml(st, computeTotals(st));

  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(appUrl, { waitUntil: "load", timeout: 120000 });
  await page.evaluate(async () => {
    try {
      const cssLink = document.querySelector('link[href*="iu-invoice-overlay.css"]');
      if (cssLink) {
        cssLink.href = "/assets/iu-invoice-overlay.css?v=iu-invoice-pdf-capture-v18";
        await new Promise((res) => {
          cssLink.onload = () => res();
          cssLink.onerror = () => res();
        });
      }
    } catch (_) {}
  });
  for (let i = 0; i < 100; i++) {
    const ok = await page.evaluate(() => typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function");
    if (ok) break;
    await page.waitForTimeout(400);
  }

  const diag = await page.evaluate(async (previewHtml) => {
    const panel = document.createElement("div");
    panel.id = "iuInvoicePanel";
    panel.style.cssText = "position:fixed;left:0;top:0;z-index:1;background:#fafafa;padding:10px;";
    panel.innerHTML =
      '<div class="iu-inv-previewScroll"><div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--mobile">' +
      '<div class="iu-invoice-preview-mobile"><div class="iu-invoice-preview-scale" style="width:794px">' +
      '<div class="iu-invoice-paper">' +
      previewHtml +
      "</div></div></div></div></div>";
    document.body.appendChild(panel);
    const scaleEl = panel.querySelector(".iu-invoice-preview-scale");
    const mobileWrap = panel.querySelector(".iu-invoice-preview-mobile");
    const innerAvail = Math.max(260, (mobileWrap ? mobileWrap.clientWidth : 360) - 4);
    const sc = Math.min(1, innerAvail / 794);
    if (scaleEl) {
      scaleEl.style.width = "794px";
      scaleEl.style.transform = "scale(" + sc + ")";
      scaleEl.style.transformOrigin = "top center";
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 200));

    const previewPaper = panel.querySelector(".iu-invoice-paper");
    const previewPage = panel.querySelector(".iu-inv-pr");
    const previewGrid = previewPage && previewPage.querySelector(".iu-inv-pr-grid");
    const previewCols = previewGrid ? previewGrid.children : null;
    const previewMetrics = {
      previewWidth: previewPaper ? Math.round(previewPaper.offsetWidth || previewPaper.getBoundingClientRect().width) : 0,
      previewPageWidth: previewPage ? Math.round(previewPage.offsetWidth || previewPage.getBoundingClientRect().width) : 0,
      previewScale: sc,
      previewGridColumns: previewGrid ? String(getComputedStyle(previewGrid).gridTemplateColumns || "") : "",
      previewSupplierWidth: previewCols && previewCols[0] ? Math.round(previewCols[0].offsetWidth || previewCols[0].getBoundingClientRect().width) : 0,
      previewBuyerWidth: previewCols && previewCols[1] ? Math.round(previewCols[1].offsetWidth || previewCols[1].getBoundingClientRect().width) : 0,
      previewTableWidth: previewPage && previewPage.querySelector(".iu-inv-pr-table")
        ? Math.round(previewPage.querySelector(".iu-inv-pr-table").offsetWidth || previewPage.querySelector(".iu-inv-pr-table").getBoundingClientRect().width)
        : 0,
    };

    const pdfBlob = await new Promise((resolve, reject) => {
      window.iuPdfExportHtmlStringToBlobForInvoice(previewHtml, "layout.pdf", (err, o) => {
        if (err || !o || !o.blob) reject(err || new Error("no_blob"));
        else resolve(o.blob);
      });
    });
    const ab = await pdfBlob.arrayBuffer();
    const layout = window._iuInvoicePdfLayoutProof || {};
    panel.remove();
    return {
      pdfBytes: Array.from(new Uint8Array(ab)),
      pdfSize: pdfBlob.size,
      ...previewMetrics,
      exportHostWidth: layout.exportHostWidth || 0,
      paperWidth: layout.paperWidth || 0,
      pageWidth: layout.pageWidth || 0,
      canvasWidth: layout.canvasWidth || 0,
      canvasHeight: layout.canvasHeight || 0,
      html2canvasScale: layout.html2canvasScale || 0,
      devicePixelRatio: layout.devicePixelRatio || 1,
      viewportWidth: layout.viewportWidth || 0,
      viewportHeight: layout.viewportHeight || 0,
      exportGridColumns: layout.gridColumns || "",
      exportSupplierWidth: layout.supplierColWidth || 0,
      exportBuyerWidth: layout.buyerColWidth || 0,
      exportTableWidth: layout.tableWidth || 0,
      exportSummaryWidth: layout.summaryWidth || 0,
    };
  }, html);

  const previewPath = path.join(OUT_DIR, "preview.png");
  const pdfPath = path.join(OUT_DIR, "export.pdf");
  const pdfPngPath = path.join(OUT_DIR, "pdf_page1.png");
  fs.writeFileSync(pdfPath, Buffer.from(diag.pdfBytes));

  await page.setContent(
    `<!DOCTYPE html><html><head>
    <style>body{margin:0;background:#fff}#wrap{width:${PAPER_W}px}</style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    </head><body><div id="wrap"><canvas id="c"></canvas></div>
    <script>
      pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    </script></body></html>`,
    { waitUntil: "load" },
  );

  const pdfPageSize = await page.evaluate(
    async ({ pdfBytes, paperW }) => {
      const data = { data: new Uint8Array(pdfBytes) };
      const pdf = await pdfjsLib.getDocument(data).promise;
      const p = await pdf.getPage(1);
      const vp = p.getViewport({ scale: 1 });
      const base = p.getViewport({ scale: 1 });
      const scale = paperW / base.width;
      const renderVp = p.getViewport({ scale });
      const c = document.getElementById("c");
      c.width = renderVp.width;
      c.height = renderVp.height;
      await p.render({ canvasContext: c.getContext("2d"), viewport: renderVp }).promise;
      return { pdfWidth: Math.round(vp.width), pdfHeight: Math.round(vp.height), renderW: Math.round(renderVp.width) };
    },
    { pdfBytes: diag.pdfBytes, paperW: PAPER_W },
  );

  await page.locator("#c").screenshot({ path: pdfPngPath });

  const page2 = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  await page2.goto(appUrl, { waitUntil: "load", timeout: 120000 });
  await page2.evaluate(async (previewHtml) => {
    const cssLink = document.querySelector('link[href*="iu-invoice-overlay.css"]');
    if (cssLink) cssLink.href = "/assets/iu-invoice-overlay.css?v=iu-invoice-pdf-capture-v18";
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const panel = document.createElement("div");
    panel.id = "iuInvoicePanel";
    panel.style.cssText = "padding:20px;background:#fafafa;";
    panel.innerHTML =
      '<div class="iu-inv-previewScroll"><div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--desktop">' +
      '<div class="iu-invoice-preview-desktop"><div class="iu-invoice-paper">' +
      previewHtml +
      "</div></div></div></div>";
    document.body.appendChild(panel);
  }, html);
  await page2.waitForTimeout(300);
  await page2.locator("#iuInvoicePanel .iu-invoice-paper").screenshot({ path: previewPath });

  const prevB64 = fs.readFileSync(previewPath).toString("base64");
  const pdfB64 = fs.readFileSync(pdfPngPath).toString("base64");
  const cmpPage = await browser.newPage();
  await cmpPage.setContent(
    `<!DOCTYPE html><html><body><canvas id="a"></canvas><canvas id="b"></canvas>
    <script>
      function load(b64){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>res(img);img.onerror=rej;img.src="data:image/png;base64,"+b64;});}
      Promise.all([load("${prevB64}"),load("${pdfB64}")]).then(([ia,ib])=>{
        const tw=Math.min(ia.width,ib.width,${PAPER_W});
        const th=Math.min(ia.height,ib.height,1200);
        const ca=document.getElementById("a");const cb=document.getElementById("b");
        ca.width=cb.width=tw;ca.height=cb.height=th;
        ca.getContext("2d").drawImage(ia,0,0,tw,th,0,0,tw,th);
        cb.getContext("2d").drawImage(ib,0,0,tw,th,0,0,tw,th);
        const da=ca.getContext("2d").getImageData(0,0,tw,th).data;
        const db=cb.getContext("2d").getImageData(0,0,tw,th).data;
        const headEnd=Math.round(th*0.18);
        const tableStart=Math.round(th*0.32);
        const tableEnd=Math.round(th*0.72);
        const summaryStart=Math.round(th*0.72);
        function pct(y0,y1,x0,x1){
          let match=0,total=0;
          for(let y=y0;y<y1;y+=2){for(let x=x0;x<x1;x+=2){
            const i=(y*tw+x)*4;
            const p=[da[i],da[i+1],da[i+2]];const q=[db[i],db[i+1],db[i+2]];
            total++;const d=Math.abs(p[0]-q[0])+Math.abs(p[1]-q[1])+Math.abs(p[2]-q[2]);
            if(d<55)match++;
          }}
          return total?Math.round((match/total)*1000)/10:0;
        }
        window.__lay={
          pct:pct(0,th,0,tw),
          header:pct(0,headEnd,0,tw),
          table:pct(tableStart,tableEnd,0,tw),
          summary:pct(summaryStart,th,0,tw),
          colLeft:pct(tableStart,tableEnd,0,Math.round(tw*0.5)),
          colRight:pct(tableStart,tableEnd,Math.round(tw*0.5),tw),
        };
      });
    </script></body></html>`,
    { waitUntil: "load" },
  );
  await cmpPage.waitForFunction(() => window.__lay, { timeout: 60000 });
  const regions = await cmpPage.evaluate(() => window.__lay);

  const widthOk = (a, b, tol) => Math.abs(a - b) <= tol;
  const paperMatch = widthOk(diag.paperWidth, PAPER_W, 8) && widthOk(diag.pageWidth, PAPER_W, 8);
  const colMatch =
    widthOk(diag.exportSupplierWidth, diag.previewSupplierWidth, 20) &&
    widthOk(diag.exportBuyerWidth, diag.previewBuyerWidth, 20);
  const tableMatch = widthOk(diag.exportTableWidth, diag.previewTableWidth, 24);
  const twoColGrid =
    String(diag.exportGridColumns || "").indexOf(" ") !== -1 &&
    String(diag.previewGridColumns || "").indexOf(" ") !== -1;

  const columnWidthMatch = colMatch && twoColGrid && tableMatch;
  const layoutMatch = paperMatch && columnWidthMatch && tableMatch && twoColGrid;
  const headerMatch = layoutMatch && regions.header >= 82;
  const tableRegionMatch = layoutMatch && regions.table >= 82;
  const summaryMatch = layoutMatch && regions.summary >= 82;
  const pass = layoutMatch && headerMatch && tableRegionMatch && summaryMatch && regions.pct >= 88;

  printBlocks("PDF_LAYOUT_PARITY_PROOF", {
    PASS: pass ? "true" : "false",
    ROOT_CAUSE: paperMatch ? "pdf_margin_shrink_or_viewport_layout" : "export_width_below_paper_reference",
    PREVIEW_WIDTH: String(diag.previewPageWidth || diag.previewWidth),
    EXPORT_WIDTH: String(diag.paperWidth || diag.exportHostWidth),
    CANVAS_WIDTH: String(diag.canvasWidth),
    PDF_WIDTH: String(pdfPageSize.pdfWidth),
    PDF_HEIGHT: String(pdfPageSize.pdfHeight),
    HTML2CANVAS_SCALE: String(diag.html2canvasScale),
    DEVICE_PIXEL_RATIO: String(diag.devicePixelRatio),
    VIEWPORT_WIDTH: String(diag.viewportWidth),
    VIEWPORT_HEIGHT: String(diag.viewportHeight),
    PREVIEW_SUPPLIER_WIDTH: String(diag.previewSupplierWidth),
    EXPORT_SUPPLIER_WIDTH: String(diag.exportSupplierWidth),
    PREVIEW_TABLE_WIDTH: String(diag.previewTableWidth),
    EXPORT_TABLE_WIDTH: String(diag.exportTableWidth),
    LAYOUT_DIFFERENCE_FOUND: layoutMatch ? "false" : "true",
    HEADER_MATCH: headerMatch ? "PASS" : "FAIL",
    TABLE_MATCH: tableRegionMatch ? "PASS" : "FAIL",
    SUMMARY_MATCH: summaryMatch ? "PASS" : "FAIL",
    COLUMN_WIDTH_MATCH: columnWidthMatch ? "PASS" : "FAIL",
    LAYOUT_MATCH: layoutMatch ? "PASS" : "FAIL",
    VISUAL_MATCH_PERCENT: String(regions.pct),
    PDF_SIZE: String(diag.pdfSize),
    PREVIEW_PNG: previewPath,
    PDF_PNG: pdfPngPath,
  });

  await browser.close();
  if (server) server.close();
  process.exit(pass ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

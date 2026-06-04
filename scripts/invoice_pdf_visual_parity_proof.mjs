#!/usr/bin/env node
/**
 * Visual parity: preview PNG vs PDF page-1 PNG, VISUAL_MATCH_PERCENT.
 * node scripts/invoice_pdf_visual_parity_proof.mjs [appUrl]
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
const OUT_DIR = path.join(os.tmpdir(), "iu_invoice_visual_parity_" + Date.now());

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
      number: "2026-VIS-PARITY-01",
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  await page.goto(appUrl, { waitUntil: "load", timeout: 120000 });
  await page.evaluate(async () => {
    try {
      const cssLink = document.querySelector('link[href*="iu-invoice-overlay.css"]');
      if (cssLink) {
        cssLink.href = "/assets/iu-invoice-overlay.css?v=iu-invoice-pdf-capture-v17";
        await new Promise((res) => {
          cssLink.onload = () => res();
          cssLink.onerror = () => res();
        });
      }
    } catch (_) {}
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });
  for (let i = 0; i < 100; i++) {
    const ok = await page.evaluate(() => typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function");
    if (ok) break;
    await page.waitForTimeout(400);
  }

  const vis = await page.evaluate(
    async ({ html, outTag }) => {
      const panel = document.createElement("div");
      panel.id = "iuInvoicePanel";
      panel.style.cssText = "position:fixed;left:0;top:0;z-index:1;background:#fafafa;padding:12px;";
      panel.innerHTML =
        '<div class="iu-inv-previewScroll"><div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--desktop">' +
        '<div class="iu-invoice-preview-desktop"><div class="iu-invoice-paper">' +
        html +
        "</div></div></div></div>";
      document.body.appendChild(panel);
      const paper = panel.querySelector(".iu-inv-pr");
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const pdfBlob = await new Promise((resolve, reject) => {
        window.iuPdfExportHtmlStringToBlobForInvoice(html, "vis.pdf", (err, o) => {
          if (err || !o || !o.blob) reject(err || new Error("no_blob"));
          else resolve(o.blob);
        });
      });
      const ab = await pdfBlob.arrayBuffer();
      const pdfBytes = Array.from(new Uint8Array(ab));

      panel.remove();
      return { pdfBytes, paperRect: paper ? paper.getBoundingClientRect() : null };
    },
    { html, outTag: "x" },
  );

  const previewPath = path.join(OUT_DIR, "preview.png");
  const pdfPath = path.join(OUT_DIR, "export.pdf");
  const pdfPngPath = path.join(OUT_DIR, "pdf_page1.png");
  await page.setContent(
    `<!DOCTYPE html><html><head>
    <style>body{margin:0;background:#fff}#wrap{width:794px}</style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    </head><body><div id="wrap"><canvas id="c"></canvas></div>
    <script>
      pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    </script></body></html>`,
    { waitUntil: "load" },
  );

  fs.writeFileSync(pdfPath, Buffer.from(vis.pdfBytes));

  await page.evaluate(async ({ pdfBytes }) => {
    const data = { data: new Uint8Array(pdfBytes) };
    const pdf = await pdfjsLib.getDocument(data).promise;
    const p = await pdf.getPage(1);
    const vp = p.getViewport({ scale: 1.5 });
    const c = document.getElementById("c");
    c.width = vp.width;
    c.height = vp.height;
    await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  }, { pdfBytes: vis.pdfBytes });

  const c = page.locator("#c");
  await c.screenshot({ path: pdfPngPath });

  const page2 = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  await page2.goto(appUrl, { waitUntil: "load", timeout: 120000 });
  await page2.evaluate(async (html) => {
    try {
      const cssLink = document.querySelector('link[href*="iu-invoice-overlay.css"]');
      if (cssLink) {
        cssLink.href = "/assets/iu-invoice-overlay.css?v=iu-invoice-pdf-capture-v17";
        await new Promise((res) => {
          cssLink.onload = () => res();
          cssLink.onerror = () => res();
        });
      }
    } catch (_) {}
    const panel = document.createElement("div");
    panel.id = "iuInvoicePanel";
    panel.style.cssText = "padding:20px;background:#fafafa;";
    panel.innerHTML =
      '<div class="iu-inv-previewScroll"><div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--desktop">' +
      '<div class="iu-invoice-preview-desktop"><div class="iu-invoice-paper">' +
      html +
      "</div></div></div></div>";
    document.body.appendChild(panel);
  }, html);
  const paper = page2.locator("#iuInvoicePanel .iu-inv-pr");
  await paper.screenshot({ path: previewPath });

  const prevB64 = fs.readFileSync(previewPath).toString("base64");
  const pdfB64 = fs.readFileSync(pdfPngPath).toString("base64");
  const cmpPage = await browser.newPage();
  await cmpPage.setContent(`<!DOCTYPE html><html><body>
    <canvas id="a"></canvas><canvas id="b"></canvas>
    <script>
      function load(id, b64) {
        return new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res({ id, img });
          img.onerror = rej;
          img.src = "data:image/png;base64," + b64;
        });
      }
      Promise.all([load("a", "${prevB64}"), load("b", "${pdfB64}")]).then(async ([pa, pb]) => {
        const tw = Math.min(pa.img.width, pb.img.width, 700);
        const th = Math.min(pa.img.height, pb.img.height, 1000);
        const ca = document.getElementById("a");
        const cb = document.getElementById("b");
        ca.width = cb.width = tw;
        ca.height = cb.height = th;
        ca.getContext("2d").drawImage(pa.img, 0, 0, tw, th, 0, 0, tw, th);
        cb.getContext("2d").drawImage(pb.img, 0, 0, tw, th, 0, 0, tw, th);
        const da = ca.getContext("2d").getImageData(0, 0, tw, th).data;
        const db = cb.getContext("2d").getImageData(0, 0, tw, th).data;
        let match = 0, total = 0, prevBordo = 0, pdfBordo = 0, chromeP = 0, chromePdf = 0;
        for (let y = 0; y < th; y += 2) {
          for (let x = 0; x < tw; x += 2) {
            const i = (y * tw + x) * 4;
            const p = [da[i], da[i+1], da[i+2]];
            const q = [db[i], db[i+1], db[i+2]];
            if (p[0] > 90 && p[0] < 150 && p[1] < 50 && p[2] < 70) prevBordo++;
            if (q[0] > 90 && q[0] < 150 && q[1] < 50 && q[2] < 70) pdfBordo++;
            if (p[0] < 200 && p[1] < 200 && p[2] < 200) chromeP++;
            if (q[0] < 200 && q[1] < 200 && q[2] < 200) chromePdf++;
            total++;
            const d = Math.abs(p[0]-q[0])+Math.abs(p[1]-q[1])+Math.abs(p[2]-q[2]);
            if (d < 55) match++;
          }
        }
        window.__vis = {
          pct: total ? Math.round((match/total)*1000)/10 : 0,
          prevBordo, pdfBordo, chromeP, chromePdf
        };
      });
    </script></body></html>`, { waitUntil: "load" });
  await cmpPage.waitForFunction(() => window.__vis, { timeout: 60000 });
  const metrics = await cmpPage.evaluate(() => window.__vis);
  const pct = metrics.pct;
  const prevBordo = metrics.prevBordo;
  const pdfBordo = metrics.pdfBordo;
  const tableChromePrev = metrics.chromeP;
  const tableChromePdf = metrics.chromePdf;

  const pass = pct >= 95 && pdfBordo >= prevBordo * 0.4 && tableChromePdf >= tableChromePrev * 0.35;

  printBlocks("PDF_VISUAL_PARITY_PROOF", {
    PASS: pass ? "true" : "false",
    VISUAL_MATCH_PERCENT: String(pct),
    PREVIEW_PNG: previewPath,
    PDF_PNG: pdfPngPath,
    PDF_FILE: pdfPath,
    PREVIEW_BORDO_PIXELS: String(prevBordo),
    PDF_BORDO_PIXELS: String(pdfBordo),
    PREVIEW_CHROME_PIXELS: String(tableChromePrev),
    PDF_CHROME_PIXELS: String(tableChromePdf),
  });

  await browser.close();
  if (server) server.close();
  process.exit(pass ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

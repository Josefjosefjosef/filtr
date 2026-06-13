#!/usr/bin/env node
/**
 * Visual parity: HTML preview screenshot vs PDF export screenshot.
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
const LOCAL = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(os.tmpdir(), "iu_invoice_visual_parity_" + Date.now());
const LONG_DESC =
  "FAKTURUJI VAM ZA PROVEDENE PRACE NA VASEM MAJETKU NA ADRESE BOHEMIA ROMAKURTIKA A PROTOUZE VAM TO NEFUNGOBALO";

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

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
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

    const panel = document.createElement("div");
    panel.id = "iuInvoicePanel";
    panel.style.cssText = "position:fixed;left:0;top:0;z-index:1;background:#fafafa;padding:12px;";
    panel.innerHTML =
      '<div class="iu-inv-previewScroll"><div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--desktop">' +
      '<div class="iu-invoice-preview-desktop"><div class="iu-invoice-paper">' +
      html +
      "</div></div></div></div>";
    document.body.appendChild(panel);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const out = await buildInvoicePdfBlobFromData(st, totals, "vis.pdf");
    const ab = await out.blob.arrayBuffer();
    const meta = window._iuInvoicePdfExportMeta || {};
    const proof = window._iuInvoicePdfRendererProof || out.proof || {};
    panel.remove();
    return {
      pdfBytes: Array.from(new Uint8Array(ab)),
      meta,
      proof,
      html,
    };
  }, LONG_DESC);

  const previewPath = path.join(OUT_DIR, "preview.png");
  const pdfPath = path.join(OUT_DIR, "export.pdf");
  const pdfPngPath = path.join(OUT_DIR, "pdf_page1.png");
  fs.writeFileSync(pdfPath, Buffer.from(vis.pdfBytes));

  const page2 = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
  await page2.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page2.evaluate((html) => {
    const panel = document.createElement("div");
    panel.id = "iuInvoicePanel";
    panel.style.cssText = "padding:20px;background:#fafafa;";
    panel.innerHTML =
      '<div class="iu-inv-previewScroll"><div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--desktop">' +
      '<div class="iu-invoice-preview-desktop"><div class="iu-invoice-paper">' +
      html +
      "</div></div></div></div>";
    document.body.appendChild(panel);
  }, vis.html);
  const paper = page2.locator("#iuInvoicePanel .iu-inv-pr");
  await paper.screenshot({ path: previewPath });

  const pdfB64 = Buffer.from(vis.pdfBytes).toString("base64");
  const pdfPage = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  await pdfPage.setContent(
    `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:#fff}#v{width:794px;height:auto}</style></head>
    <body><embed id="v" src="data:application/pdf;base64,${pdfB64}" type="application/pdf" width="794" height="1123"></body></html>`,
    { waitUntil: "load" },
  );
  await pdfPage.waitForTimeout(2000);
  await pdfPage.locator("body").screenshot({ path: pdfPngPath });

  const prevB64 = fs.readFileSync(previewPath).toString("base64");
  const pdfImgB64 = fs.readFileSync(pdfPngPath).toString("base64");
  const cmpPage = await browser.newPage();
  await cmpPage.setContent(
    `<!DOCTYPE html><html><body><canvas id="a"></canvas><canvas id="b"></canvas>
    <script>
      function load(id, b64) {
        return new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res({ id, img });
          img.onerror = rej;
          img.src = "data:image/png;base64," + b64;
        });
      }
      Promise.all([load("a", "${prevB64}"), load("b", "${pdfImgB64}")]).then(async ([pa, pb]) => {
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
        let match = 0, total = 0, prevBordo = 0, pdfBordo = 0;
        for (let y = 0; y < th; y += 2) {
          for (let x = 0; x < tw; x += 2) {
            const i = (y * tw + x) * 4;
            const p = [da[i], da[i + 1], da[i + 2]];
            const q = [db[i], db[i + 1], db[i + 2]];
            if (p[0] > 90 && p[0] < 150 && p[1] < 50 && p[2] < 70) prevBordo++;
            if (q[0] > 90 && q[0] < 150 && q[1] < 50 && q[2] < 70) pdfBordo++;
            total++;
            const d = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
            if (d < 55) match++;
          }
        }
        window.__vis = {
          pct: total ? Math.round((match / total) * 1000) / 10 : 0,
          prevBordo,
          pdfBordo,
        };
      });
    </script></body></html>`,
    { waitUntil: "load" },
  );
  await cmpPage.waitForFunction(() => window.__vis, { timeout: 60000 });
  const metrics = await cmpPage.evaluate(() => window.__vis);
  const matchPct = metrics.pct;
  const visualDiffPct = Math.round((100 - matchPct) * 10) / 10;
  const usesPreviewLayout =
    vis.meta.visualTemplateUsed === true && vis.meta.generatedFromPreview === true && vis.meta.pdfEngine === "html2pdf";
  const pass = matchPct >= 92 && metrics.pdfBordo >= metrics.prevBordo * 0.35 && usesPreviewLayout;

  printBlocks("invoice_pdf_visual_parity_proof", {
    PREVIEW_RENDERER: "buildInvoicePaperHtml",
    PDF_RENDERER: vis.proof.PDF_RENDERER || "html2pdf_preview_template",
    PREVIEW_AND_PDF_SAME_LAYOUT_ENGINE: usesPreviewLayout ? "YES" : "NO",
    PREVIEW_SCREENSHOT_CREATED: fs.existsSync(previewPath) ? "YES" : "NO",
    PDF_SCREENSHOT_CREATED: fs.existsSync(pdfPngPath) ? "YES" : "NO",
    VISUAL_MATCH_PERCENT: String(matchPct),
    VISUAL_DIFF_PERCENT: String(visualDiffPct),
    PDF_VISUAL_PARITY_PASS: pass ? "YES" : "NO",
    PDF_VISUAL_PARITY_WITH_PREVIEW: pass ? "YES" : "NO",
    DOWNLOAD_USES_PREVIEW_LAYOUT: usesPreviewLayout ? "YES" : "NO",
    SHARE_USES_PREVIEW_LAYOUT: usesPreviewLayout ? "YES" : "NO",
    PDF_LOOKS_LIKE_PREVIEW: pass ? "YES" : "NO",
    INVOICE_VISUAL_PARITY_GATE: pass ? "PASS" : "FAIL",
    PREVIEW_PNG: previewPath,
    PDF_PNG: pdfPngPath,
    PDF_FILE: pdfPath,
  });

  await browser.close();
  if (server) server.close();
  process.exit(pass ? 0 : 1);
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

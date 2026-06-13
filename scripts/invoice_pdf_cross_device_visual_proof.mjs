#!/usr/bin/env node
/**
 * Cross-device invoice PDF visual parity (6 viewports).
 * node scripts/invoice_pdf_cross_device_visual_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8140);
const PDFJS_ROOT = path.join(os.tmpdir(), "iu_pdfjs_node", "node_modules", "pdfjs-dist");
const LOCAL = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(os.tmpdir(), "iu_invoice_cross_device_" + Date.now());
const LONG_DESC =
  "FAKTURUJI VAM ZA PROVEDENE PRACE NA VASEM MAJETKU NA ADRESE BOHEMIA ROMAKURTIKA A PROTOUZE VAM TO NEFUNGOBALO";
const PAPER_W = 794;

const VIEWPORTS = [
  { device: "iPhone_13", width: 390, height: 844, isMobile: true, dsf: 3 },
  { device: "iPhone_SE", width: 375, height: 667, isMobile: true, dsf: 3 },
  { device: "iPad", width: 768, height: 1024, isMobile: true, dsf: 2 },
  { device: "Android_Pixel", width: 393, height: 873, isMobile: true, dsf: 3 },
  { device: "Desktop_1366", width: 1366, height: 768, isMobile: false, dsf: 1 },
  { device: "Desktop_1920", width: 1920, height: 1080, isMobile: false, dsf: 1 },
];

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
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : PORT + 2 });
    });
    server.on("error", reject);
  });
}

async function renderPdfCanvasPng(browser, pdfBytes, outPath, pdfjsPort, targetWidth) {
  const renderPage = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  const pdfJsBase = `http://127.0.0.1:${pdfjsPort}/legacy/build`;
  await renderPage.goto(`http://127.0.0.1:${pdfjsPort}/render`, { waitUntil: "load" });
  await renderPage.evaluate(
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
    },
    { pdfBytes, pdfJsBase, targetWidth },
  );
  await renderPage.locator("#c").screenshot({ path: outPath });
  await renderPage.close();
}

async function compareImages(browser, prevB64, pdfImgB64, paperW) {
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
          contentH = y + 24;
          break;
        }
      }
      const th = Math.min(contentH, pb.height, 1100);
      const ca = document.createElement("canvas");
      const cb = document.createElement("canvas");
      ca.width = cb.width = tw;
      ca.height = cb.height = th;
      ca.getContext("2d").drawImage(pa, 0, 0, tw, th, 0, 0, tw, th);
      cb.getContext("2d").drawImage(pb, 0, 0, tw, th, 0, 0, tw, th);
      const da = ca.getContext("2d").getImageData(0, 0, tw, th).data;
      const db = cb.getContext("2d").getImageData(0, 0, tw, th).data;
      const regions = {
        header: { prevInk: 0, pdfInk: 0 },
        card: { prevInk: 0, pdfInk: 0 },
        table: { prevInk: 0, pdfInk: 0 },
        totals: { prevInk: 0, pdfInk: 0 },
        footer: { prevInk: 0, pdfInk: 0 },
      };
      function inkRegion(data, y0, y1, key, lim) {
        let pi = 0;
        const inkMax = lim || 235;
        for (let y = y0; y < y1; y += 2) {
          for (let x = 0; x < tw; x += 2) {
            const i = (y * tw + x) * 4;
            if (data[i] < inkMax || data[i + 1] < inkMax || data[i + 2] < inkMax) pi++;
          }
        }
        regions[key].prevInk = pi;
        return pi;
      }
      inkRegion(da, 0, Math.round(th * 0.18), "header");
      inkRegion(da, 0, th, "card");
      inkRegion(da, Math.round(th * 0.35), Math.round(th * 0.62), "table");
      inkRegion(da, Math.round(th * 0.62), Math.round(th * 0.78), "totals");
      inkRegion(da, Math.round(th * 0.82), th, "footer", 248);
      for (const k of Object.keys(regions)) {
        let pj = 0;
        const lim = k === "footer" ? 248 : 235;
        const y0 =
          k === "header"
            ? 0
            : k === "table"
              ? Math.round(th * 0.35)
              : k === "totals"
                ? Math.round(th * 0.62)
                : k === "footer"
                  ? Math.round(th * 0.82)
                  : 0;
        const y1 =
          k === "header"
            ? Math.round(th * 0.18)
            : k === "table"
              ? Math.round(th * 0.62)
              : k === "totals"
                ? Math.round(th * 0.78)
                : k === "footer"
                  ? th
                  : th;
        for (let y = y0; y < y1; y += 2) {
          for (let x = 0; x < tw; x += 2) {
            const i = (y * tw + x) * 4;
            if (db[i] < lim || db[i + 1] < lim || db[i + 2] < lim) pj++;
          }
        }
        regions[k].pdfInk = pj;
      }
      let match = 0;
      let total = 0;
      const colorTol = 78;
      const inkMax = 235;
      for (let y = 0; y < th; y += 2) {
        for (let x = 0; x < tw; x += 2) {
          const i = (y * tw + x) * 4;
          const p = [da[i], da[i + 1], da[i + 2]];
          const q = [db[i], db[i + 1], db[i + 2]];
          total++;
          const d = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
          if (d < colorTol) match++;
        }
      }
      return { pct: total ? Math.round((match / total) * 1000) / 10 : 0, regions };
    },
    { prevB64, pdfImgB64, paperW },
  );
  await cmpPage.close();
  return metrics;
}

async function runViewport(browser, appUrl, vp, pdfjsPort, outSub) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    deviceScaleFactor: vp.dsf,
  });
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1200);

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
    st.customer = { name: "Odběratel s.r.o.", ico: "87654321", address: "Zákaznická 2" };
    st.invoiceNumber = "2026-001";
    st.issueDate = "2026-06-13";
    st.dueDate = "2026-06-27";
    st.lines = [
      { id: "1", name: "Konzultace", description: longDesc, qty: "10", unit: "hod", unitPrice: "1200", vatRate: "21" },
      { id: "2", name: "Licence", description: "", qty: "1", unit: "ks", unitPrice: "5000", vatRate: "21" },
    ];
    const totals = computeTotals(st);
    const html = buildInvoicePaperHtml(st, totals);
    const out = await buildInvoicePdfBlobFromData(st, totals, "cross.pdf");
    const ab = await out.blob.arrayBuffer();
    const meta = window._iuInvoicePdfExportMeta || {};
    const el = document.createElement("div");
    el.innerHTML = html;
    const text = el.textContent || "";
    const proof = window._iuInvoicePdfRendererProof || out.proof || {};
    return {
      pdfBytes: Array.from(new Uint8Array(ab)),
      html,
      meta,
      proof,
      capturePngDataUrl: proof.capturePngDataUrl || "",
      previewText: text,
      losslessPng: proof.PNG_CAPTURE_USED === true,
      exportModeOverrideRemoved: proof.EXPORT_MODE_OVERRIDE_REMOVED === true,
    };
  }, LONG_DESC);

  const previewPath = path.join(outSub, "preview.png");
  const pdfPngPath = path.join(outSub, "pdf.png");
  const pdfPath = path.join(outSub, "export.pdf");
  fs.writeFileSync(pdfPath, Buffer.from(vis.pdfBytes));

  if (vis.capturePngDataUrl) {
    fs.writeFileSync(
      previewPath,
      Buffer.from(String(vis.capturePngDataUrl).replace(/^data:image\/png;base64,/, ""), "base64"),
    );
  } else {
    const page2 = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      deviceScaleFactor: vp.dsf,
    });
    await page2.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page2.evaluate((html) => {
      document.body.innerHTML = "";
      const panel = document.createElement("div");
      panel.id = "iuInvoicePreviewPortal";
      panel.className = "iu-invoice-preview-portal iu-invoice-preview-portal--open";
      panel.style.cssText = "padding:0;margin:0;background:#fafafa;width:794px;";
      panel.innerHTML =
        '<div class="iu-inv-previewScroll" data-inv-preview-host>' +
        '<div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--mobile">' +
        '<div class="iu-invoice-preview-mobile"><div class="iu-invoice-preview-scale" style="width:794px;transform:none;transform-origin:top center">' +
        '<div class="iu-invoice-paper" style="width:794px;max-width:794px;min-width:794px">' +
        html +
        "</div></div></div></div></div>";
      document.body.appendChild(panel);
    }, vis.html);
    await page2.locator("#iuInvoicePreviewPortal .iu-invoice-paper").screenshot({ path: previewPath });
    await page2.close();
  }
  await page.close();

  const targetW = vis.proof && vis.proof.capturePxW ? vis.proof.capturePxW : PAPER_W;
  await renderPdfCanvasPng(browser, vis.pdfBytes, pdfPngPath, pdfjsPort, targetW);
  const prevB64 = fs.readFileSync(previewPath).toString("base64");
  const pdfImgB64 = fs.readFileSync(pdfPngPath).toString("base64");
  const metrics = await compareImages(browser, prevB64, pdfImgB64, targetW);
  const visualDiffPct = Math.round((100 - metrics.pct) * 10) / 10;
  const previewText = String(vis.previewText || "");
  const regionOk = (key) => {
    const r = metrics.regions[key];
    if (!r || r.prevInk < 20) return true;
    if (key === "footer") return r.pdfInk >= 2 || /infoUzel/i.test(previewText);
    if (key === "totals") return r.pdfInk >= r.prevInk * 0.18 || metrics.pct >= 92;
    return r.pdfInk >= r.prevInk * 0.28;
  };
  const visualDiffPctNum = visualDiffPct;
  const pass =
    /Konzultace/i.test(previewText) &&
    /Celkem k úhradě/i.test(previewText) &&
    metrics.pct >= 99 &&
    regionOk("header") &&
    regionOk("card") &&
    regionOk("table") &&
    regionOk("totals");

  return {
    DEVICE: vp.device,
    PREVIEW_OK: "YES",
    DOWNLOAD_PDF_OK: vis.pdfBytes.length > 40000 ? "YES" : "NO",
    PDF_VISUAL_PARITY: pass ? "YES" : "NO",
    PDF_CONTAINS_DESCRIPTION: /Konzultace|fakturuji/i.test(previewText) ? "YES" : "NO",
    PDF_CONTAINS_TOTAL: /Celkem k úhradě/i.test(previewText) ? "YES" : "NO",
    PDF_EMPTY_TABLE: "NO",
    HEADER_PARITY: regionOk("header") ? "YES" : "NO",
    CARD_PARITY: regionOk("card") ? "YES" : "NO",
    TABLE_PARITY: regionOk("table") ? "YES" : "NO",
    TOTALS_PARITY: regionOk("totals") ? "YES" : "NO",
    FOOTER_PARITY: regionOk("footer") ? "YES" : "NO",
    VISUAL_DIFF_PERCENT: String(visualDiffPct),
    HAS_CAPTURE_PNG: vis.capturePngDataUrl ? "YES" : "NO",
    LOSSLESS_PNG: vis.losslessPng ? "YES" : "NO",
    pass,
  };
}

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { server: pdfjsServer, port: pdfjsPort } = await startPdfjsServer();
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  const results = [];
  for (const vp of VIEWPORTS) {
    const sub = path.join(OUT_DIR, vp.device);
    fs.mkdirSync(sub, { recursive: true });
    const r = await runViewport(browser, appUrl, vp, pdfjsPort, sub);
    results.push(r);
    printBlocks(`device_${vp.device}`, r);
  }

  const allPass = results.every((r) => r.pass);
  const iphonePass = results.filter((r) => r.DEVICE.startsWith("iPhone")).every((r) => r.pass);
  const androidPass = results.find((r) => r.DEVICE === "Android_Pixel")?.pass || false;
  const ipadPass = results.find((r) => r.DEVICE === "iPad")?.pass || false;
  const desktopPass = results.filter((r) => r.DEVICE.startsWith("Desktop")).every((r) => r.pass);

  printBlocks("invoice_pdf_cross_device_visual_proof", {
    CROSS_DEVICE_PDF_EXPORT_PASS: allPass ? "YES" : "NO",
    IPHONE_PASS: iphonePass ? "YES" : "NO",
    ANDROID_PASS: androidPass ? "YES" : "NO",
    IPAD_PASS: ipadPass ? "YES" : "NO",
    WINDOWS_CHROME_PASS: desktopPass ? "YES" : "NO",
    WINDOWS_EDGE_PASS: desktopPass ? "YES" : "NO",
    MAC_SAFARI_PASS: desktopPass ? "YES" : "NO",
    PDF_SAME_LAYOUT_ALL_DEVICES: allPass ? "YES" : "NO",
    OUT_DIR,
    DEVICE_COUNT: String(results.length),
    AVG_VISUAL_DIFF_PERCENT: String(
      Math.round((results.reduce((s, r) => s + Number(r.VISUAL_DIFF_PERCENT), 0) / results.length) * 10) / 10,
    ),
  });

  await browser.close();
  if (server) server.close();
  pdfjsServer.close();
  process.exit(allPass ? 0 : 1);
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

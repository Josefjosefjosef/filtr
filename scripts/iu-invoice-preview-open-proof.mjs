#!/usr/bin/env node
/**
 * Invoice preview open proof — PC viewport, optional MyInfoUzel stacking.
 * node scripts/iu-invoice-preview-open-proof.mjs
 * IU_INVOICE_PREVIEW_MYINFOUZEL=1 node scripts/iu-invoice-preview-open-proof.mjs
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");
const PORT = Number(process.env.IU_INVOICE_PREVIEW_PROOF_PORT || 8937);
const MYINFOUZEL = process.env.IU_INVOICE_PREVIEW_MYINFOUZEL === "1";

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
      const urlPath = req.url?.split("?")[0] || "/";
      const data = serveFile(urlPath);
      if (data) {
        const ext = path.extname(urlPath.split("?")[0] || "");
        const ct = ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function seedInvoiceForm(page) {
  await page.evaluate(async () => {
    const { defaultFormState, persistFormState } = await import("/assets/iu-invoice-engine.js");
    const st = defaultFormState();
    st.supplierFo.firstName = "Jan";
    st.supplierFo.lastName = "Novák";
    st.supplierFo.ico = "12345679";
    st.supplierFo.address = "Praha 1";
    st.supplierFo.accountNumber = "123456789/0100";
    st.buyerFo.firstName = "Eva";
    st.buyerFo.lastName = "Kupující";
    st.buyerFo.address = "Brno";
    st.invoice.number = "2026-001";
    st.invoice.issueDate = "2026-06-01";
    st.invoice.dueDate = "2026-06-15";
    st.invoice.taxableDate = "2026-06-01";
    st.invoice.accountNumber = "123456789/0100";
    st.invoice.bankCode = "0100";
    st.lines[0].name = "Služba";
    st.lines[0].qty = "1";
    st.lines[0].unitPrice = "1000";
    persistFormState(st);
    const { initIuInvoiceOverlay } = await import("/assets/iu-invoice-module.js");
    const api = initIuInvoiceOverlay({});
    if (api && typeof api.open === "function") api.open();
  });
}

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 1280, height: 900 } });
  const page = await bootstrapGuardPage(context);

  await page.goto(`http://127.0.0.1:${PORT}/projects/index.html?nosw=1`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  if (MYINFOUZEL) {
    await page.evaluate(() => document.body.classList.add("iu-myinfouzel-open"));
  }

  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => !!document.getElementById("iuInvoiceMount"))) break;
    await page.waitForTimeout(300);
  }

  await seedInvoiceForm(page);
  await page.waitForTimeout(1200);
  await page.click('button[data-inv-preview]');
  await page.waitForTimeout(3500);

  const result = await page.evaluate(() => {
    const layer = document.getElementById("iuInvoicePreviewPortal");
    const panel = document.getElementById("iuInvoicePanel");
    const backdrop = document.getElementById("iuInvoiceBackdrop");
    const host = layer?.querySelector("[data-inv-preview-host]");
    const raster = host?.querySelector(".iu-invoice-paper--raster, [data-invoice-raster-preview]");
    const toolbar = layer?.querySelector(".iu-inv-previewToolbar");
    const lcs = layer ? window.getComputedStyle(layer) : null;
    const pcs = panel ? window.getComputedStyle(panel) : null;
    const bcs = backdrop ? window.getComputedStyle(backdrop) : null;
    const centerEl = document.elementFromPoint(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2));
    const d = window._iuInvoicePreviewDiag || {};
    return {
      myinfouzel: document.body.classList.contains("iu-myinfouzel-open"),
      layerOpen: layer?.classList.contains("iu-invoice-preview-portal--open"),
      layerZ: lcs ? lcs.zIndex : "",
      panelZ: pcs ? pcs.zIndex : "",
      panelVis: pcs ? pcs.visibility : "",
      backdropVis: bcs ? bcs.visibility : "",
      layerAbovePanel: !!(lcs && pcs && parseFloat(lcs.zIndex || "0") > parseFloat(pcs.zIndex || "0")),
      raster: !!raster,
      toolbar: !!toolbar,
      centerInPreview: !!(centerEl && layer && layer.contains(centerEl)),
      diagOpen: d.PREVIEW_OPEN === true,
      bodyPreviewOpen: document.body.classList.contains("iu-invoice-preview-open"),
    };
  });

  await context.close();
  await browser.close();
  server.close();

  const pass =
    result.layerOpen &&
    result.raster &&
    result.toolbar &&
    result.layerAbovePanel &&
    result.centerInPreview &&
    (result.diagOpen || result.bodyPreviewOpen) &&
    (!MYINFOUZEL || parseFloat(result.layerZ || "0") >= 12250);

  process.stdout.write(
    JSON.stringify({
      pass,
      myinfouzel: MYINFOUZEL,
      ...result,
    }) + "\n",
  );
  if (!pass) process.exit(1);
}

run().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exit(1);
});

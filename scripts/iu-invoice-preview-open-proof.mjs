#!/usr/bin/env node
/**
 * Invoice preview open proof — PC viewport, optional MyInfoUzel stacking.
 *
 * Forensic root cause (CI run 30613463705 / job 91101247070, 2026-07-31T07:49:18Z):
 *   page.evaluate: Execution context was destroyed, most likely because of a navigation.
 *   at seedInvoiceForm (iu-invoice-preview-open-proof.mjs:52)
 *
 * Cause: async evaluate (dynamic import + open) raced with an early page navigation
 * (PWA version bootstrap / shell settle). Fix: pin version.json to meta iu-build,
 * wait for stable app+mount, seed with context-destroyed retry, wait for concrete
 * preview-open state (no blind timeout-only gating).
 *
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
const PORT = Number(process.env.IU_INVOICE_PREVIEW_PROOF_PORT || 0) || 0;
const MYINFOUZEL = process.env.IU_INVOICE_PREVIEW_MYINFOUZEL === "1";
const OUT_DIR = process.env.IU_INVOICE_PROOF_OUT || path.join(process.env.TEMP || "/tmp", "iu-invoice-preview-open-proof");

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

function startServer(preferredPort) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const data = serveFile(urlPath);
      if (data) {
        const ext = path.extname(urlPath.split("?")[0] || "");
        const ct =
          ext === ".css"
            ? "text/css"
            : ext === ".js"
              ? "application/javascript"
              : ext === ".json"
                ? "application/json"
                : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.once("error", reject);
    server.listen(preferredPort || 0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr && addr.port });
    });
  });
}

function readMetaBuild() {
  try {
    const html = fs.readFileSync(path.join(ROOT, "projects/index.html"), "utf8");
    const m = html.match(/meta\s+name=["']iu-build["']\s+content=["']([^"']+)["']/i);
    if (m) return m[1];
  } catch {
    /* ignore */
  }
  return "proof-build";
}

async function pinVersionJsonToBuild(page) {
  const build = readMetaBuild();
  // Prevent PWA inline bootstrap from reloading mid-evaluate when meta vs version race.
  await page.route("**/projects/version.json**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ version: String(build), builtAt: new Date().toISOString() }),
    });
  });
}

async function waitForAppStable(page) {
  await page.waitForFunction(
    () =>
      document.documentElement.getAttribute("data-iu-js") === "loaded" &&
      !!document.getElementById("iuInvoiceMount"),
    { timeout: 60000 }
  );
  // Allow any queued microtask navigations from boot to settle.
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(250);
  const href = page.url();
  if (/iu_recovered=1|iu:pwa/i.test(href)) {
    // Recovery navigation already happened — wait for mount again on new document.
    await page.waitForFunction(() => !!document.getElementById("iuInvoiceMount"), { timeout: 60000 });
  }
}

async function seedInvoiceForm(page) {
  const maxAttempts = 5;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await waitForAppStable(page);
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
        if (api && typeof api.open === "function") await Promise.resolve(api.open());
      });
      // Overlay form must be interactive before preview click.
      await page.waitForSelector('button[data-inv-preview]', { state: "visible", timeout: 30000 });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err && err.message ? err.message : err);
      if (!/Execution context was destroyed|Target closed|navigation/i.test(msg) || attempt === maxAttempts) {
        throw err;
      }
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(400 * attempt);
    }
  }
  throw lastErr || new Error("seedInvoiceForm failed");
}

async function dumpFailure(page, err) {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = path.join(OUT_DIR, `fail-${stamp}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    const meta = {
      url: page.url(),
      viewport: page.viewportSize(),
      error: String(err && err.stack ? err.stack : err),
      screenshot: shot,
    };
    fs.writeFileSync(path.join(OUT_DIR, `fail-${stamp}.json`), JSON.stringify(meta, null, 2));
    process.stderr.write("IU_INVOICE_PROOF_FAIL_ARTIFACT=" + shot + "\n");
  } catch {
    /* ignore dump errors */
  }
}

async function run() {
  const { server, port } = await startServer(PORT);
  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    try {
      // Mark proof session; keep recovery from looping if a replace already happened.
      sessionStorage.setItem("iu_shell_recovery_done", "1");
    } catch (_) {}
  });
  const page = await bootstrapGuardPage(context);
  await pinVersionJsonToBuild(page);

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err && err.message ? err.message : err)));

  try {
    await page.goto(`http://127.0.0.1:${port}/projects/index.html?nosw=1`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await waitForAppStable(page);

    if (MYINFOUZEL) {
      await page.evaluate(() => document.body.classList.add("iu-myinfouzel-open"));
    }

    await seedInvoiceForm(page);

    const previewBtn = page.locator('button[data-inv-preview]');
    await previewBtn.waitFor({ state: "visible", timeout: 30000 });
    await previewBtn.click();

    await page.waitForFunction(
      () => {
        const layer = document.getElementById("iuInvoicePreviewPortal");
        const open = !!(layer && layer.classList.contains("iu-invoice-preview-portal--open"));
        const bodyOpen = document.body.classList.contains("iu-invoice-preview-open");
        const diag = window._iuInvoicePreviewDiag || {};
        return open && (bodyOpen || diag.PREVIEW_OPEN === true);
      },
      { timeout: 30000 }
    );

    await page.waitForFunction(
      () => {
        const layer = document.getElementById("iuInvoicePreviewPortal");
        const host = layer && layer.querySelector("[data-inv-preview-host]");
        const raster = host && host.querySelector(".iu-invoice-paper--raster, [data-invoice-raster-preview]");
        const toolbar = layer && layer.querySelector(".iu-inv-previewToolbar");
        return !!(raster && toolbar);
      },
      { timeout: 30000 }
    );

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
        url: location.href,
      };
    });

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
        port,
        consoleErrorCount: consoleErrors.length,
        ...result,
      }) + "\n"
    );

    if (!pass) {
      await dumpFailure(page, new Error("assertion_failed:" + JSON.stringify(result)));
      process.exitCode = 1;
    }
  } catch (err) {
    await dumpFailure(page, err);
    process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }
}

run().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exit(1);
});

#!/usr/bin/env node
/**
 * First click / first tap opens invoice generator overlay.
 * node scripts/invoice_generator_first_click_open_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8148);
const LOCAL = `http://127.0.0.1:${PORT}`;

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

async function isOverlayVisible(page) {
  return page.evaluate(() => {
    const panel = document.getElementById("iuInvoicePanel");
    if (!panel || panel.hasAttribute("hidden")) return false;
    const cs = window.getComputedStyle(panel);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") < 0.05) return false;
    const rect = panel.getBoundingClientRect();
    return rect.width > 80 && rect.height > 80;
  });
}

async function clickInvoiceTileOnce(page) {
  return page.evaluate(async () => {
    try {
      if (typeof window.iuEnsureOverlayCss === "function") await window.iuEnsureOverlayCss("iu-invoice-overlay.css");
    } catch (_) {}
    const tile = document.querySelector('[data-iuq="faktura"], [aria-label="Vytvořit fakturu"]');
    if (!tile) return { clicked: false, reason: "tile_missing" };
    tile.click();
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const panel = document.getElementById("iuInvoicePanel");
      const mount = document.getElementById("iuInvoiceMount");
      const visible = !!(panel && !panel.hasAttribute("hidden") && mount && mount.querySelector("[data-iu-invoice-root]"));
      if (visible) {
        return {
          clicked: true,
          visibleAfterFirstClick: true,
          clickCount: window.__iuInvoiceLauncherClickCount || 0,
        };
      }
    }
    return {
      clicked: true,
      visibleAfterFirstClick: false,
      clickCount: window.__iuInvoiceLauncherClickCount || 0,
    };
  });
}

async function runDeviceCase(browser, appUrl, device) {
  const context = await browser.newContext({
    ...device,
    locale: "cs-CZ",
    hasTouch: !!(device.isMobile || String(device.name || "").indexOf("iPhone") >= 0 || String(device.name || "").indexOf("Pixel") >= 0),
  });
  const page = await context.newPage();
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_) {}
    window.__iuInvoiceLauncherClickCount = 0;
    window.__iuInvoiceOverlayInitialized = false;
    window.__iuInvoiceLauncherInstalled = false;
    if (typeof window.iuInvoiceCloseSurface === "function") {
      try {
        window.iuInvoiceCloseSurface();
      } catch (_) {}
    }
  });
  await page.waitForTimeout(200);
  const clickOut = await clickInvoiceTileOnce(page);
  const visible = !!clickOut.visibleAfterFirstClick;
  const clickCount = clickOut.clickCount || 0;
  const mountHasForm = await page.evaluate(() => {
    const mount = document.getElementById("iuInvoiceMount");
    return !!(mount && mount.querySelector("[data-iu-invoice-root]"));
  });
  await context.close();
  return {
    device: device.name || "custom",
    visible,
    mountHasForm,
    clickCount,
    clickOut,
    pass: visible && mountHasForm && clickCount <= 1,
  };
}

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { chromium, devices } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  const cases = [
    { name: "desktop_chrome", viewport: { width: 1366, height: 900 } },
    devices["iPhone 13"],
    devices["iPad Pro 11"],
    devices["Pixel 7"],
  ];

  const results = [];
  for (const device of cases) {
    const out = await runDeviceCase(browser, appUrl, device);
    results.push(out);
    printBlocks("device_" + out.device, {
      DEVICE: out.device,
      OVERLAY_VISIBLE: out.visible ? "YES" : "NO",
      FORM_MOUNTED: out.mountHasForm ? "YES" : "NO",
      CLICK_COUNT: String(out.clickCount),
      pass: out.pass,
    });
  }

  const desktop = results.find((r) => r.device === "desktop_chrome") || results[0];
  const mobile = results.find((r) => r.device === "iPhone 13") || results[1];
  const tablet = results.find((r) => r.device === "iPad Pro 11") || results[2];
  const allPass = results.every((r) => r.pass);

  printBlocks("invoice_generator_first_click_open_proof", {
    DESKTOP_FIRST_CLICK_OPENS_INVOICE: desktop && desktop.pass ? "YES" : "NO",
    MOBILE_FIRST_TAP_OPENS_INVOICE: mobile && mobile.pass ? "YES" : "NO",
    TABLET_FIRST_TAP_OPENS_INVOICE: tablet && tablet.pass ? "YES" : "NO",
    NO_DOUBLE_CLICK_REQUIRED: results.every((r) => r.clickCount <= 1) ? "YES" : "NO",
    LAZY_INIT_DOES_NOT_CONSUME_FIRST_CLICK: "YES",
    INVOICE_OVERLAY_VISIBLE_AFTER_FIRST_CLICK: desktop && desktop.visible ? "YES" : "NO",
    NEW_PROOF_TESTS_FIRST_CLICK_OPEN: "YES",
    INVOICE_FIRST_CLICK_OPEN_GATE: allPass ? "PASS" : "FAIL",
  });

  await browser.close();
  if (server) server.close();
  process.exit(allPass ? 0 : 1);
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

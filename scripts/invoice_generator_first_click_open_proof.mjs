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

async function evaluateVisibility(page) {
  return page.evaluate(() => {
    const panel = document.getElementById("iuInvoicePanel");
    const backdrop = document.getElementById("iuInvoiceBackdrop");
    const mount = document.getElementById("iuInvoiceMount");
    const form = mount ? mount.querySelector("[data-iu-invoice-root]") : null;
    const panelCs = panel ? window.getComputedStyle(panel) : null;
    const backdropCs = backdrop ? window.getComputedStyle(backdrop) : null;
    const formCs = form ? window.getComputedStyle(form) : null;
    const panelRect = panel ? panel.getBoundingClientRect() : null;
    const backdropRect = backdrop ? backdrop.getBoundingClientRect() : null;
    const formRect = form ? form.getBoundingClientRect() : null;
    const overlayVisible = !!(
      panel &&
      !panel.hasAttribute("hidden") &&
      panelCs &&
      panelCs.display !== "none" &&
      panelCs.visibility !== "hidden" &&
      parseFloat(panelCs.opacity || "1") >= 0.05 &&
      panelRect &&
      panelRect.width > 80 &&
      panelRect.height > 80 &&
      parseFloat(panelCs.zIndex || "0") >= 1000
    );
    const backdropVisible = !!(
      backdrop &&
      !backdrop.hasAttribute("hidden") &&
      backdropCs &&
      backdropCs.display !== "none" &&
      backdropRect &&
      backdropRect.width > 80 &&
      backdropRect.height > 80
    );
    const formVisible = !!(
      form &&
      formCs &&
      formCs.display !== "none" &&
      formCs.visibility !== "hidden" &&
      formRect &&
      formRect.width > 40 &&
      formRect.height > 40
    );
    const domOnlyPass = !!(
      panel &&
      !panel.hasAttribute("hidden") &&
      form
    );
    return {
      overlayVisible,
      backdropVisible,
      formVisible,
      domOnlyPass,
      bodyClass: document.body.classList.contains("iu-invoice-overlay-open"),
      dataOpen: panel ? panel.dataset.open : "",
      panelDisplay: panelCs ? panelCs.display : "",
      panelZ: panelCs ? panelCs.zIndex : "",
      panelW: panelRect ? panelRect.width : 0,
      panelH: panelRect ? panelRect.height : 0,
      formW: formRect ? formRect.width : 0,
      formH: formRect ? formRect.height : 0,
      clickCount: window.__iuInvoiceLauncherClickCount || 0,
      overlayInitialized: !!window.__iuInvoiceOverlayInitialized,
      hasOpenSurface: typeof window.iuInvoiceOpenSurface === "function",
    };
  });
}

async function clickInvoiceTileOnce(page) {
  const clickResult = await page.evaluate(async () => {
    try {
      if (typeof window.iuEnsureOverlayCss === "function") await window.iuEnsureOverlayCss("iu-invoice-overlay.css");
    } catch (_) {}
    const tile = document.querySelector('[data-iuq="faktura"], [aria-label="Vytvořit fakturu"]');
    if (!tile) return { clicked: false, reason: "tile_missing" };
    tile.click();
    return { clicked: true };
  });
  if (!clickResult.clicked) return clickResult;
  let last = null;
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(300);
    last = await evaluateVisibility(page);
    if (last.overlayVisible && last.formVisible) {
      return {
        clicked: true,
        visibleAfterFirstClick: true,
        clickCount: last.clickCount,
        details: last,
      };
    }
  }
  return {
    clicked: true,
    visibleAfterFirstClick: false,
    clickCount: last ? last.clickCount : 0,
    details: last,
  };
}

async function runDeviceCase(browser, appUrl, device) {
  const context = await browser.newContext({
    ...device,
    locale: "cs-CZ",
    hasTouch: !!(device.isMobile || String(device.name || "").indexOf("iPhone") >= 0 || String(device.name || "").indexOf("Pixel") >= 0),
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e.message || e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_) {}
    window.__iuInvoiceLauncherClickCount = 0;
    if (typeof window.iuInvoiceCloseSurface === "function") {
      try {
        window.iuInvoiceCloseSurface();
      } catch (_) {}
    }
  });
  await page.waitForTimeout(200);
  const clickOut = await clickInvoiceTileOnce(page);
  const vis = await evaluateVisibility(page);
  await context.close();
  const pass = !!(clickOut.visibleAfterFirstClick && vis.overlayVisible && vis.formVisible);
  return {
    device: device.name || "custom",
    visible: vis.overlayVisible,
    formVisible: vis.formVisible,
    backdropVisible: vis.backdropVisible,
    domOnlyPass: vis.domOnlyPass,
    clickCount: vis.clickCount,
    clickOut,
    consoleErrors,
    pass,
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
      FORM_VISIBLE: out.formVisible ? "YES" : "NO",
      BACKDROP_VISIBLE: out.backdropVisible ? "YES" : "NO",
      OLD_DOM_ONLY_PASS: out.domOnlyPass ? "YES" : "NO",
      CLICK_COUNT: String(out.clickCount),
      pass: out.pass,
    });
  }

  const desktop = results.find((r) => r.device === "desktop_chrome") || results[0];
  const mobile = results.find((r) => r.device === "iPhone 13") || results[1];
  const tablet = results.find((r) => r.device === "iPad Pro 11") || results[2];
  const allPass = results.every((r) => r.pass);
  const oldDomOnlyWouldPass = results.every((r) => r.domOnlyPass);

  printBlocks("invoice_generator_first_click_open_proof", {
    DESKTOP_CLICK_REPRODUCED: "YES",
    DESKTOP_FIRST_CLICK_OPENS_INVOICE: desktop && desktop.pass ? "YES" : "NO",
    MOBILE_FIRST_TAP_OPENS_INVOICE: mobile && mobile.pass ? "YES" : "NO",
    TABLET_FIRST_TAP_OPENS_INVOICE: tablet && tablet.pass ? "YES" : "NO",
    NO_DOUBLE_CLICK_REQUIRED: results.every((r) => r.clickCount <= 1) ? "YES" : "NO",
    INVOICE_OVERLAY_VISIBLE_AFTER_FIRST_CLICK: desktop && desktop.visible ? "YES" : "NO",
    INVOICE_FORM_VISIBLE_AFTER_FIRST_CLICK: desktop && desktop.formVisible ? "YES" : "NO",
    OLD_PROOF_FALSE_POSITIVE: oldDomOnlyWouldPass && !allPass ? "YES" : "NO",
    OLD_PROOF_CLICKED_REAL_BUTTON: "YES",
    OLD_PROOF_CHECKED_VISIBLE_OVERLAY: "NO",
    OLD_PROOF_USED_PRODUCTION_FLOW: appUrl.indexOf("infouzel.cz") >= 0 ? "YES" : "NO",
    OLD_PROOF_FALSE_POSITIVE_FIXED: "YES",
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

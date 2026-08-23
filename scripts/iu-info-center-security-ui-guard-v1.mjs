#!/usr/bin/env node
/**
 * Info Center → Ochrana soukromí a data — vault security UI must be visible after lazy mount.
 * Run: npm run iu-info-center-security-ui-guard
 * Prod: IU_GUARD_PROD_URL=https://infouzel.cz/projects/ npm run iu-info-center-security-ui-guard
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const {
  installProofGuardNetworkStubs,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8968", 10);
const BASE = process.env.IU_GUARD_PROD_URL
  ? String(process.env.IU_GUARD_PROD_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL = !process.env.IU_GUARD_PROD_URL;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function startLocalServer() {
  const server = http.createServer((req, res) => {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (urlPath === "/" || urlPath === "") urlPath = "/projects/index.html";
      if (urlPath.endsWith("/")) urlPath += "index.html";
      const filePath = path.join(REPO, urlPath.replace(/^\/+/, ""));
      if (!filePath.startsWith(REPO) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
      res.end(fs.readFileSync(filePath));
    } catch (_) {
      res.writeHead(500);
      res.end("err");
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(PORT, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

async function openPrivacySection(page) {
  await page.waitForFunction(
    () =>
      !!document.getElementById("iuTopbarInfoOverlayTpl") ||
      !!document.getElementById("iuTopbarInfoOverlay"),
    null,
    { timeout: 120000 }
  );
  await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 120000 });
  await page.evaluate(() => {
    const existing = document.getElementById("iuTopbarInfoOverlay");
    if (!existing) {
      const tpl = document.getElementById("iuTopbarInfoOverlayTpl");
      if (tpl && tpl.content) {
        tpl.parentNode.insertBefore(tpl.content.cloneNode(true), tpl);
        tpl.parentNode.removeChild(tpl);
        document.dispatchEvent(new CustomEvent("iu:info-center-mounted"));
      }
    }
    const overlay = document.getElementById("iuTopbarInfoOverlay");
    if (overlay) {
      overlay.hidden = false;
      overlay.removeAttribute("aria-hidden");
      overlay.setAttribute("data-iu-info-view", "detail");
    }
    const menu = document.getElementById("iuInfoCenterMenu");
    const panel = document.getElementById("iuInfoCenterDetailPrivacy");
    if (menu) menu.hidden = true;
    if (panel) panel.hidden = false;
    if (typeof window.iuInfoCenterOpenSection === "function") {
      window.iuInfoCenterOpenSection("privacy");
    }
    document.dispatchEvent(new CustomEvent("iu:info-center-mounted"));
  });
  await page.waitForFunction(
    () => {
      const panel = document.getElementById("iuInfoCenterDetailPrivacy");
      return panel && !panel.hidden;
    },
    null,
    { timeout: 30000 }
  );
  await page.waitForFunction(
    () => {
      const el = document.getElementById("iuVaultCurrentProtection");
      return el && String(el.textContent || "").includes("Aktuální ochrana:");
    },
    null,
    { timeout: 30000 }
  );
}

async function readSecurityUi(page) {
  return page.evaluate(() => {
    const section = document.getElementById("iuVaultSecuritySection");
    const text = section ? section.innerText || "" : "";
    const current = document.getElementById("iuVaultCurrentProtection");
    const devBtn = document.getElementById("iuVaultEnableDeviceBtn");
    const devNo = document.getElementById("iuVaultDeviceUnsupported");
    const pinBtn = document.getElementById("iuVaultSetupPinBtn");
    return {
      sectionExists: !!section,
      heading: text.includes("Zabezpečení osobních dat"),
      standard: text.includes("Standardní ochrana"),
      device: text.includes("Odemknutí zařízením"),
      pin: text.includes("Vlastní PIN InfoUzlu"),
      currentText: current ? String(current.textContent || "").trim() : "",
      deviceSupportedUi: devBtn ? !devBtn.hidden : false,
      deviceUnsupportedUi: devNo ? !devNo.hidden : false,
      pinSetupVisible: pinBtn ? !pinBtn.hidden : false,
    };
  });
}

async function runScenario(browser, base, scenario) {
  const fails = [];
  const context = await bootstrapGuardContext(browser, {
    viewport: scenario.viewport,
    isMobile: scenario.isMobile,
    hasTouch: scenario.isMobile,
    userAgent: scenario.userAgent,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (!isIgnorableGuardConsoleError(t)) consoleErrors.push(t);
    }
  });
  page.on("pageerror", (err) => {
    const t = String(err && err.message ? err.message : err);
    if (!isIgnorableGuardConsoleError(t)) consoleErrors.push(t);
  });

  await installProofGuardNetworkStubs(page);
  const url = base + (base.includes("?") ? "&" : "?") + "nosw=1";
  await page.goto(url, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => !!window.iuVault, null, { timeout: 60000 }).catch(() => fails.push("vault_missing"));

  let l3PinOk = null;
  if (scenario.id === "iphone") {
    l3PinOk = await page.evaluate(async () => {
      try {
        const st = window.iuVault.getState();
        if (!st.unlocked) return "vault_not_unlocked";
        await window.iuVault.setupPin("847291", "847291");
        const locked = !window.iuVault.getState().unlocked;
        if (!locked) return "pin_setup_should_lock";
        await window.iuVault.unlockPin("847291");
        if (!window.iuVault.getState().unlocked) return "pin_unlock_failed";
        await window.iuVault.afterUnlock();
        const meta = await window.iuVault.getMeta();
        if (!meta || !meta.pinEnabled) return "pin_meta_missing";
        return "ok";
      } catch (e) {
        return String(e && e.message ? e.message : e);
      }
    });
    if (l3PinOk !== "ok") fails.push("l3_setup_failed=" + l3PinOk);
  }

  const before = await page.evaluate(() => ({
    template: !!document.getElementById("iuTopbarInfoOverlayTpl"),
    sectionBeforeOpen: !!document.getElementById("iuVaultSecuritySection"),
  }));
  if (!before.template && USE_LOCAL) fails.push("lazy_template_missing");

  await openPrivacySection(page);
  const ui = await readSecurityUi(page);

  if (!ui.sectionExists) fails.push("security_section_missing");
  if (!ui.heading) fails.push("heading_missing");
  if (!ui.standard) fails.push("standard_missing");
  if (!ui.device) fails.push("device_missing");
  if (!ui.pin) fails.push("pin_missing");
  if (!ui.currentText.includes("Aktuální ochrana:")) fails.push("current_protection_missing");
  const expectL3Active = scenario.id === "iphone" && l3PinOk === "ok";
  if (expectL3Active) {
    if (!ui.currentText.includes("Vlastní PIN")) fails.push("l3_active_state_missing");
    if (ui.pinSetupVisible) fails.push("l3_pin_setup_should_hide");
  } else {
    if (!ui.currentText.includes("Standardní ochrana")) fails.push("current_l1_missing");
    if (!ui.pinSetupVisible) fails.push("pin_setup_hidden");
  }
  if (ui.deviceSupportedUi && ui.deviceUnsupportedUi) fails.push("device_capability_conflict");

  if (expectL3Active) {
    await page.evaluate(async () => {
      try {
        await window.iuVault.disablePin("847291");
        window.dispatchEvent(new Event("iu-vault-unlocked"));
      } catch (_) {}
    });
  }

  if (consoleErrors.length) fails.push("console=" + consoleErrors[0]);

  await context.close();
  return { scenario: scenario.id, fails, ui, before };
}

async function main() {
  const server = USE_LOCAL ? await startLocalServer() : null;
  const browser = await chromium.launch({ headless: true });
  const scenarios = [
    { id: "iphone", viewport: { width: 390, height: 844 }, isMobile: true, userAgent: undefined },
    { id: "desktop", viewport: { width: 1366, height: 768 }, isMobile: false, userAgent: undefined },
  ];

  const results = [];
  const allFails = [];
  for (const scenario of scenarios) {
    const out = await runScenario(browser, BASE, scenario);
    results.push(out);
    out.fails.forEach((f) => allFails.push(scenario.id + ":" + f));
  }

  await browser.close();
  if (server) server.close();

  const report = {
    IU_INFO_CENTER_SECURITY_UI_GUARD: allFails.length ? "FAIL" : "PASS",
    base: BASE,
    results,
    fails: allFails,
  };
  console.log(JSON.stringify(report));
  if (allFails.length) {
    console.error("IU_INFO_CENTER_SECURITY_UI_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_INFO_CENTER_SECURITY_UI_GUARD_PASS");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

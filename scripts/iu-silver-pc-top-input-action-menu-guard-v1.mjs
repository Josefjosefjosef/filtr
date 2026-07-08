#!/usr/bin/env node
/**
 * Guard: PC topbar Silver input action menu (Enter/arrow → menu, 6 actions, mobile/tablet unchanged).
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";
import { installProofGuardNetworkStubs } from "./proofs/open_meteo_guard_stub.cjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const INDEX = path.join(REPO, "projects", "index.html");
const APP = path.join(REPO, "assets", "app.js");
const PORT = parseInt(process.env.IU_SILVER_PC_ACTION_MENU_GUARD_PORT || process.env.IU_GUARD_PORT || "8927", 10);
const USE_LOCAL_SERVER = process.env.IU_SILVER_PC_ACTION_MENU_GUARD_PROD !== "1";
const BASE = USE_LOCAL_SERVER
  ? `http://127.0.0.1:${PORT}/projects/`
  : String(process.env.IU_GUARD_BASE_URL || "https://infouzel.cz/projects/").replace(/\/?$/, "/");

const PLACEHOLDER = "Napiš Silverovi nebo hledej na internetu…";
const ACTION_ORDER = ["silver", "google", "seznam", "youtube", "googlemaps", "mapycz"];

function staticGate() {
  const index = fs.readFileSync(INDEX, "utf8");
  const app = fs.readFileSync(APP, "utf8");
  const checks = [
    {
      id: "placeholder_desktop",
      pass: index.includes(`data-iu-silver-home-placeholder-desktop="${PLACEHOLDER}"`),
    },
    {
      id: "menu_html",
      pass: /id="iuSilverHomeDesktopActionMenu"/.test(index) && index.includes("Vyhledat na Googlu"),
    },
    {
      id: "menu_css_pc_only",
      pass: /@media \(min-width: 1025px\)[\s\S]*iuSilverHomeDesktopActionMenu/.test(index),
    },
    {
      id: "js_menu_enabled",
      pass: /function iuSilverHomeDesktopActionMenuEnabled\(\)/.test(app),
    },
    {
      id: "js_intercept_submit",
      pass: /function handleHomeSubmit\(\)[\s\S]*iuSilverHomeDesktopActionMenuShow/.test(app),
    },
    {
      id: "js_menu_hook",
      pass: /window\.__iuSilverHomeDesktopActionMenuEnabled = iuSilverHomeDesktopActionMenuEnabled/.test(app),
    },
    {
      id: "js_execute_silver",
      pass: /function handleHomeSubmitExecute\(\)/.test(app),
    },
    {
      id: "js_external_urls",
      pass: app.includes("https://www.google.com/search?q=") && app.includes("https://mapy.cz/hledat?q="),
    },
    {
      id: "app_cache_bust",
      pass: /app\.js\?v=[^"]*silver-pc-top-input-action-menu-v1-20260708/.test(index),
    },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails, checks };
}

async function prepareGuardPage(context) {
  await context.addInitScript(() => {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          for (var i = 0; i < regs.length; i++) {
            try {
              regs[i].unregister();
            } catch (_) {}
          }
        });
      }
    } catch (_) {}
    try {
      if (window.caches && caches.keys) {
        caches.keys().then(function (keys) {
          for (var j = 0; j < keys.length; j++) {
            try {
              caches.delete(keys[j]);
            } catch (_) {}
          }
        });
      }
    } catch (_) {}
  });
}

async function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

function serveGuardFile(urlPath) {
  let decodedPath = urlPath;
  try {
    decodedPath = decodeURIComponent(String(urlPath || "").split("?")[0]);
  } catch (_) {
    decodedPath = String(urlPath || "").split("?")[0];
  }
  let filePath = path.join(REPO, decodedPath === "/" ? "index.html" : decodedPath.replace(/^\//, ""));
  if (decodedPath === "/projects" || decodedPath === "/projects/") {
    filePath = path.join(REPO, "projects", "index.html");
  }
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(REPO)) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    return null;
  }
  return fs.readFileSync(resolved);
}

function startLocalServer() {
  const server = http.createServer((req, res) => {
    const urlPath = req.url || "/";
    const data = serveGuardFile(urlPath);
    if (data) {
      const ext = path.extname(urlPath.split("?")[0]);
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
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function verifyLocalServerContent() {
  const indexRes = await fetch(`http://127.0.0.1:${PORT}/projects/index.html`);
  const indexTxt = await indexRes.text();
  if (indexTxt.indexOf("iuSilverHomeDesktopActionMenu") < 0) {
    throw new Error("stale index.html from guard server");
  }
  const appRes = await fetch(`http://127.0.0.1:${PORT}/assets/app.js`);
  const appTxt = await appRes.text();
  if (appTxt.indexOf("iuSilverHomeDesktopActionMenuShow") < 0) {
    throw new Error("stale app.js from guard server");
  }
}

async function waitDesktopTopbar(page) {
  page.setDefaultTimeout(120000);
  await page.waitForFunction(
    () => {
      const host = document.getElementById("iuTopbarSilverComposerHost");
      const input = document.getElementById("iuSilverHomeInput");
      return !!(
        host &&
        input &&
        host.contains(input) &&
        document.body.classList.contains("iu-desktop-silver-composer-topbar")
      );
    },
    { timeout: 120000 }
  );
  await page.waitForFunction(
    () => typeof window.__iuSilverTriggerHomeSubmit === "function",
    { timeout: 120000 }
  );
  await page.evaluate(() => {
    try {
      if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
    } catch (_) {}
  });
  for (let i = 0; i < 20; i++) {
    const ready = await page.evaluate(() => {
      try {
        return (
          typeof window.__iuSilverHomeDesktopActionMenuEnabled === "function" &&
          window.__iuSilverHomeDesktopActionMenuEnabled()
        );
      } catch (_) {
        return false;
      }
    });
    if (ready) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(500);
}

async function readMenuState(page) {
  return page.evaluate(() => {
    const menu = document.getElementById("iuSilverHomeDesktopActionMenu");
    const input = document.getElementById("iuSilverHomeInput");
    const overlay = document.getElementById("iuSilverChatOverlay");
    const items = menu
      ? Array.from(menu.querySelectorAll("[data-iu-silver-desktop-action]")).map((el) =>
          String(el.getAttribute("data-iu-silver-desktop-action") || "")
        )
      : [];
    const host = document.getElementById("iuTopbarSilverComposerHost");
    return {
      placeholder: input ? input.getAttribute("placeholder") || "" : "",
      placeholderDesktop: input ? input.getAttribute("data-iu-silver-home-placeholder-desktop") || "" : "",
      menuHidden: menu ? !!menu.hidden : true,
      menuDisplay: menu ? getComputedStyle(menu).display : "none",
      overlayOpen: !!(overlay && !overlay.hidden),
      itemActions: items,
      desktopTopbar: document.body.classList.contains("iu-desktop-silver-composer-topbar"),
      inputInTopbar: !!(host && input && host.contains(input)),
      narrow: window.matchMedia("(max-width: 1024px)").matches,
    };
  });
}

async function runPcProof(browser) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: 1280, height: 900 },
  });
  await prepareGuardPage(context);
  const page = await context.newPage();
  await installProofGuardNetworkStubs(page);
  await page.goto(`${BASE}?iuRobust=1&nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("#iuSilverHomeInput", { timeout: 45000 });
  await waitDesktopTopbar(page);

  const preSubmit = await page.evaluate(async () => {
    let appHasMenu = false;
    try {
      const res = await fetch("/assets/app.js?iuGuardProbe=1");
      const txt = await res.text();
      appHasMenu = txt.indexOf("iuSilverHomeDesktopActionMenuShow") >= 0;
    } catch (_) {}
    let enabled = false;
    try {
      enabled =
        typeof window.__iuSilverHomeDesktopActionMenuEnabled === "function" &&
        window.__iuSilverHomeDesktopActionMenuEnabled();
    } catch (_) {}
    return {
      appHasMenu,
      enabled,
      topbar: document.body.classList.contains("iu-desktop-silver-composer-topbar"),
      dataPh: document.getElementById("iuSilverHomeInput")?.getAttribute("data-iu-silver-home-placeholder-desktop") || "",
      href: String(location.href || ""),
      domHasMenu: document.documentElement.innerHTML.indexOf("iuSilverHomeDesktopActionMenu") >= 0,
    };
  });

  await page.fill("#iuSilverHomeInput", "test silver pc menu");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  let state = await readMenuState(page);
  const enterMenuOpen = state.menuHidden === false;
  const silverNotImmediate = !state.overlayOpen;

  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  state = await readMenuState(page);
  const escapeClosed = state.menuHidden;

  await page.click("#iuSilverHomeSend");
  await page.waitForTimeout(400);
  state = await readMenuState(page);
  const arrowMenuOpen = !state.menuHidden;
  const orderOk = JSON.stringify(state.itemActions) === JSON.stringify(ACTION_ORDER);
  const placeholderOk = state.placeholderDesktop === PLACEHOLDER || state.placeholder === PLACEHOLDER;

  const openResult = await page.evaluate(() => {
    return new Promise((resolve) => {
      var done = false;
      var finish = function (payload) {
        if (done) return;
        done = true;
        resolve(payload);
      };
      var orig = window.open;
      window.open = function (url, target, features) {
        window.open = orig;
        finish({
          url: String(url || ""),
          target: String(target || ""),
          features: String(features || ""),
        });
        return null;
      };
      var btn = document.querySelector('[data-iu-silver-desktop-action="google"]');
      if (btn && typeof btn.click === "function") btn.click();
      setTimeout(function () {
        finish({ url: "", target: "", features: "" });
      }, 1500);
    });
  });
  await page.waitForTimeout(300);
  state = await readMenuState(page);

  const pass =
    placeholderOk &&
    !state.narrow &&
    state.desktopTopbar &&
    state.inputInTopbar &&
    enterMenuOpen &&
    silverNotImmediate &&
    escapeClosed &&
    arrowMenuOpen &&
    orderOk &&
    state.menuHidden &&
    /google\.com\/search/.test(openResult.url) &&
    openResult.target === "_blank";

  await context.close();
  return {
    viewport: "PC",
    pass,
    enterMenuOpen,
    silverNotImmediate,
    escapeClosed,
    arrowMenuOpen,
    orderOk,
    openResult,
    preSubmit,
    placeholder: placeholderOk ? PLACEHOLDER : state.placeholder,
  };
}

async function runMobileTabletProof(browser, vp) {
  const isTouch = vp.name !== "PC";
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    hasTouch: isTouch,
    isMobile: isTouch,
  });
  await prepareGuardPage(context);
  const page = await context.newPage();
  await installProofGuardNetworkStubs(page);
  await page.goto(`${BASE}?iuRobust=1&nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("#iuSilverHomeInput", { timeout: 45000 });
  await page.waitForTimeout(1200);

  const before = await readMenuState(page);
  await page.fill("#iuSilverHomeInput", "mobil test");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  const after = await readMenuState(page);

  const pass =
    before.narrow === true &&
    after.menuHidden === true &&
    (after.menuDisplay === "none" || after.menuDisplay === "");

  await context.close();
  return { viewport: vp.name, pass, menuHidden: after.menuHidden, menuDisplay: after.menuDisplay };
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    process.stdout.write(JSON.stringify({ pass: false, stage: "static", fails: staticResult.fails }) + "\n");
    process.exitCode = 1;
    return;
  }

  let serverChild = null;
  if (USE_LOCAL_SERVER) {
    try {
      serverChild = await startLocalServer();
      await verifyLocalServerContent();
    } catch (e) {
      process.stdout.write(JSON.stringify({ pass: false, stage: "server", error: String(e) }) + "\n");
      process.exitCode = 1;
      return;
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const pc = await runPcProof(browser);
    const mobile = await runMobileTabletProof(browser, { name: "MOBILE", width: 390, height: 844 });
    const tablet = await runMobileTabletProof(browser, { name: "TABLET", width: 768, height: 1024 });
    const pass = pc.pass && mobile.pass && tablet.pass;
    process.stdout.write(JSON.stringify({ pass, static: staticResult, pc, mobile, tablet }) + "\n");
    if (!pass) process.exitCode = 1;
  } finally {
    await browser.close();
    if (serverChild) {
      try {
        serverChild.close();
      } catch (_) {}
    }
  }
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ pass: false, error: String(e && e.message ? e.message : e) }) + "\n");
  process.exitCode = 1;
});

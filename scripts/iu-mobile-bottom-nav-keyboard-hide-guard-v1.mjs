#!/usr/bin/env node
/**
 * P0: mobil/tablet — spodní navigace se při otevřené systémové klávesnici skryje
 * a uvolní reserved prostor (--bottom-nav-height / safe-space). Desktop beze změny.
 * Run: npm run iu-mobile-bottom-nav-keyboard-hide-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const APP = path.join(REPO, "assets", "app.js");
const UNIFIED = path.join(REPO, "assets", "iu-overlay-mobile-tablet-unified-v1.css");
const INDEX = path.join(REPO, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8898", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const CSS_BUST = "ds-mobile-overlay-nav-flush-v1-20260713-bottom-nav-keyboard-hide-v1-20260802";
const JS_BUST_TOKEN = "bottom-nav-keyboard-hide-v1-20260802";

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
];

function staticGate() {
  const app = fs.readFileSync(APP, "utf8");
  const unified = fs.readFileSync(UNIFIED, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");

  const hideChunk = (() => {
    const parts = app.split("function iuMobileBottomNavKeyboardHideInit()");
    return parts[1] ? parts[1].split(/\n  function /)[0] : "";
  })();

  const checks = [
    {
      id: "hide_init_fn",
      pass: /function iuMobileBottomNavKeyboardHideInit\(\)/.test(app),
    },
    {
      id: "hide_init_boot",
      pass: /iuMobileBottomNavKeyboardHideInit\(\)/.test(app),
    },
    {
      id: "hide_sets_iu_keyboard_open",
      pass: /classList\.add\("iu-keyboard-open"\)/.test(hideChunk),
    },
    {
      id: "hide_uses_visual_viewport",
      pass: /visualViewport/.test(hideChunk),
    },
    {
      id: "hide_max_width_1024",
      pass: /max-width:\s*1024px/.test(hideChunk),
    },
    {
      id: "hide_no_translate_pin",
      pass: !/translate3d\(0,\s*"\s*\+\s*gap/.test(hideChunk),
    },
    {
      id: "alias_pin_calls_hide",
      pass: /function iuMojeSluzbyFormBottomNavKeyboardPinInit\(\)\s*\{\s*iuMobileBottomNavKeyboardHideInit\(\);\s*\}/.test(
        app
      ),
    },
    {
      id: "unified_keyboard_open_vars",
      pass: /html\.iu-keyboard-open\s*\{[\s\S]*--bottom-nav-height:\s*0px/.test(unified),
    },
    {
      id: "unified_keyboard_open_nav_display_none",
      pass: /html\.iu-keyboard-open #iuMobileBottomNav\.iu-mobileBottomNav[\s\S]*display:\s*none !important/.test(
        unified
      ),
    },
    {
      id: "index_keyboard_open_nav_display_none",
      pass:
        /html\.iu-keyboard-open #iuMobileBottomNav\.iu-mobileBottomNav/.test(index) &&
        /iu-keyboard-open #iuMobileBottomNav[\s\S]*display:none!important/.test(index),
    },
    {
      id: "index_css_cache_bust",
      pass: new RegExp(`iu-overlay-mobile-tablet-unified-v1\\.css\\?v=${CSS_BUST}`).test(index),
    },
    {
      id: "index_app_cache_bust",
      pass: new RegExp(`app\\.js\\?v=[^"']*${JS_BUST_TOKEN}`).test(index),
    },
  ];

  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails, checks };
}

function waitForPort(host, port, timeoutMs) {
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

async function measureKeyboardState(page, forceOpen) {
  return page.evaluate((open) => {
    const root = document.documentElement;
    if (open) {
      root.classList.add("iu-keyboard-open");
      document.body.classList.add("iu-keyboard-open");
    } else {
      root.classList.remove("iu-keyboard-open");
      document.body.classList.remove("iu-keyboard-open");
    }
    const nav = document.getElementById("iuMobileBottomNav");
    const cs = nav ? getComputedStyle(nav) : null;
    const rootCs = getComputedStyle(root);
    const rect = nav ? nav.getBoundingClientRect() : null;
    return {
      hasClass: root.classList.contains("iu-keyboard-open"),
      display: cs ? cs.display : "missing",
      visibility: cs ? cs.visibility : "missing",
      height: rect ? Math.round(rect.height) : -1,
      bottomNavHeight: String(rootCs.getPropertyValue("--bottom-nav-height") || "").trim(),
      safeSpace: String(rootCs.getPropertyValue("--iu-mobile-bottom-nav-safe-space") || "").trim(),
    };
  }, forceOpen);
}

async function runViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("#iuMobileBottomNav", { timeout: 15000 });
    await page.waitForTimeout(400);

    const closed = await measureKeyboardState(page, false);
    const open = await measureKeyboardState(page, true);
    const restored = await measureKeyboardState(page, false);

    const closedOk =
      closed.display !== "none" && closed.height > 40 && !/^0px$/.test(closed.bottomNavHeight);
    const openOk =
      open.hasClass === true &&
      open.display === "none" &&
      open.height === 0 &&
      (/^0px$/.test(open.bottomNavHeight) || open.bottomNavHeight === "0");
    const restoredOk =
      restored.hasClass === false &&
      restored.display !== "none" &&
      restored.height > 40 &&
      !/^0px$/.test(restored.bottomNavHeight);

    return {
      viewport: vp.name,
      pass: closedOk && openOk && restoredOk,
      closedOk,
      openOk,
      restoredOk,
      closed,
      open,
      restored,
    };
  } finally {
    await context.close();
  }
}

async function runDesktop(browser) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    const desk = await page.evaluate(() => {
      const nav = document.getElementById("iuMobileBottomNav");
      const before = nav ? getComputedStyle(nav).display : "missing";
      document.documentElement.classList.add("iu-keyboard-open");
      const after = nav ? getComputedStyle(nav).display : "missing";
      document.documentElement.classList.remove("iu-keyboard-open");
      return { beforeDisplay: before, afterDisplay: after };
    });
    return {
      viewport: "DESKTOP",
      pass: desk.beforeDisplay === "none" && desk.afterDisplay === "none",
      desk,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log("IU_MOBILE_BOTTOM_NAV_KEYBOARD_HIDE_GUARD_FAIL");
    staticResult.fails.forEach((f) => console.error("static:" + f));
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const fp = path.join(REPO, p.replace(/^\/+/, ""));
      if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const mime =
        fp.endsWith(".css")
          ? "text/css; charset=utf-8"
          : fp.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : fp.endsWith(".html")
              ? "text/html; charset=utf-8"
              : "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(fs.readFileSync(fp));
    } catch (_) {
      res.writeHead(500);
      res.end("err");
    }
  });

  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  await waitForPort("127.0.0.1", PORT, 10000);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const vp of VIEWPORTS) {
      results.push(await runViewport(browser, vp));
    }
    results.push(await runDesktop(browser));
  } finally {
    await browser.close();
    server.close();
  }

  const pass = results.every((r) => r.pass);
  if (!pass) {
    console.log("IU_MOBILE_BOTTOM_NAV_KEYBOARD_HIDE_GUARD_FAIL");
    results.filter((r) => !r.pass).forEach((f) => console.error(JSON.stringify(f)));
    process.exit(1);
  }
  console.log("IU_MOBILE_BOTTOM_NAV_KEYBOARD_HIDE_GUARD_PASS");
  results.forEach((r) => console.log(r.viewport + ":PASS"));
}

main().catch((err) => {
  console.log("IU_MOBILE_BOTTOM_NAV_KEYBOARD_HIDE_GUARD_FAIL");
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});

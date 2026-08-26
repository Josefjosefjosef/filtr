#!/usr/bin/env node
/**
 * Vlastní tlačítka — mobil/tablet scroll clearance nad spodní navigací.
 * Run: npm run iu-custom-buttons-mobile-scroll-guard
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext, waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const UNIFIED = path.join(REPO, "assets", "iu-overlay-mobile-tablet-unified-v1.css");
const CUSTOM = path.join(REPO, "assets", "iu-custom-buttons-overlay.css");
const INDEX = path.join(REPO, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8898", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const ITEM_COUNT = 18;

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
];

function staticGate() {
  const unified = fs.readFileSync(UNIFIED, "utf8");
  const custom = fs.readFileSync(CUSTOM, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const checks = [
    {
      id: "custom_buttons_scrollhost_rule",
      pass: /body\.iu-custom-buttons-overlay-open #iuCustomButtonsScrollHost\.iu-custom-buttons-overlay-scrollHost[\s\S]*overflow-y: auto !important/.test(unified),
    },
    {
      id: "custom_buttons_excluded_from_cardshell_scroll",
      pass: !/#iuInvoicePanel\.iu-invoice-overlay-panel:not\(\[hidden\]\) \.iu-invoice-overlay-cardShell,\s*\n\s*#iuCustomButtonsPanel/.test(unified),
    },
    {
      id: "custom_overlay_panel_bottom_inset",
      pass: /bottom: var\(--iu-tool-overlay-panel-bottom/.test(custom),
    },
    {
      id: "index_cache_bust",
      pass: /custom-buttons-dynamic-bottom-clearance-v1-20260804/.test(index),
    },
    {
      id: "tile_min_height_not_fixed_max",
      pass: /min-height:\s*96px\s*!important/.test(custom) && /max-height:\s*none\s*!important/.test(custom) && !/max-height:\s*96px\s*!important/.test(custom),
    },
    {
      id: "tile_text_wrap_anywhere",
      pass: /overflow-wrap:\s*anywhere\s*!important/.test(custom) && /-webkit-line-clamp:\s*unset\s*!important/.test(custom),
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

async function seedButtons(page) {
  await page.evaluate((n) => {
    const cfg = {
      version: 2,
      order: ["pridat_tlacitko"],
      visible: ["pridat_tlacitko"],
      customButtons: Array.from({ length: n }, (_, i) => ({
        id: "cb_" + i,
        label: "Tlačítko " + (i + 1),
        url: "https://example.com/" + (i + 1),
        color: "#2563EB",
      })),
    };
    localStorage.setItem("infouzel_quicktools", JSON.stringify(cfg));
  }, ITEM_COUNT);
}

async function openViaGate(page) {
  await page.evaluate(() => {
    const tab = document.getElementById("iuMobileGateTabTools");
    const panel = document.getElementById("iuMobileGatePanelTools");
    if (!tab) return;
    if (panel && !panel.hidden) return;
    tab.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('[data-iu-action="custom-buttons"]')?.click());
  await page.waitForTimeout(800);
}

async function ensureKeyboardClosedNavVisible(page) {
  await page.evaluate(() => {
    try {
      const ae = document.activeElement;
      if (ae && typeof ae.blur === "function") ae.blur();
    } catch (_) {}
    try {
      document.documentElement.classList.remove("iu-keyboard-open");
      if (document.body) document.body.classList.remove("iu-keyboard-open");
    } catch (_) {}
  });
  await page.waitForTimeout(220);
  await page.waitForFunction(() => {
    const nav = document.getElementById("iuMobileBottomNav");
    if (!nav) return false;
    const cs = getComputedStyle(nav);
    return cs.display !== "none" && nav.getBoundingClientRect().height > 40;
  }, { timeout: 5000 });
}

async function measureScroll(page) {
  await ensureKeyboardClosedNavVisible(page);
  return page.evaluate(async () => {
    const nav = document.getElementById("iuMobileBottomNav");
    const scrollHost = document.getElementById("iuCustomButtonsScrollHost");
    const cardShell = document.querySelector("#iuCustomButtonsPanel .iu-custom-buttons-overlay-cardShell");
    const lastItem = document.querySelector("#iuCustomButtonsList .iu-custom-buttons-item:last-of-type");
    const lastDelete = lastItem?.querySelector(".iu-custom-buttons-item-delete");

    function cs(el) {
      if (!el) return null;
      const st = getComputedStyle(el);
      return { overflow: st.overflowY, display: st.display, height: st.height, pb: st.paddingBottom };
    }

    const scroller = scrollHost;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    if (lastDelete) {
      try {
        lastDelete.scrollIntoView({ block: "end", behavior: "instant" });
      } catch (_) {
        lastDelete.scrollIntoView(false);
      }
    }
    await new Promise((r) => setTimeout(r, 120));

    const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
    const deleteBottom = lastDelete ? lastDelete.getBoundingClientRect().bottom : 0;
    const gap = navTop - deleteBottom;

    return {
      scrollHost: cs(scrollHost),
      cardShell: cs(cardShell),
      scrollerIsScrollHost: scroller && getComputedStyle(scroller).overflowY === "auto",
      navTop,
      deleteBottom,
      gap,
      lastDeleteVisible: gap >= 8,
      itemCount: document.querySelectorAll("#iuCustomButtonsList .iu-custom-buttons-item").length,
    };
  });
}

async function runViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
  await waitForVaultReady(page, 60000);
  await seedButtons(page);
  await page.reload({ waitUntil: "load" });
  await waitForVaultReady(page, 60000);
  await page.waitForTimeout(500);
  await openViaGate(page);
  const first = await measureScroll(page);
  await page.evaluate(() => document.getElementById("iuCustomButtonsClose")?.click());
  await page.waitForTimeout(400);
  await openViaGate(page);
  const reopen = await measureScroll(page);
  await context.close();
  return {
    viewport: vp.name,
    first,
    reopen,
    pass:
      first.lastDeleteVisible &&
      reopen.lastDeleteVisible &&
      first.scrollerIsScrollHost &&
      reopen.scrollerIsScrollHost,
  };
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log(JSON.stringify({ result: "FAIL", phase: "static", ...staticResult }, null, 2));
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
      const ext = path.extname(fp).toLowerCase();
      const mime =
        ext === ".css" ? "text/css; charset=utf-8" :
        ext === ".js" ? "text/javascript; charset=utf-8" :
        ext === ".html" ? "text/html; charset=utf-8" :
        ext === ".json" ? "application/json; charset=utf-8" :
        "application/octet-stream";
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
  for (const vp of VIEWPORTS) {
    results.push(await runViewport(browser, vp));
  }
  await browser.close();
  server.close();

  const pass = results.every((r) => r.pass);
  console.log(JSON.stringify({ result: pass ? "PASS" : "FAIL", static: staticResult, viewports: results }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

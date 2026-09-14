#!/usr/bin/env node
/**
 * Mobile/tablet: combined RYCHLÝ PŘEHLED ⇄ SLEDOVÁNÍ ZÁSILEK module (≤1024).
 * Desktop (≥1025): module/info hidden; parcel via desktop overlay path.
 * Replaces prior "parcel section above quick section" order check.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8987", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media&iuInfoSystem=cutover&nosw=1`;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function staticGate() {
  const index = read("projects/index.html");
  const mobileCss = read("assets/iu-mobile-info-panel.css");

  must(/home-quick-parcel-switcher-v1-20260914/.test(index), "static:marker");
  const modIdx = index.indexOf('id="iuHomeQuickParcelModule"');
  const parcelIdx = index.indexOf('id="iuSilverParcelWatch"', modIdx);
  const infoIdx = index.indexOf("iuHomeSectionUnit--info", modIdx);
  must(modIdx > 0 && parcelIdx > modIdx && infoIdx > modIdx, "static:dom_inside_module");
  must(
    /\.iu-info-cards-mobile-tablet \+ #iuHomeQuickParcelModule/.test(mobileCss),
    "static:css_cards_module_spacing"
  );
  must(
    /#iuHomeQuickParcelModule\s*\{[^}]*--iu-home-section-gap/s.test(mobileCss) ||
      /#iuHomeQuickParcelModule/.test(mobileCss),
    "static:css_module_gap"
  );
  must(/iuHomeQuickParcelPanelParcel/.test(index), "static:parcel_panel_slot");
  must(/parcelPanel\.appendChild\(parcel\)/.test(index), "static:mobile_parcel_placement");
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

async function measureOrder(page) {
  return page.evaluate(() => {
    const mod = document.getElementById("iuHomeQuickParcelModule");
    const sw = document.getElementById("iuHomeQuickParcelSwitcher");
    const parcel = document.getElementById("iuSilverParcelWatch");
    const panel = document.getElementById("iuHomeQuickParcelPanelParcel");
    const pick = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        top: r.top,
        bottom: r.bottom,
        display: cs.display,
        visibility: cs.visibility,
        height: r.height,
      };
    };
    return {
      mod: pick(mod),
      sw: pick(sw),
      mode: mod ? mod.getAttribute("data-iu-mode") : null,
      parcelInPanel: !!(panel && parcel && panel.contains(parcel)),
      label: sw ? ((sw.querySelector("[data-iu-switcher-label]") || {}).textContent || "") : "",
    };
  });
}

async function runPlaywright() {
  const server = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    const browser = await chromium.launch({ headless: true });
    const viewports = [
      { name: "mobile", width: 390, height: 844, expectModule: true },
      { name: "mobile-small", width: 360, height: 640, expectModule: true },
      { name: "tablet-portrait", width: 768, height: 1024, expectModule: true },
      { name: "tablet-landscape", width: 1024, height: 768, expectModule: true },
      { name: "desktop", width: 1280, height: 900, expectModule: false },
    ];
    try {
      for (const vp of viewports) {
        const context = await bootstrapGuardContext(browser, {
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.width <= 1024,
          hasTouch: vp.width <= 1024,
        });
        const page = await bootstrapGuardPage(context);
        await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 45000 });
        await page.waitForTimeout(600);

        const m = await measureOrder(page);
        const prefix = vp.name;

        if (vp.expectModule) {
          must(!!m.mod && m.mod.height > 0, prefix + ":module_visible");
          must(!!m.sw && m.sw.height >= 38, prefix + ":switcher_height:" + (m.sw && m.sw.height));
          must(m.mode === "quick", prefix + ":default_quick");
          must(/RYCHLÝ PŘEHLED/i.test(m.label), prefix + ":label_quick");
          // ≤900 keeps parcel in panel; ≥901 may move to desktop mount.
          if (vp.width < 901) {
            must(m.parcelInPanel, prefix + ":parcel_in_panel");
          }
        } else {
          must(!m.mod || m.mod.height === 0 || m.mod.display === "none", prefix + ":desktop_module_hidden");
        }

        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }
}

staticGate();
await runPlaywright();

if (fails.length) {
  console.error("[iu-home-mobile-parcel-quick-order-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-home-mobile-parcel-quick-order-guard] PASS");

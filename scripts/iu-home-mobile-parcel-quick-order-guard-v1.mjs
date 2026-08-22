#!/usr/bin/env node
/**
 * Mobile/tablet: SLEDOVÁNÍ ZÁSILEK section must appear above RYCHLÝ PŘEHLED (≤1024).
 * Desktop (≥1025): unchanged — parcel card hidden, info unit hidden.
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

  must(/home-mobile-parcel-quick-swap-v1-20260822/.test(index), "static:marker");
  const cardsIdx = index.indexOf("id=\"iuInfoCardsMobileTablet\"");
  const parcelIdx = index.indexOf("id=\"iuSilverParcelWatch\"", cardsIdx);
  const infoIdx = index.indexOf("iuHomeSectionUnit--info", cardsIdx);
  must(parcelIdx > 0 && infoIdx > 0 && parcelIdx < infoIdx, "static:dom_parcel_before_info");
  must(
    /\.iu-info-cards-mobile-tablet \+ #iuSilverParcelWatch/.test(mobileCss),
    "static:css_cards_parcel_spacing"
  );
  must(
    /#iuSilverParcelWatch \+ \.iuHomeSectionUnit--info/.test(mobileCss),
    "static:css_parcel_info_spacing"
  );
  must(
    !/\.iuHomeSectionUnit--info \+ #iuSilverParcelWatch/.test(mobileCss),
    "static:no_old_adjacent_rule"
  );
  must(/insertBefore\(parcel,\s*infoUnit\)/.test(index), "static:mobile_parcel_placement");
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
    const infoBar = Array.from(document.querySelectorAll(".iuHomeSectionBar")).find((el) =>
      /RYCHLÝ PŘEHLED/i.test(el.textContent || "")
    );
    const parcelBar = Array.from(document.querySelectorAll(".iuHomeSectionBar")).find((el) =>
      /SLEDOVÁNÍ ZÁSILEK/i.test(el.textContent || "")
    );
    const parcel = document.getElementById("iuSilverParcelWatch");
    const pick = (el) => {
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
    const stack = document.getElementById("iuSilverWelcomeStack");
    const infoUnit = stack ? stack.querySelector(".iuHomeSectionUnit--info") : null;
    let domParcelBeforeInfo = true;
    if (parcel && infoUnit && stack && stack.contains(parcel)) {
      domParcelBeforeInfo = !!(parcel.compareDocumentPosition(infoUnit) & Node.DOCUMENT_POSITION_FOLLOWING);
    }
    return {
      infoBar: infoBar ? pick(infoBar) : null,
      parcelBar: parcelBar ? pick(parcelBar) : null,
      domParcelBeforeInfo,
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
      { name: "mobile", width: 390, height: 844, expectParcel: true },
      { name: "mobile-small", width: 360, height: 640, expectParcel: true },
      { name: "tablet-portrait", width: 768, height: 1024, expectParcel: true },
      { name: "tablet-landscape", width: 1024, height: 768, expectParcel: false },
      { name: "desktop", width: 1280, height: 900, expectParcel: false },
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

        must(m.domParcelBeforeInfo, prefix + ":dom_order");

        if (vp.expectParcel) {
          must(!!m.parcelBar && !!m.infoBar, prefix + ":bars_visible");
          must(
            m.parcelBar.height > 0 && m.infoBar.height > 0,
            prefix + ":bars_height:" + m.parcelBar.height + "," + m.infoBar.height
          );
          must(m.parcelBar.top < m.infoBar.top, prefix + ":visual_parcel_above_info:" + m.parcelBar.top + "," + m.infoBar.top);
        } else if (vp.width >= 1025) {
          must(!m.parcelBar || m.parcelBar.height === 0 || m.parcelBar.display === "none", prefix + ":desktop_parcel_hidden");
          must(!m.infoBar || m.infoBar.height === 0 || m.infoBar.display === "none", prefix + ":desktop_info_hidden");
        } else {
          must(!m.parcelBar || m.parcelBar.height === 0, prefix + ":wide_tablet_parcel_hidden");
          must(!!m.infoBar && m.infoBar.height > 0, prefix + ":wide_tablet_info_visible");
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

#!/usr/bin/env node
/**
 * Mobile/tablet/PWA: SLEDOVÁNÍ ZÁSILEK card must not keep empty-list margin slack,
 * and gap parcel→Rychlý přehled must match gap Rychlý přehled→Můj přehled dne.
 *
 * Run: npm run iu-home-parcel-card-height-gap-guard
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

const PORT = parseInt(process.env.IU_GUARD_PORT || "8993", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media&iuInfoSystem=cutover&nosw=1`;
const fails = [];
const GAP_TOL_PX = 3;
const EMPTY_BELOW_MAX_PX = 6;

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function staticGate() {
  const parcelCss = read("assets/iu-silver-parcel-dashboard.css");
  const mobileCss = read("assets/iu-mobile-info-panel.css");
  const index = read("projects/index.html");

  must(
    /\.iuSilverParcelWatch__list:empty/.test(parcelCss) &&
      /\.iuSilverParcelWatch__completed:empty/.test(parcelCss),
    "static:empty_list_collapse"
  );
  must(
    /--iuParcelCardH:\s*0px/.test(parcelCss) || /min-height:\s*0/.test(parcelCss),
    "static:no_artificial_card_min_height"
  );
  must(/--iu-home-section-gap/.test(mobileCss) || /--iu-home-section-gap/.test(index), "static:gap_token");
  must(
    /#iuSilverParcelWatch \+ \.iuHomeSectionUnit--info\s*\{[^}]*margin-top:\s*var\(--iu-home-section-gap/s.test(
      mobileCss
    ),
    "static:parcel_info_gap_token"
  );
  must(
    !/#iuSilverParcelWatch\s*\{[^}]*min-height:\s*176px/s.test(index) &&
      !/min-height:\s*176px\s*!important/.test(index),
    "static:index_no_176_minheight"
  );
  must(/parcel-card-content-height-gap-v1-20260904/.test(index), "static:parcel_css_cache_bust");
  must(/home-section-gap-unify-v1-20260904/.test(index), "static:info_css_cache_bust");
  must(/rychly-prehled-vertical-scroll-v1-20260903/.test(index), "static:info_css_vertical_scroll_bust");
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

async function measure(page) {
  return page.evaluate(() => {
    const card = document.getElementById("iuSilverParcelWatch");
    const hero = card ? card.querySelector(".iuSilverParcelWatch__hero") : null;
    const illus = card ? card.querySelector(".iuSilverParcelWatch__illus") : null;
    const illusImg = card ? card.querySelector(".iuSilverParcelWatch__illusImg") : null;
    const list = document.getElementById("iuSilverParcelWatchList");
    const completed = document.getElementById("iuSilverParcelWatchCompleted");
    const info = document.querySelector(".iuHomeSectionUnit--info");
    const pd = document.getElementById("iuSilverTallScrollSection");
    if (!card || !hero || !info || !pd) {
      return { ok: false, reason: "missing_nodes" };
    }
    const cr = card.getBoundingClientRect();
    const hr = hero.getBoundingClientRect();
    const ir = illus ? illus.getBoundingClientRect() : hr;
    const cs = getComputedStyle(card);
    const padB = parseFloat(cs.paddingBottom) || 0;
    const contentBottom = Math.max(hr.bottom, ir.bottom);
    const emptyBelow = cr.bottom - padB - contentBottom;
    const infoR = info.getBoundingClientRect();
    const pdR = pd.getBoundingClientRect();
    const gap1 = infoR.top - cr.bottom;
    const gap2 = pdR.top - infoR.bottom;
    const listMt = list ? parseFloat(getComputedStyle(list).marginTop) || 0 : 0;
    const completedMt = completed ? parseFloat(getComputedStyle(completed).marginTop) || 0 : 0;
    const listEmpty = !!(list && list.childElementCount === 0);
    const completedEmpty = !!(completed && completed.childElementCount === 0);
    const illusFullyVisible =
      !!illusImg &&
      illusImg.getBoundingClientRect().height > 40 &&
      illusImg.getBoundingClientRect().bottom <= cr.bottom + 2;
    const shell = card.querySelector(".iuSilverParcelWatch__mainShell");
    const shellInside =
      !!shell &&
      shell.getBoundingClientRect().bottom <= cr.bottom + 2 &&
      shell.getBoundingClientRect().top >= cr.top - 2;
    return {
      ok: true,
      cardH: Math.round(cr.height),
      minHeight: cs.minHeight,
      emptyBelow: Math.round(emptyBelow * 10) / 10,
      gapParcelToInfo: Math.round(gap1 * 10) / 10,
      gapInfoToPd: Math.round(gap2 * 10) / 10,
      listEmpty,
      completedEmpty,
      listMt,
      completedMt,
      illusFullyVisible,
      shellInside,
      illusH: Math.round(ir.height),
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
      { name: "mobile-small", width: 360, height: 640 },
      { name: "iphone", width: 390, height: 844 },
      { name: "mobile-large", width: 430, height: 932 },
      { name: "tablet-portrait", width: 768, height: 1024 },
      { name: "tablet-landscape", width: 1024, height: 768 },
    ];
    try {
      for (const vp of viewports) {
        const context = await bootstrapGuardContext(browser, {
          viewport: { width: vp.width, height: vp.height },
          isMobile: true,
          hasTouch: true,
        });
        const page = await bootstrapGuardPage(context);
        await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForFunction(() => document.getElementById("iuSilverParcelWatch"), {
          timeout: 45000,
        });
        await page.evaluate(() => {
          document.body.classList.add("iu-home");
          document.body.classList.remove("iu-mobileMainVisible", "iu-mobileGateOverlayOpen");
          document.body.setAttribute("data-iu-fc", "1");
        });
        await page.waitForTimeout(700);
        const m = await measure(page);
        const p = vp.name;
        must(m.ok, p + ":measure_ok:" + (m.reason || ""));
        if (!m.ok) {
          await context.close();
          continue;
        }
        // At 1024 landscape, desktop-ish rules may hide parcel — accept either visible compact or hidden.
        const cardVisible = m.cardH > 40;
        if (!cardVisible) {
          must(vp.width >= 1024, p + ":unexpected_hidden_card");
          await context.close();
          continue;
        }
        must(m.emptyBelow <= EMPTY_BELOW_MAX_PX, p + ":empty_below:" + m.emptyBelow);
        must(
          Math.abs(m.gapParcelToInfo - m.gapInfoToPd) <= GAP_TOL_PX,
          p + ":gap_mismatch:" + m.gapParcelToInfo + "!=" + m.gapInfoToPd
        );
        must(m.gapParcelToInfo >= 12 && m.gapParcelToInfo <= 22, p + ":gap_range:" + m.gapParcelToInfo);
        if (m.listEmpty) must(m.listMt === 0, p + ":list_empty_mt:" + m.listMt);
        if (m.completedEmpty) must(m.completedMt === 0, p + ":completed_empty_mt:" + m.completedMt);
        must(m.illusFullyVisible, p + ":illus_visible");
        must(m.shellInside, p + ":shell_inside");
        must(m.illusH >= 100, p + ":illus_height:" + m.illusH);
        must(
          m.minHeight === "0px" || m.minHeight === "auto" || parseFloat(m.minHeight) === 0,
          p + ":min_height:" + m.minHeight
        );
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
  console.error("[iu-home-parcel-card-height-gap-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-home-parcel-card-height-gap-guard] PASS");

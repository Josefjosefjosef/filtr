#!/usr/bin/env node
/**
 * Menu → subsection scroll lock guard (mobile / tablet / PWA band ≤900).
 *
 * Root cause: tablet Menu hard-nav (768–900) assigned ?section=… while retaining #iu-nav.
 * Cold load then re-opened the gate overlay (html/body overflow:hidden) so the subsection
 * could not be finger-scrolled. Phone SPA path cleared the hash; tablet hard-nav did not.
 *
 * Guards:
 *  - STATIC: hard-nav clears u.hash before location.assign
 *  - RUNTIME phone + tablet: Menu → Mapy / Počasí / Cestovní kanceláře → scroll range > 0,
 *    gate closed, no leftover #iu-nav, html/body not overflow:hidden
 *  - LIFECYCLE: Menu → section → Back → other section → scroll still works
 *
 * Run: npm run iu-menu-subsection-scroll-guard
 */
import { createRequire } from "module";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import fs from "fs";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8923", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL = !process.env.IU_GUARD_BASE_URL;
const MIN_SCROLL = 120;

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet-portrait", width: 820, height: 1180 },
];

const SECTIONS = [
  { id: "mapy", re: /Mapy/i },
  { id: "pocasi", re: /Počasí|Pocasi/i },
  { id: "aff-cestovni-kancelare", re: /Cestovní kanceláře|Cestovni kancelare/i },
];

function fail(msg) {
  console.error("FAIL " + msg);
  process.exit(1);
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

function buildUrl() {
  const u = new URL(BASE);
  if (USE_LOCAL) u.searchParams.set("iuRobust", "1");
  else u.searchParams.set("nosw", "1");
  return u.toString();
}

function staticGuard() {
  const app = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const fn = app.match(
    /function iuTabletMenuToolHardNavIfNeeded\([\s\S]*?\n  \}/
  );
  if (!fn) fail("static:hard_nav_fn_missing");
  const body = fn[0];
  if (!/u\.hash\s*=\s*""/.test(body) && !/u\.hash\s*=\s*''/.test(body)) {
    fail("static:hard_nav_must_clear_hash");
  }
  if (!/location\.assign/.test(body)) fail("static:hard_nav_assign_missing");
  if (!/function iuWebNavOverlayHashYieldToSectionQuery/.test(app)) {
    fail("static:yield_helper_missing");
  }
  console.log("PASS static:hard_nav_clears_overlay_hash");
}

async function seed(ctx) {
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("iu:terms:accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted-version:v1", "2026-09-08-v1");
      localStorage.setItem("iu:terms:accepted-at:v1", new Date().toISOString());
    } catch (_) {}
  });
}

async function dismissTerms(page) {
  await page.evaluate(() => {
    try {
      document.documentElement.classList.remove("iu-terms-gate-open");
      document.body.classList.remove("iu-terms-gate-open");
      const t = document.getElementById("iuTermsGate");
      if (t) t.hidden = true;
      const c = document.getElementById("iuConsentLayer");
      if (c) c.hidden = true;
    } catch (_) {}
  });
}

async function snap(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    const windowMax = Math.max(0, (se ? se.scrollHeight : 0) - (window.innerHeight || 0));
    const lc = document.getElementById("leftContent");
    const lcCs = lc ? getComputedStyle(lc) : null;
    const lcMax = lc ? Math.max(0, lc.scrollHeight - lc.clientHeight) : 0;
    const lcScrollable = !!(
      lc &&
      lcCs &&
      lcCs.display !== "none" &&
      (lcCs.overflowY === "auto" || lcCs.overflowY === "scroll") &&
      lcMax > 0
    );
    return {
      href: location.href,
      hash: location.hash,
      section: document.body.getAttribute("data-section"),
      gate: document.body.classList.contains("iu-mobileGateOverlayOpen"),
      main: document.body.classList.contains("iu-mobileMainVisible"),
      htmlOv: getComputedStyle(document.documentElement).overflowY,
      bodyOv: getComputedStyle(document.body).overflowY,
      lcOv: lcCs ? lcCs.overflowY : null,
      effMax: Math.max(windowMax, lcScrollable ? lcMax : 0),
      windowMax,
      lcMax: lcScrollable ? lcMax : 0,
    };
  });
}

async function tryScroll(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    const windowMax = Math.max(0, (se ? se.scrollHeight : 0) - (window.innerHeight || 0));
    const lc = document.getElementById("leftContent");
    const lcCs = lc ? getComputedStyle(lc) : null;
    const lcMax = lc ? Math.max(0, lc.scrollHeight - lc.clientHeight) : 0;
    const useLc = !!(
      lc &&
      lcCs &&
      (lcCs.overflowY === "auto" || lcCs.overflowY === "scroll") &&
      lcMax > windowMax
    );
    /* reset to top so delta is measurable even after prior scrolls */
    if (useLc) lc.scrollTop = 0;
    else {
      window.scrollTo(0, 0);
      if (se) se.scrollTop = 0;
    }
    const before = 0;
    if (useLc) lc.scrollTop = 350;
    else {
      window.scrollTo(0, 350);
      if (se) se.scrollTop = 350;
    }
    const after = useLc ? lc.scrollTop : Math.max(window.scrollY || 0, se ? se.scrollTop : 0);
    return { delta: after - before, scroller: useLc ? "leftContent" : "window", max: useLc ? lcMax : windowMax };
  });
}

async function openMenu(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('[data-iu-bottom-nav="menu"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);
  const open = await page.evaluate(() => document.body.classList.contains("iu-mobileGateOverlayOpen"));
  if (!open) {
    await page.evaluate(() => {
      const tab = document.getElementById("iuMobileGateTabNav");
      if (tab) tab.click();
    });
    await page.waitForTimeout(600);
  }
}

async function clickRail(page, re) {
  return page.evaluate((src) => {
    const re = new RegExp(src, "i");
    const root = document.querySelector("#iuMobileGatePanelNav") || document.body;
    const nodes = root.querySelectorAll("a.iu-leftNavItem,.iu-leftNavItem,.iuHex,[data-section]");
    for (const n of nodes) {
      if (re.test(String(n.textContent || ""))) {
        n.click();
        return String(n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
      }
    }
    return null;
  }, re.source);
}

async function goBackToMenu(page) {
  await page.evaluate(() => {
    const bot = document.querySelector('[data-iu-bottom-nav="back"]');
    if (bot && typeof bot.click === "function") {
      bot.click();
      return;
    }
    const b = document.getElementById("iuMobileMainBackBar");
    if (b && typeof b.click === "function") {
      b.click();
      return;
    }
    history.back();
  });
  await page.waitForTimeout(1200);
  await dismissTerms(page);
  let s = await snap(page);
  if (s.gate) return;
  /* if Back landed on hub, reopen Menu */
  await openMenu(page);
  await page.waitForTimeout(500);
  s = await snap(page);
  if (!s.gate) {
    await page.evaluate(() => {
      const w = document.getElementById("iuMobileGateWrap");
      if (w && typeof w.__iuMobileGateSetTab === "function") w.__iuMobileGateSetTab("nav");
    });
    await page.waitForTimeout(500);
  }
}

function assertSectionOk(label, s, scroll) {
  if (s.hash === "#iu-nav" || s.hash === "#nav") fail(label + ": leftover overlay hash " + s.hash);
  if (s.gate) fail(label + ": gate still open");
  if (!s.main) fail(label + ": iu-mobileMainVisible missing");
  if (s.htmlOv === "hidden") fail(label + ": html overflow-y hidden");
  if (s.bodyOv === "hidden") fail(label + ": body overflow-y hidden");
  if (s.effMax < MIN_SCROLL) fail(label + ": effMax too small (" + s.effMax + ")");
  if (!scroll || (scroll.delta < 20 && scroll.max >= MIN_SCROLL)) {
    fail(label + ": scroll delta too small (" + (scroll && scroll.delta) + "/" + (scroll && scroll.max) + ")");
  }
}

async function runViewport(browser, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  await seed(ctx);
  const page = await ctx.newPage();

  for (const sec of SECTIONS) {
    await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
    try {
      await page.waitForLoadState("networkidle", { timeout: 20000 });
    } catch (_) {}
    await page.waitForTimeout(700);
    await dismissTerms(page);
    await openMenu(page);
    const navP = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    const clicked = await clickRail(page, sec.re);
    if (!clicked) fail(vp.name + ":" + sec.id + ": rail item not found");
    await navP;
    await page.waitForTimeout(1400);
    await dismissTerms(page);
    const s = await snap(page);
    const scroll = await tryScroll(page);
    assertSectionOk(vp.name + ":" + sec.id, s, scroll);
    console.log(
      "PASS " +
        vp.name +
        ":" +
        sec.id +
        " effMax=" +
        s.effMax +
        " delta=" +
        scroll.delta +
        " hash=" +
        JSON.stringify(s.hash)
    );
  }

  /* lifecycle: mapy → back → aff → back → pocasi */
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(700);
  await dismissTerms(page);
  for (const sec of SECTIONS) {
    await openMenu(page);
    const navP = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    const clicked = await clickRail(page, sec.re);
    if (!clicked) fail(vp.name + ":lifecycle:" + sec.id + ": missing");
    await navP;
    await page.waitForTimeout(1200);
    await dismissTerms(page);
    const s = await snap(page);
    const scroll = await tryScroll(page);
    assertSectionOk(vp.name + ":lifecycle:" + sec.id, s, scroll);
    await goBackToMenu(page);
  }
  console.log("PASS " + vp.name + ":lifecycle");
  await ctx.close();
}

async function main() {
  staticGuard();
  let server = null;
  if (USE_LOCAL) {
    server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    await waitForPort("127.0.0.1", PORT, 30000);
  }
  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      await runViewport(browser, vp);
    }
  } finally {
    await browser.close();
    if (server) {
      try {
        server.kill("SIGTERM");
      } catch (_) {}
    }
  }
  console.log("PASS iu-menu-subsection-scroll-guard");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

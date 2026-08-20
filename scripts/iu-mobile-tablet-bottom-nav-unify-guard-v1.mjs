#!/usr/bin/env node
/**
 * P0: mobil/tablet — jedna společná #iuMobileBottomNav (availability, scroll stability,
 * content-end, Domů/Menu/Silver/MindMenu/Zpět, keyboard hide, routing bez /projects/ hub).
 * Desktop (≥1025) beze změny (nav hidden). Hub URL always "/".
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
const SHELL = path.join(REPO, "assets", "iu-mobile-bottom-nav-shell-v1.js");
const FEED = path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js");
const LDP = path.join(REPO, "assets", "iu-local-data-protection.js");
const RESTORE = path.join(REPO, "assets", "iu-mindmenu-bottom-nav-restore-v1.css");
const INDEX = path.join(REPO, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8911", 10);
const BASE = `http://127.0.0.1:${PORT}/`;
const REPORT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu-mobile-tablet-bottom-nav-unify-guard-v1-report.json");

const VIEWPORTS = [
  { name: "m320", width: 320, height: 640 },
  { name: "m390", width: 390, height: 844 },
  { name: "m430", width: 430, height: 932 },
  { name: "t768", width: 768, height: 1024 },
  { name: "t1024", width: 1024, height: 768 },
];

function staticGate() {
  const app = [
    fs.readFileSync(APP, "utf8"),
    fs.existsSync(SHELL) ? fs.readFileSync(SHELL, "utf8") : "",
    fs.existsSync(FEED) ? fs.readFileSync(FEED, "utf8") : "",
  ].join("\n");
  const ldp = fs.readFileSync(LDP, "utf8");
  const restore = fs.readFileSync(RESTORE, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const checks = [
    { id: "single_nav_markup", pass: (index.match(/id="iuMobileBottomNav"/g) || []).length === 1 },
    { id: "nav_init_fn", pass: /function iuMobileBottomNavInit\(\)/.test(app) },
    { id: "nav_measure_fn", pass: /function iuMobileBottomNavMeasureInit\(\)/.test(app) },
    { id: "nav_measure_boot", pass: /iuMobileBottomNavMeasureInit\(\)/.test(app) },
    { id: "keyboard_hide_fn", pass: /function iuMobileBottomNavKeyboardHideInit\(\)/.test(app) },
    { id: "ldp_dismiss_fn", pass: /function dismissOpenLdpDialogForBottomNav\(\)/.test(app) },
    { id: "ldp_dismiss_on_home", pass: /if \(k === "home"\)[\s\S]{0,240}dismissOpenLdpDialogForBottomNav\(\)/.test(app) },
    {
      id: "ldp_dismiss_on_back",
      pass: /function closeTopMostOpenOverlayForBottomBack\(\)[\s\S]{0,1800}dismissOpenLdpDialogForBottomNav\(\)/.test(app),
    },
    { id: "ldp_mobile_leaves_nav", pass: /@media\(max-width:1024px\)[\s\S]*\.iu-ldp-backdrop[\s\S]*bottom:var\(--bottom-nav-height/.test(ldp) },
    { id: "restore_ldp_nav_z", pass: /iu-ldp-dialog-open #iuMobileBottomNav\.iu-mobileBottomNav/.test(restore) },
    { id: "hub_reset_root_comment", pass: /tvrdý návrat na čistý public hub \(\/\)/.test(app) },
    { id: "no_hardcoded_projects_hub_in_bottom_nav_init", pass: !/function iuMobileBottomNavInit[\s\S]{0,3500}\/projects\//.test(app) },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails, checks };
}

function resolveFile(urlPath) {
  let rel = String(urlPath || "/").split("?")[0].replace(/^\/+/, "");
  if (rel === "" || rel === "index.html") rel = path.join("projects", "index.html");
  if (rel === "manifest.json") rel = path.join("projects", "manifest.json");
  const fp = path.join(REPO, rel);
  const resolved = path.resolve(fp);
  if (!resolved.startsWith(path.resolve(REPO))) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  return resolved;
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const hit = resolveFile((req.url || "/").split("?")[0]);
        if (!hit) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        const mime = hit.endsWith(".css")
          ? "text/css; charset=utf-8"
          : hit.endsWith(".js") || hit.endsWith(".mjs")
            ? "text/javascript; charset=utf-8"
            : hit.endsWith(".html")
              ? "text/html; charset=utf-8"
              : hit.endsWith(".json")
                ? "application/json; charset=utf-8"
                : "application/octet-stream";
        res.writeHead(200, { "content-type": mime });
        res.end(fs.readFileSync(hit));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function measureNav(page) {
  return page.evaluate(() => {
    const navs = [...document.querySelectorAll("#iuMobileBottomNav")];
    const nav = navs[0];
    if (!nav) {
      return {
        count: 0,
        visible: false,
        pathname: location.pathname,
        href: location.href,
      };
    }
    const r = nav.getBoundingClientRect();
    const cs = getComputedStyle(nav);
    return {
      count: navs.length,
      pathname: location.pathname,
      href: location.href,
      search: location.search,
      scrollY: window.scrollY || 0,
      visible: cs.display !== "none" && cs.visibility !== "hidden" && r.height > 0 && r.width > 0,
      top: r.top,
      height: r.height,
      bottom: r.bottom,
      gapBelow: window.innerHeight - r.bottom,
      z: cs.zIndex,
      position: cs.position,
      keyboardOpen: document.documentElement.classList.contains("iu-keyboard-open"),
      gate: (document.getElementById("iuMobileGateWrap") || {}).getAttribute
        ? document.getElementById("iuMobileGateWrap").getAttribute("data-iu-mobile-gate")
        : null,
      silverOpen: !!(typeof window.iuSilverQuickPanelIsOpen === "function" && window.iuSilverQuickPanelIsOpen()),
      measuredVar: getComputedStyle(document.documentElement).getPropertyValue("--bottom-nav-height").trim(),
    };
  });
}

async function contentClearsNav(page) {
  return page.evaluate(() => {
    const nav = document.getElementById("iuMobileBottomNav");
    if (!nav) return { ok: false, reason: "no_nav" };
    const navTop = nav.getBoundingClientRect().top;
    const roots = [
      document.getElementById("feed"),
      document.getElementById("iuMobileGateWrap"),
      document.getElementById("iuCenterStage"),
      document.getElementById("leftContent"),
      document.getElementById("lastErrInline"),
    ].filter(Boolean);
    const skipIds = new Set(["iuMobileBottomNav", "iuSilverQuickPanel", "iuConsentLayer"]);
    let maxBottom = null;
    for (const root of roots) {
      const nodes = root.id === "lastErrInline" ? [root] : root.querySelectorAll("*");
      for (const el of nodes) {
        if (skipIds.has(el.id) || nav.contains(el)) continue;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || st.position === "fixed") continue;
        const r = el.getBoundingClientRect();
        if (r.height <= 0 || r.width <= 0) continue;
        if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
        if (maxBottom === null || r.bottom > maxBottom) maxBottom = r.bottom;
      }
    }
    return {
      ok: maxBottom === null || maxBottom <= navTop + 2,
      maxBottom,
      navTop,
      gap: maxBottom === null ? null : navTop - maxBottom,
    };
  });
}

/**
 * content_under_nav must not measure transitional Silver/feed boot geometry.
 * Wait until scroll-end clearance is stable across consecutive frames.
 * Still FAILs if the stable settled state has content under the nav.
 */
async function waitContentClearsNavStable(page, { timeoutMs = 12000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let stableHits = 0;
  while (Date.now() < deadline) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    );
    const cur = await contentClearsNav(page);
    if (
      last &&
      last.ok === cur.ok &&
      Math.abs((last.gap == null ? 0 : last.gap) - (cur.gap == null ? 0 : cur.gap)) < 2
    ) {
      stableHits += 1;
      if (stableHits >= 3) return cur;
    } else {
      stableHits = 1;
    }
    last = cur;
    await page.waitForTimeout(80);
  }
  return last || { ok: false, reason: "stable_timeout" };
}

async function clickNav(page, key) {
  await page.locator('#iuMobileBottomNav [data-iu-bottom-nav="' + key + '"]').first().click({ timeout: 8000 });
  await page.waitForTimeout(650);
}

async function runViewport(browser, vp) {
  const expectNav = vp.width <= 900;
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.width < 600,
    hasTouch: true,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/cloudflareinsights|favicon/i.test(m.text())) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  const fails = [];
  try {
    await page.goto(BASE + "?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2200);
    await page.evaluate(() => {
      document.querySelectorAll(".iu-ldp-backdrop").forEach((el) => el.remove());
      document.documentElement.classList.remove("iu-ldp-dialog-open");
      if (document.body) document.body.classList.remove("iu-ldp-dialog-open");
    });

    let nav = await measureNav(page);
    if ((nav.pathname || "").includes("projects")) fails.push("routing_projects_on_load");
    if (expectNav) {
      if (nav.count !== 1) fails.push("nav_count=" + nav.count);
      if (!nav.visible) fails.push("nav_not_visible");
      if (nav.position !== "fixed") fails.push("nav_not_fixed");
      if (Math.abs(nav.gapBelow || 0) > 2) fails.push("nav_gap_below=" + nav.gapBelow);
    } else if (nav.visible) {
      fails.push("nav_visible_on_wide_tablet_branch");
    }

    if (expectNav && nav.visible) {
      const before = nav;
      await page.evaluate(() => window.scrollTo(0, Math.max(800, document.documentElement.scrollHeight)));
      await page.waitForTimeout(350);
      const mid = await measureNav(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      const after = await measureNav(page);
      if (Math.abs((before.top || 0) - (mid.top || 0)) > 2 || Math.abs((before.height || 0) - (mid.height || 0)) > 2) {
        fails.push("scroll_jump");
      }
      if (mid.count !== 1 || !mid.visible) fails.push("scroll_lost_nav");
      if (Math.abs((before.top || 0) - (after.top || 0)) > 2) fails.push("scroll_restore_jump");

      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const end = await waitContentClearsNavStable(page, { timeoutMs: 12000 });
      if (!end.ok) fails.push("content_under_nav");

      await page.goto(BASE + "?section=media&topic=zpravy&cb=" + Date.now(), {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });
      await page.waitForTimeout(2000);
      await page.evaluate(() => window.scrollTo(0, 300));
      await clickNav(page, "home");
      nav = await measureNav(page);
      if ((nav.pathname || "").includes("projects")) fails.push("home_to_projects");
      if ((nav.search || "").includes("section=")) fails.push("home_kept_section");
      if ((nav.scrollY || 0) > 8) fails.push("home_not_top");

      await clickNav(page, "menu");
      const menuOpen = await measureNav(page);
      await clickNav(page, "menu");
      const menuClosed = await measureNav(page);
      if (!menuOpen.gate) fails.push("menu_open_fail");
      if (menuClosed.gate) fails.push("menu_close_fail");

      await clickNav(page, "mindmenu");
      const mindOpen = await measureNav(page);
      await clickNav(page, "mindmenu");
      const mindClosed = await measureNav(page);
      if (mindOpen.gate !== "tools") fails.push("mind_open_fail");
      if (mindClosed.gate) fails.push("mind_close_fail");

      /* Silver quick-panel toggles only off-home; open a section first. */
      await page.goto(BASE + "?section=media&topic=sport&cb=" + Date.now(), {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });
      await page.waitForTimeout(1800);
      await page.evaluate(() => {
        document.body.classList.add("iu-mobileMainVisible");
      });
      await clickNav(page, "silver");
      const silverOpen = await measureNav(page);
      await clickNav(page, "silver");
      const silverClosed = await measureNav(page);
      if (!silverOpen.silverOpen) fails.push("silver_open_fail");
      if (silverClosed.silverOpen) fails.push("silver_close_fail");

      await clickNav(page, "silver");
      await clickNav(page, "back");
      const backSilver = await measureNav(page);
      if (backSilver.silverOpen) fails.push("back_silver_fail");
      await clickNav(page, "home");

      // Keyboard: force class path + mock VV shrink via class (CSS hide)
      await page.evaluate(() => {
        document.documentElement.classList.add("iu-keyboard-open");
        if (document.body) document.body.classList.add("iu-keyboard-open");
      });
      await page.waitForTimeout(120);
      const kbOpen = await measureNav(page);
      if (kbOpen.visible) fails.push("keyboard_nav_still_visible");
      await page.evaluate(() => {
        document.documentElement.classList.remove("iu-keyboard-open");
        if (document.body) document.body.classList.remove("iu-keyboard-open");
      });
      await page.waitForTimeout(200);
      const kbClosed = await measureNav(page);
      if (!kbClosed.visible) fails.push("keyboard_nav_not_restored");
    }

    // Desktop-ish: 1025+ must hide nav (t1024 is still ≤1024 CSS branch for some rules;
    // hard PC check below).
    return {
      viewport: vp.name,
      pass: fails.length === 0,
      fails,
      consoleErrors: consoleErrors.length,
      pageErrors: pageErrors.length,
      nav,
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
    await page.goto(BASE + "?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1800);
    const nav = await measureNav(page);
    const pass = !nav.visible && !(nav.pathname || "").includes("projects");
    return { viewport: "DESKTOP_1280", pass, fails: pass ? [] : ["desktop_nav_changed_or_projects"], nav };
  } finally {
    await context.close();
  }
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log("IU_MOBILE_TABLET_BOTTOM_NAV_UNIFY_GUARD_FAIL");
    staticResult.fails.forEach((f) => console.error("static:" + f));
    process.exit(1);
  }

  const server = await startServer();
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
  const report = {
    guard: "IU_MOBILE_TABLET_BOTTOM_NAV_UNIFY_GUARD_V1",
    pass,
    static: staticResult,
    results,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  if (!pass) {
    console.log("IU_MOBILE_TABLET_BOTTOM_NAV_UNIFY_GUARD_FAIL");
    results
      .filter((r) => !r.pass)
      .forEach((r) => console.error(r.viewport + ":" + (r.fails || []).join(",")));
    process.exit(1);
  }
  console.log("IU_MOBILE_TABLET_BOTTOM_NAV_UNIFY_GUARD_PASS");
  results.forEach((r) => console.log(r.viewport + ":PASS"));
  console.log("REPORT=" + REPORT);
}

main().catch((err) => {
  console.log("IU_MOBILE_TABLET_BOTTOM_NAV_UNIFY_GUARD_FAIL");
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});

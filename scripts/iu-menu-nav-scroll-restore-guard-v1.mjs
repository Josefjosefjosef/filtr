#!/usr/bin/env node
/**
 * Menu nav panel scroll restore guard (mobile / tablet / PWA band ≤900).
 *
 * Root cause: setTab("nav") forced #iuMobileGatePanelNav.scrollTop = 0 on every
 * Menu reopen, so Back from any Menu item always jumped to the top.
 *
 * Guards:
 *  - STATIC: capture + apply helpers exist; setTab("nav") does not unconditionally zero panelNav on ≤900
 *  - RUNTIME phone + tablet: scroll Menu mid / deep → open item → Back → scrollTop restored (±8px)
 *  - No first-paint flash: restored Y must be applied before/with gate open (never land at 0 then jump)
 *
 * Run: npm run iu-menu-nav-scroll-restore-guard
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

const PORT = parseInt(process.env.IU_GUARD_PORT || "8924", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL = !process.env.IU_GUARD_BASE_URL;
const TOL = 8;

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet-portrait", width: 820, height: 1180 },
];

const DEPTHS = [
  { name: "mid", ratio: 0.45 },
  { name: "deep", ratio: 0.85 },
];

const SECTIONS = [
  { id: "mapy", re: /Mapy/i },
  { id: "aff-kosmetika", re: /Kosmetika/i },
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
  const feed = fs.readFileSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
  if (!/function iuMenuNavCaptureScroll\s*\(/.test(feed)) fail("static: missing iuMenuNavCaptureScroll");
  if (!/function iuMenuNavApplyScroll\s*\(/.test(feed)) fail("static: missing iuMenuNavApplyScroll");
  if (!/iuMenuNavCaptureScroll/.test(feed) || !/prevGateTab === "nav"/.test(feed)) {
    fail("static: setTab must capture Menu scroll when leaving nav");
  }
  /* Must not unconditionally zero panelNav on nav open in the ≤900 path. */
  const navOpen = feed.match(
    /if \(value === "nav"\) \{[\s\S]{0,4500}?iuMobileGatePerfMark\("iu-gate-nav-visible-sync"\)/
  );
  if (!navOpen) fail("static: nav open block not found");
  if (
    /if \(panelNav && panelNav\.scrollTop\) panelNav\.scrollTop = 0/.test(navOpen[0]) &&
    !/iuMenuNavIsMobileBand\(\)/.test(navOpen[0])
  ) {
    fail("static: setTab(nav) still unconditionally zeros panelNav");
  }
  if (!/restoreNavY/.test(navOpen[0]) && !/iuMenuNavReadScroll/.test(navOpen[0])) {
    fail("static: setTab(nav) missing restore path");
  }
  const app = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  if (!/iuMenuNavCaptureScroll/.test(app)) fail("static: app.js must early-capture on Menu item click");
  console.log("PASS static:menu-nav-scroll-restore");
}

async function seed(ctx) {
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("iu_terms_accepted_v1", "1");
      localStorage.setItem("iu_consent_v1", JSON.stringify({ necessary: true, analytics: false, ts: Date.now() }));
    } catch (_) {}
  });
}

async function dismissTerms(page) {
  try {
    await page.evaluate(() => {
      const b =
        document.querySelector("[data-iu-terms-accept], .iu-terms-accept, #iuTermsAccept") ||
        document.querySelector("button");
      if (b && /souhlas|accept|rozum/i.test(String(b.textContent || ""))) b.click();
    });
  } catch (_) {}
}

async function openMenu(page) {
  await page.evaluate(() => {
    const w = document.getElementById("iuMobileGateWrap");
    if (w && typeof w.__iuMobileGateSetTab === "function") {
      w.__iuMobileGateSetTab("nav");
      return;
    }
    const tab = document.getElementById("iuMobileGateTabNav");
    if (tab) tab.click();
  });
  await page.waitForTimeout(700);
  const open = await page.evaluate(() => {
    const wrap = document.getElementById("iuMobileGateWrap");
    return wrap && String(wrap.getAttribute("data-iu-mobile-gate") || "") === "nav";
  });
  if (!open) fail("openMenu: gate nav not open");
}

async function panelScrollInfo(page) {
  return page.evaluate(() => {
    const panel = document.getElementById("iuMobileGatePanelNav");
    if (!panel) return null;
    const max = Math.max(0, (panel.scrollHeight || 0) - (panel.clientHeight || 0));
    return { top: panel.scrollTop || 0, max: max, gate: true };
  });
}

async function setPanelScrollRatio(page, ratio) {
  return page.evaluate((r) => {
    const panel = document.getElementById("iuMobileGatePanelNav");
    if (!panel) return null;
    const max = Math.max(0, (panel.scrollHeight || 0) - (panel.clientHeight || 0));
    const y = Math.round(max * r);
    panel.scrollTop = y;
    try {
      if (typeof window.iuMenuNavCaptureScroll === "function") window.iuMenuNavCaptureScroll();
    } catch (_) {}
    return { top: panel.scrollTop || 0, max: max };
  }, ratio);
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
    history.back();
  });
  await page.waitForTimeout(900);
  let gate = await page.evaluate(() => {
    const wrap = document.getElementById("iuMobileGateWrap");
    return wrap && String(wrap.getAttribute("data-iu-mobile-gate") || "") === "nav";
  });
  if (!gate) {
    await openMenu(page);
    gate = true;
  }
  /* Wait until restore hold finishes (visibility + scrollTop). */
  const deadline = Date.now() + 2000;
  let immediate = null;
  let settled = null;
  while (Date.now() < deadline) {
    const snap = await page.evaluate(() => {
      const panel = document.getElementById("iuMobileGatePanelNav");
      if (!panel) return null;
      let vis = "";
      try {
        vis = panel.style.visibility || "";
      } catch (_) {}
      const max = Math.max(0, (panel.scrollHeight || 0) - (panel.clientHeight || 0));
      return { top: panel.scrollTop || 0, max: max, vis: vis };
    });
    if (snap && snap.vis !== "hidden" && snap.top > 0) {
      immediate = immediate || snap;
      settled = snap;
      break;
    }
    if (snap && !immediate) immediate = snap;
    settled = snap;
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(200);
  settled = (await panelScrollInfo(page)) || settled;
  return { immediate: immediate || settled, settled };
}

async function runViewport(browser, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  await seed(ctx);
  const page = await ctx.newPage();
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  try {
    await page.waitForLoadState("networkidle", { timeout: 20000 });
  } catch (_) {}
  await page.waitForTimeout(800);
  await dismissTerms(page);

  for (const depth of DEPTHS) {
    for (const sec of SECTIONS) {
      await openMenu(page);
      const before = await setPanelScrollRatio(page, depth.ratio);
      if (!before || before.max < 80) {
        fail(vp.name + ":" + depth.name + ":" + sec.id + ": Menu not scrollable (max=" + (before && before.max) + ")");
      }
      if (before.top < 40) {
        fail(vp.name + ":" + depth.name + ":" + sec.id + ": scroll target too small (" + before.top + ")");
      }
      const navP = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
      const clicked = await clickRail(page, sec.re);
      if (!clicked) fail(vp.name + ":" + depth.name + ":" + sec.id + ": rail item not found");
      await navP;
      await page.waitForTimeout(1000);
      await dismissTerms(page);
      const back = await goBackToMenu(page);
      const imm = back.immediate;
      const set = back.settled;
      if (!imm || !set) fail(vp.name + ":" + depth.name + ":" + sec.id + ": missing panel after back");
      if (Math.abs(imm.top - before.top) > TOL) {
        fail(
          vp.name +
            ":" +
            depth.name +
            ":" +
            sec.id +
            ": flash/wrong immediate scroll (want≈" +
            before.top +
            " got=" +
            imm.top +
            ")"
        );
      }
      if (Math.abs(set.top - before.top) > TOL) {
        fail(
          vp.name +
            ":" +
            depth.name +
            ":" +
            sec.id +
            ": settled scroll not restored (want≈" +
            before.top +
            " got=" +
            set.top +
            ")"
        );
      }
      console.log(
        "PASS " +
          vp.name +
          ":" +
          depth.name +
          ":" +
          sec.id +
          " y=" +
          before.top +
          "→" +
          set.top +
          " max=" +
          before.max
      );
    }
  }
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
  console.log("PASS iu-menu-nav-scroll-restore-guard");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

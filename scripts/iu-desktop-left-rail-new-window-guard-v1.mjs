#!/usr/bin/env node
/**
 * PC (≥1025px) left-rail → new tab in same browser window + top bar shell guard.
 * Run: npm run iu-desktop-left-rail-new-window-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-desktop-left-rail-new-window-guard
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  installLocalDataProtectionAccepted,
} from "./proofs/open_meteo_guard_stub.cjs";
import { ensureGuardLocalDataProtection } from "./guards/desktop-nav-targets.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8904", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

const CYCLES_PER_BUTTON = parseInt(process.env.IU_LEFT_RAIL_WINDOW_CYCLES || "5", 10);
const SETTLE_MS = parseInt(process.env.IU_LEFT_RAIL_WINDOW_SETTLE_MS || "20000", 10);
const RESTORE_TOL_PX = parseInt(process.env.IU_LEFT_RAIL_WINDOW_SCROLL_TOL || "12", 10);

const STATIC_TOOLS = [
  { accent: "pocasi", label: "Počasí" },
  { accent: "mapy", label: "Mapy", externalLink: 'a.iuRadioChip[href*="google.com/maps"]' },
  { accent: "jr", label: "Jízdní řády" },
  { accent: "tvprogram", label: "TV program" },
  { accent: "tvonline", label: "TV online" },
  { accent: "radio", label: "Rádia" },
];

function auditStaticOpenImplementation() {
  const srcPath = path.join(REPO, "assets", "iu-desktop-left-rail-new-window-v1.js");
  const src = fs.readFileSync(srcPath, "utf8");
  const fails = [];
  if (src.includes("popup=yes")) fails.push("popup=yes still present");
  if (/window\.open\([^)]*,[^,]+,[^)]*(width|height|left|top)/.test(src)) {
    fails.push("window.open with popup dimension features still present");
  }
  if (src.includes("openWindows")) fails.push("named window reuse map still present");
  if (!src.includes('window.open(targetUrl, "_blank"')) fails.push('expected window.open(..., "_blank", ...)');
  return fails;
}

function isProdHost(base) {
  return /infouzel\.cz/i.test(base);
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

function buildUrl(params) {
  const isLocal = BASE.indexOf("127.0.0.1") >= 0 || BASE.indexOf("localhost") >= 0;
  const p = new URLSearchParams(params || {});
  if (isLocal) p.set("iuRobust", "1");
  if (isProdHost(BASE)) p.set("nosw", "1");
  const qs = p.toString();
  return qs ? BASE + (BASE.includes("?") ? "&" : "?") + qs : BASE;
}

async function readScrollY(page) {
  return page.evaluate(() => {
    try {
      if (typeof window.iuGetMainScrollTop === "function") return window.iuGetMainScrollTop();
    } catch (_) {}
    return Math.max(
      0,
      window.scrollY || 0,
      (document.documentElement && document.documentElement.scrollTop) || 0,
      (document.body && document.body.scrollTop) || 0
    );
  });
}

async function waitHubFeedReady(page, timeoutMs) {
  try {
    await page.waitForFunction(
      () => {
        const feed = document.getElementById("feed");
        if (!feed) return true;
        return String(feed.getAttribute("data-feed-ready") || "") === "true";
      },
      { timeout: timeoutMs }
    );
  } catch (_) {}
}

async function discoverLeftRailButtons(page) {
  await page.waitForSelector("#iuLeftRail .iu-leftNavItem[data-accent]", { timeout: 60000 });
  const accents = await page.evaluate(() => {
    var out = [];
    var nodes = document.querySelectorAll("#iuLeftRail .iu-leftNavItem[data-accent]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (String(el.getAttribute("data-media-topic") || "").trim()) continue;
      var ac = String(el.getAttribute("data-accent") || "").trim().toLowerCase();
      if (!ac) continue;
      var labelEl = el.querySelector(".iu-leftNavLabel");
      var label = labelEl ? String(labelEl.textContent || "").trim() : ac;
      out.push({ accent: ac, label: label });
    }
    return out;
  });
  if (!accents.length) throw new Error("no left-rail buttons discovered");
  return accents;
}

async function ensureParentReady(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#iuLeftRail .iu-leftNavItem", { timeout: 60000 });
  await ensureGuardLocalDataProtection(page);
  await waitHubFeedReady(page, 30000);
  await page.waitForTimeout(600);
}

async function scrollParentForCycle(page, cycleIndex) {
  const ratios = [0, 0.28, 0.52, 0.78, 0.12];
  const ratio = ratios[cycleIndex % ratios.length];
  await page.evaluate((r) => {
    var target = Math.max(0, Math.floor((document.body.scrollHeight || 0) * r));
    window.scrollTo(0, target);
    document.documentElement.scrollTop = target;
    if (document.body) document.body.scrollTop = target;
    try {
      if (typeof window.iuScrollRestoreSaveNow === "function") window.iuScrollRestoreSaveNow();
    } catch (_) {}
  }, ratio);
  await page.waitForTimeout(250);
}

async function assertToolTabLayout(toolTab, accent) {
  await toolTab.waitForSelector("#topbarWrap.topbar-new.iuTopbar", { timeout: SETTLE_MS });
  await toolTab.waitForFunction(
    () => document.documentElement.getAttribute("data-iu-tool-window") === "1",
    { timeout: SETTLE_MS }
  );

  const layout = await toolTab.evaluate((ac) => {
    var topbar = document.getElementById("topbarWrap");
    var spacer = document.querySelector(".iuTopbarFlowSpacer");
    var leftRail = document.getElementById("iuLeftRail");
    var accordion = document.querySelector(".layout > aside.accordionCol");
    var sec = String(document.body?.dataset?.section || "").toLowerCase();
    var topRect = topbar ? topbar.getBoundingClientRect() : null;
    var spacerRect = spacer ? spacer.getBoundingClientRect() : null;
    var stage = document.getElementById("iuCenterStage");
    var stageRect = stage ? stage.getBoundingClientRect() : null;
    var stageStyle = stage ? getComputedStyle(stage) : null;
    var feed = document.getElementById("feed");
    var feedDisplay = feed ? getComputedStyle(feed).display : "";
    var closeCount = document.querySelectorAll("[data-iu-desktop-section-close]").length;
    var vw = window.innerWidth || 0;
    return {
      sec: sec,
      topbarH: topRect ? Math.round(topRect.height) : 0,
      spacerH: spacerRect ? Math.round(spacerRect.height) : 0,
      leftRailHidden: leftRail ? getComputedStyle(leftRail).display === "none" : true,
      accordionHidden: accordion ? getComputedStyle(accordion).display === "none" : true,
      stageTop: stageRect ? Math.round(stageRect.top) : 0,
      stageWidth: stageRect ? Math.round(stageRect.width) : 0,
      stageLeft: stageRect ? Math.round(stageRect.left) : 0,
      stageRight: stageRect ? Math.round(vw - stageRect.right) : 0,
      stageMaxWidth: stageStyle ? String(stageStyle.maxWidth || "") : "",
      closeCount: closeCount,
      feedHidden: feedDisplay === "none",
      href: location.href,
      expected: ac,
    };
  }, accent);

  if (layout.sec !== accent && !(accent.indexOf("aff-") === 0 && layout.sec === accent)) {
    throw new Error(`${accent}: tool tab section mismatch got=${layout.sec}`);
  }
  if (!layout.href.includes("iu_window=tool") || !layout.href.includes("section=" + encodeURIComponent(accent).replace(/%20/g, "+"))) {
    if (!layout.href.includes("section=" + accent)) {
      throw new Error(`${accent}: tool tab URL missing section/iu_window (${layout.href})`);
    }
  }
  if (layout.topbarH < 48) throw new Error(`${accent}: topbar too short h=${layout.topbarH}`);
  if (layout.spacerH < 48) throw new Error(`${accent}: topbar spacer too short h=${layout.spacerH}`);
  if (!layout.leftRailHidden) throw new Error(`${accent}: left rail visible in tool tab`);
  if (!layout.accordionHidden) throw new Error(`${accent}: right rail visible in tool tab`);
  if (layout.stageTop < layout.spacerH - 4) {
    throw new Error(`${accent}: center stage under topbar overlap stageTop=${layout.stageTop} spacer=${layout.spacerH}`);
  }
  if (layout.closeCount > 0) {
    throw new Error(`${accent}: tool tab must not show Zavřít controls count=${layout.closeCount}`);
  }
  if (layout.stageWidth > 600) {
    throw new Error(`${accent}: center stage wider than 600px w=${layout.stageWidth}`);
  }
  if (Math.abs(layout.stageLeft - layout.stageRight) > 16) {
    throw new Error(
      `${accent}: center stage not centered left=${layout.stageLeft} right=${layout.stageRight}`
    );
  }
  if (!layout.stageMaxWidth.includes("600")) {
    throw new Error(`${accent}: center stage max-width expected 600px got=${layout.stageMaxWidth}`);
  }
}

async function openLeftRailToolTab(page, accent) {
  const sel = `#iuLeftRail a[data-accent="${accent}"]`;
  await page.waitForSelector(sel, { timeout: 60000 });
  const tabPromise = page.context().waitForEvent("page", { timeout: SETTLE_MS });
  await page.locator(sel).click({ force: true, timeout: 60000 });
  const toolTab = await tabPromise;
  await toolTab.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(() => {});
  await assertToolTabLayout(toolTab, accent);
  return toolTab;
}

async function testExternalLinkInToolTab(page, button) {
  if (!button.externalLink) return;
  const toolTab = await openLeftRailToolTab(page, button.accent);
  await toolTab.waitForSelector(button.externalLink, { timeout: SETTLE_MS });
  const extPromise = page.context().waitForEvent("page", { timeout: SETTLE_MS });
  await toolTab.locator(button.externalLink).first().click({ timeout: 60000 });
  const extTab = await extPromise;
  await extTab.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(() => {});
  const extUrl = extTab.url();
  if (!/google\.com\/maps/i.test(extUrl)) {
    throw new Error(`${button.accent}: external tab URL unexpected (${extUrl})`);
  }
  await extTab.close();
  await toolTab.close();
  await page.waitForTimeout(120);
}

async function testButtonCycle(page, button, cycleIndex) {
  await scrollParentForCycle(page, cycleIndex);
  const before = await page.evaluate(() => ({
    href: location.href,
    sec: String(document.body?.dataset?.section || "").toLowerCase(),
    scrollY: (function () {
      try {
        if (typeof window.iuGetMainScrollTop === "function") return window.iuGetMainScrollTop();
      } catch (_) {}
      return Math.max(0, window.scrollY || 0, document.documentElement.scrollTop || 0);
    })(),
  }));
  const scrollBefore = before.scrollY;

  const sel = `#iuLeftRail a[data-accent="${button.accent}"]`;
  await page.waitForSelector(sel, { timeout: 60000 });

  const tabPromise = page.context().waitForEvent("page", { timeout: SETTLE_MS });
  await page.locator(sel).click({ force: true, timeout: 60000 });
  const toolTab = await tabPromise;

  await toolTab.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(() => {});
  await assertToolTabLayout(toolTab, button.accent);

  if (cycleIndex === 2) {
    await toolTab.evaluate(() => {
      try {
        var btn = document.querySelector("#topbarWrap .iuBrand");
        if (btn) btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      } catch (_) {}
    });
  }

  await toolTab.close();
  await page.waitForTimeout(120);
  await page.evaluate((y) => {
    try {
      window.scrollTo(0, y);
      document.documentElement.scrollTop = y;
      if (document.body) document.body.scrollTop = y;
    } catch (_) {}
  }, scrollBefore);

  const after = await page.evaluate(() => ({
    href: location.href,
    sec: String(document.body?.dataset?.section || "").toLowerCase(),
  }));
  const scrollAfter = await readScrollY(page);

  if (after.href !== before.href) {
    throw new Error(`${button.accent} cycle ${cycleIndex + 1}: parent URL changed`);
  }
  if (after.sec !== before.sec) {
    throw new Error(`${button.accent} cycle ${cycleIndex + 1}: parent data-section changed ${before.sec}->${after.sec}`);
  }
  if (Math.abs(scrollAfter - scrollBefore) > RESTORE_TOL_PX) {
    throw new Error(
      `${button.accent} cycle ${cycleIndex + 1}: scroll drift ${scrollBefore}->${scrollAfter}`
    );
  }
}

async function main() {
  let serverProc = null;
  if (USE_LOCAL_SERVER) {
    serverProc = spawn("npx", ["serve", REPO, "-l", String(PORT)], {
      cwd: REPO,
      stdio: "ignore",
      shell: true,
    });
    await waitForPort("127.0.0.1", PORT, 45000);
  }

  const ignorable = createIgnorableResourceTracker();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await installProofGuardNetworkStubs(context, ignorable);
  await installLocalDataProtectionAccepted(context);
  const page = await context.newPage();

  const failures = [];
  const passes = [];
  let inventory = [];
  const staticFails = auditStaticOpenImplementation();
  if (staticFails.length) failures.push(...staticFails.map((f) => "static: " + f));

  try {
    await ensureParentReady(page);
    inventory = await discoverLeftRailButtons(page);

    for (const button of inventory) {
      for (let c = 0; c < CYCLES_PER_BUTTON; c++) {
        const tag = `${button.accent} cycle ${c + 1}/${CYCLES_PER_BUTTON}`;
        try {
          await testButtonCycle(page, button, c);
          passes.push(tag);
        } catch (err) {
          failures.push(`${tag}: ${err && err.message ? err.message : String(err)}`);
        }
      }
    }

    const mapyBtn = inventory.find((b) => b.accent === "mapy") || { accent: "mapy", externalLink: STATIC_TOOLS.find((t) => t.accent === "mapy")?.externalLink };
    if (mapyBtn) {
      try {
        await testExternalLinkInToolTab(page, {
          accent: "mapy",
          externalLink: 'a.iuRadioChip[href*="google.com/maps"]',
        });
        passes.push("mapy external link tab");
      } catch (err) {
        failures.push(`mapy external link tab: ${err && err.message ? err.message : String(err)}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    if (serverProc) serverProc.kill("SIGTERM");
  }

  const staticOk = STATIC_TOOLS.every((t) => inventory.some((b) => b.accent === t.accent));
  console.log(
    JSON.stringify(
      {
        pass: failures.length === 0 && staticOk,
        base: BASE,
        inventoryCount: inventory.length,
        inventory: inventory.map((b) => ({ accent: b.accent, label: b.label })),
        staticToolsPresent: staticOk,
        cyclesPerButton: CYCLES_PER_BUTTON,
        passes: passes.length,
        failures,
      },
      null,
      2
    )
  );
  process.exit(failures.length === 0 && staticOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

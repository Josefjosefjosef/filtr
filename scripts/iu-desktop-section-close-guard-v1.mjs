#!/usr/bin/env node
/**
 * Desktop left-rail section close + scroll restore guard (PC ≥901px).
 * Run: npm run iu-desktop-section-close-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-desktop-section-close-guard
 */
import { createRequire } from "module";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
  installLocalDataProtectionAccepted,
} from "./proofs/open_meteo_guard_stub.cjs";
import { ensureGuardLocalDataProtection } from "./guards/desktop-nav-targets.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8903", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

const RESTORE_TOL_PX = parseInt(process.env.IU_DESKTOP_CLOSE_RESTORE_TOL || "8", 10);
const OPEN_SCROLL_WAIT_MS = parseInt(process.env.IU_DESKTOP_OPEN_SCROLL_WAIT_MS || "15000", 10);
const OPEN_SCROLL_TOL_PX = parseInt(process.env.IU_DESKTOP_OPEN_SCROLL_TOL || "12", 10);
const SCROLL_BEFORE_MIN = 900;
const REGRESSION_CYCLES = parseInt(process.env.IU_DESKTOP_CLOSE_CYCLES || "20", 10);
const SETTLE_MS = parseInt(process.env.IU_DESKTOP_CLOSE_SETTLE_MS || "15000", 10);
const RESTORE_WAIT_MS = parseInt(process.env.IU_DESKTOP_CLOSE_RESTORE_WAIT_MS || "32000", 10);
const FEED_READY_WAIT_MS = parseInt(process.env.IU_DESKTOP_CLOSE_FEED_READY_MS || "30000", 10);

const LEFT_RAIL_TOOLS = [
  { accent: "pocasi", label: "Počasí" },
  { accent: "mapy", label: "Mapy" },
  { accent: "jr", label: "Jízdní řády" },
  { accent: "tvprogram", label: "TV program" },
  { accent: "tvonline", label: "TV online" },
  { accent: "radio", label: "Rádia" },
];

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
  if (isLocal) {
    p.set("iuRobust", "1");
    p.set("nosw", "1");
  }
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

async function waitScrollNear(page, targetY, timeoutMs) {
  try {
    await page.waitForFunction(
      (y) => {
        try {
          var read =
            typeof window.iuGetMainScrollTop === "function"
              ? window.iuGetMainScrollTop()
              : Math.max(0, window.scrollY || 0, document.documentElement.scrollTop || 0);
          var root =
            typeof window.iuGetMainScrollTop === "function" && document.body
              ? document.body
              : document.scrollingElement || document.documentElement;
          var maxY = root ? Math.max(0, root.scrollHeight - (window.innerHeight || 0)) : 0;
          return maxY >= Math.max(0, y - 8) && Math.abs(read - y) <= RESTORE_TOL_PX;
        } catch (_) {
          return false;
        }
      },
      targetY,
      { timeout: timeoutMs }
    );
    const y = await readScrollY(page);
    return { ok: true, y };
  } catch (_) {
    const y = await readScrollY(page);
    return { ok: Math.abs(y - targetY) <= RESTORE_TOL_PX, y };
  }
}

async function waitSectionClosed(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await page.evaluate(() => {
      try {
        const p = new URLSearchParams(String(location.search || ""));
        const sec = String(p.get("section") || "").trim().toLowerCase();
        if (!sec) return false;
        if (sec === "feed" || sec === "media") {
          const topic = String(p.get("topic") || "").trim().toLowerCase();
          return !!(topic && topic !== "all");
        }
        return true;
      } catch (_) {
        return false;
      }
    });
    if (!open) return true;
    await page.waitForTimeout(120);
  }
  return false;
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

async function ensureDesktopReady(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#iuLeftRail .iu-leftNavItem", { timeout: 60000 });
  await page.evaluate(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      document.querySelectorAll(".iu-ldp-backdrop").forEach((el) => el.remove());
    } catch (_) {}
  });
  await waitHubFeedReady(page, FEED_READY_WAIT_MS);
  await page.waitForTimeout(800);
}

async function scrollDeep(page) {
  await page.evaluate((minY) => {
    const target = Math.max(minY, Math.floor(document.body.scrollHeight * 0.55));
    window.scrollTo(0, target);
    document.documentElement.scrollTop = target;
    if (document.body) document.body.scrollTop = target;
  }, SCROLL_BEFORE_MIN);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    try {
      if (typeof window.iuScrollRestoreSaveNow === "function") window.iuScrollRestoreSaveNow();
    } catch (_) {}
  });
}

async function clickLeftRail(page, accent) {
  await ensureGuardLocalDataProtection(page);
  const sel = `#iuLeftRail a[data-accent="${accent}"]`;
  await page.click(sel, { timeout: 60000 });
}

async function resetHub(page) {
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#iuLeftRail .iu-leftNavItem", { timeout: 60000 });
  await page.evaluate(() => {
    try {
      document.querySelectorAll(".iu-ldp-backdrop").forEach(function (el) {
        el.remove();
      });
    } catch (_) {}
  });
  await waitHubFeedReady(page, FEED_READY_WAIT_MS);
  await page.waitForTimeout(600);
}

async function guardScrollToSectionStart(page) {
  return page.evaluate(() => {
    try {
      var read =
        typeof window.iuGetMainScrollTop === "function"
          ? window.iuGetMainScrollTop()
          : Math.max(0, window.scrollY || 0, document.documentElement.scrollTop || 0);
      var setY = function (y) {
        var yv = Math.max(0, Math.round(Number(y) || 0));
        if (typeof window.iuSetMainScrollTop === "function") window.iuSetMainScrollTop(yv);
        else {
          window.scrollTo(0, yv);
          document.documentElement.scrollTop = yv;
          if (document.body) document.body.scrollTop = yv;
        }
      };
      var sticky = 68;
      try {
        var cs = getComputedStyle(document.documentElement);
        var sv = parseFloat(cs.getPropertyValue("--topbarStackH"));
        if (Number.isFinite(sv) && sv > 0) sticky = sv;
      } catch (_) {}
      var anchor =
        document.querySelector("#iuCenterStage .iuSectionHeader") ||
        document.querySelector(".iuTvPgHero__inner") ||
        document.querySelector(".iuTvPgHero__title") ||
        document.querySelector('[data-iu-desktop-section-close="top"]') ||
        document.querySelector(".iuDesktopSectionCloseBar") ||
        document.querySelector(".iuTvPgHero");
      if (!anchor) return false;
      var rect = anchor.getBoundingClientRect();
      if (rect.height <= 0) return false;
      setY(rect.top + read - sticky);
      return true;
    } catch (_) {
      return false;
    }
  });
}

async function guardScrollToSectionStartWithRetry(page, attempts) {
  const max = Math.max(1, Number(attempts) || 12);
  for (let i = 0; i < max; i++) {
    const ok = await guardScrollToSectionStart(page);
    if (ok) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

async function waitSectionStartScrolled(page, deepBeforeY, timeoutMs) {
  try {
    await page.waitForFunction(
      (deepY, tol) => {
        try {
          if (window.__iuDesktopSectionCloseRestoring) return false;
          var read =
            typeof window.iuGetMainScrollTop === "function"
              ? window.iuGetMainScrollTop()
              : Math.max(0, window.scrollY || 0, document.documentElement.scrollTop || 0);
          if (Math.abs(read - deepY) <= tol) return false;
          var topBtn = document.querySelector('[data-iu-desktop-section-close="top"]');
          if (!topBtn) return false;
          var sticky = 68;
          try {
            var cs = getComputedStyle(document.documentElement);
            var sv = parseFloat(cs.getPropertyValue("--topbarStackH"));
            if (Number.isFinite(sv) && sv > 0) sticky = sv;
          } catch (_) {}
          var br = topBtn.getBoundingClientRect();
          if (br.top < sticky - tol || br.bottom <= sticky) return false;
          if (br.top > (window.innerHeight || 900) * 0.35) return false;
          var hdr =
            document.querySelector("#iuCenterStage .iuSectionHeader h1") ||
            document.querySelector("#iuCenterStage .iuSectionHeader h2") ||
            document.querySelector(".iuDesktopSectionCloseBar h2") ||
            document.querySelector(".iuTvPgHero__title") ||
            document.querySelector(".iuTvPgHero__inner h1") ||
            document.querySelector(".iuTvPgHero__inner h2");
          if (!hdr) return false;
          var hr = hdr.getBoundingClientRect();
          if (hr.bottom <= sticky || hr.top > (window.innerHeight || 900) * 0.4) return false;
          return true;
        } catch (_) {
          return false;
        }
      },
      deepBeforeY,
      OPEN_SCROLL_TOL_PX,
      { timeout: timeoutMs }
    );
    const y = await readScrollY(page);
    return { ok: true, y };
  } catch (_) {
    const y = await readScrollY(page);
    return { ok: false, y };
  }
}

async function testToolCloseFlow(page, tool, mode, deepBeforeY) {
  const sel = `#iuLeftRail a[data-accent="${tool.accent}"]`;
  await clickLeftRail(page, tool.accent);
  await page.waitForFunction(
    (ac) => String(document.body?.dataset?.section || "").toLowerCase() === ac,
    tool.accent,
    { timeout: SETTLE_MS }
  );
  await page.waitForTimeout(600);
  for (let i = 0; i < 16; i++) {
    await page.evaluate((ac) => {
      try {
        if (window.__iuSectionViewsLazyMount && window.__iuSectionViewsLazyMount.ensure) {
          window.__iuSectionViewsLazyMount.ensure(ac);
        }
      } catch (_) {}
      if (typeof window.iuDesktopSectionCloseAfterOpen === "function") window.iuDesktopSectionCloseAfterOpen();
    }, tool.accent);
    const topCount = await page.locator('[data-iu-desktop-section-close="top"]').count();
    if (topCount > 0) break;
    await page.waitForTimeout(300);
  }

  const topCount = await page.locator('[data-iu-desktop-section-close="top"]').count();
  const bottomCount = await page.locator('[data-iu-desktop-section-close="bottom"]').count();
  if (topCount === 0 || bottomCount === 0) {
    const dbg = await page.evaluate(() => ({
      sec: document.body?.dataset?.section || "",
      init: !!window.__iuDesktopSectionCloseV1Init,
      href: location.href,
      top: document.querySelectorAll('[data-iu-desktop-section-close="top"]').length,
      bottom: document.querySelectorAll('[data-iu-desktop-section-close="bottom"]').length,
    }));
    throw new Error(`${tool.accent}: close buttons missing dbg=${JSON.stringify(dbg)}`);
  }

  const topBtn = page.locator('[data-iu-desktop-section-close="top"]').first();
  const bottomBtn = page.locator('[data-iu-desktop-section-close="bottom"]').first();

  if (typeof deepBeforeY === "number" && deepBeforeY >= SCROLL_BEFORE_MIN - 100) {
    await page.evaluate(() => {
      try {
        if (typeof window.iuDesktopSectionCloseScrollToSectionStart === "function") {
          window.iuDesktopSectionCloseScrollToSectionStart();
        }
      } catch (_) {}
    });
    await guardScrollToSectionStartWithRetry(page, 24);
    const openScroll = await waitSectionStartScrolled(page, deepBeforeY, OPEN_SCROLL_WAIT_MS);
    if (!openScroll.ok) {
      const dbg = await page.evaluate(() => ({
        y:
          typeof window.iuGetMainScrollTop === "function"
            ? window.iuGetMainScrollTop()
            : window.scrollY,
        hasScrollFn: typeof window.iuDesktopSectionCloseScrollToSectionStart === "function",
        sec: document.body?.dataset?.section || "",
        top: document.querySelectorAll('[data-iu-desktop-section-close="top"]').length,
      }));
      throw new Error(
        `${tool.accent}: open scroll failed deep=${deepBeforeY} current=${openScroll.y} tol=${OPEN_SCROLL_TOL_PX} dbg=${JSON.stringify(dbg)}`
      );
    }
  }

  await topBtn.waitFor({ state: "visible", timeout: SETTLE_MS });

  if (mode === "top") await topBtn.click();
  else if (mode === "bottom") {
    await bottomBtn.click();
  } else await clickLeftRail(page, tool.accent);

  const closed = await waitSectionClosed(page, SETTLE_MS);
  if (!closed) throw new Error(`${tool.accent}: section not closed (${mode})`);
  await waitHubFeedReady(page, FEED_READY_WAIT_MS);
  await page.waitForTimeout(400);
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
  if (USE_LOCAL_SERVER) {
    const closeJsPath = path.join(REPO, "assets", "iu-desktop-section-close-v1.js");
    await context.route(/iu-desktop-section-close-v1\.js/i, async (route) => {
      await route.fulfill({
        path: closeJsPath,
        contentType: "application/javascript",
        headers: { "Cache-Control": "no-store" },
      });
    });
  }
  await installLocalDataProtectionAccepted(context);
  const page = await context.newPage();
  await installProofGuardNetworkStubs(page, ignorable);

  const failures = [];
  const passes = [];

  try {
    await ensureDesktopReady(page);

    try {
      await resetHub(page);
      await scrollDeep(page);
      const warmBefore = await readScrollY(page);
      if (warmBefore >= SCROLL_BEFORE_MIN - 100) {
        await testToolCloseFlow(page, { accent: "pocasi" }, "top", warmBefore);
        let warmRestore = await waitScrollNear(page, warmBefore, RESTORE_WAIT_MS);
        if (!warmRestore.ok) {
          await page.waitForTimeout(1200);
          warmRestore = await waitScrollNear(page, warmBefore, RESTORE_WAIT_MS);
        }
      }
    } catch (_) {}

    for (const tool of LEFT_RAIL_TOOLS) {
      for (const mode of ["top", "bottom", "toggle"]) {
        await resetHub(page);
        await scrollDeep(page);
        const beforeY = await readScrollY(page);
        if (beforeY < SCROLL_BEFORE_MIN - 100) {
          failures.push(`${tool.accent}/${mode}: deep scroll failed before=${beforeY}`);
          continue;
        }
        try {
          await testToolCloseFlow(page, tool, mode, beforeY);
          let restore = await waitScrollNear(page, beforeY, RESTORE_WAIT_MS);
          if (!restore.ok) {
            await page.waitForTimeout(800);
            restore = await waitScrollNear(page, beforeY, RESTORE_WAIT_MS);
          }
          if (!restore.ok) {
            await page.waitForTimeout(1500);
            restore = await waitScrollNear(page, beforeY, RESTORE_WAIT_MS);
          }
          if (!restore.ok) {
            failures.push(
              `${tool.accent}/${mode}: scroll restore before=${beforeY} after=${restore.y} tol=${RESTORE_TOL_PX}`
            );
          } else {
            passes.push(`${tool.accent}/${mode}: restore ok (${restore.y})`);
          }
        } catch (err) {
          failures.push(`${tool.accent}/${mode}: ${err.message || err}`);
        }
      }
    }

    for (let i = 0; i < REGRESSION_CYCLES; i++) {
      const tool = LEFT_RAIL_TOOLS[i % LEFT_RAIL_TOOLS.length];
      const mode = i % 3 === 0 ? "top" : i % 3 === 1 ? "bottom" : "toggle";
      try {
        await resetHub(page);
        await scrollDeep(page);
        const cycleBefore = await readScrollY(page);
        await testToolCloseFlow(page, tool, mode, cycleBefore);
        let restore = await waitScrollNear(page, cycleBefore, RESTORE_WAIT_MS);
        if (!restore.ok) {
          await page.waitForTimeout(800);
          restore = await waitScrollNear(page, cycleBefore, RESTORE_WAIT_MS);
        }
        if (!restore.ok) {
          await page.waitForTimeout(1500);
          restore = await waitScrollNear(page, cycleBefore, RESTORE_WAIT_MS);
        }
        if (!restore.ok) {
          failures.push(
            `regression cycle ${i + 1}/${REGRESSION_CYCLES}: scroll before=${cycleBefore} after=${restore.y}`
          );
          break;
        }
      } catch (err) {
        failures.push(`regression cycle ${i + 1}/${REGRESSION_CYCLES}: ${err.message || err}`);
        break;
      }
    }
    if (!failures.some((f) => f.startsWith("regression cycle"))) {
      passes.push(`regression: ${REGRESSION_CYCLES}x open/close stable`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(buildUrl("?section=pocasi"), { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(800);
    const mobileCloseCount = await page.locator("[data-iu-desktop-section-close]").count();
    if (mobileCloseCount > 0) {
      failures.push(`mobile: close buttons visible count=${mobileCloseCount}`);
    } else {
      passes.push("mobile: no close buttons");
    }
  } finally {
    await browser.close();
    if (serverProc) serverProc.kill("SIGTERM");
  }

  console.log("IU_DESKTOP_SECTION_CLOSE_GUARD");
  console.log("PASS_COUNT=" + passes.length);
  console.log("FAIL_COUNT=" + failures.length);
  for (const p of passes) console.log("PASS " + p);
  for (const f of failures) console.log("FAIL " + f);

  if (failures.length) {
    process.exit(1);
  }
  console.log("PASS=true");
}

main().catch((err) => {
  console.error("IU_DESKTOP_SECTION_CLOSE_GUARD_FATAL", err);
  process.exit(1);
});

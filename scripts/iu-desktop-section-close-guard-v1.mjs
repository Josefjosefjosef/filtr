#!/usr/bin/env node
/**
 * Desktop left-rail section close + scroll restore guard (PC â‰Ą901px).
 * Run: npm run iu-desktop-section-close-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-desktop-section-close-guard
 */
import { createRequire } from "module";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import { exitIfMediaArticlesGuardsSkipped } from "./media-articles-cutover-skip.mjs";
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
const SCROLL_BEFORE_MIN = 900;
const REGRESSION_CYCLES = parseInt(process.env.IU_DESKTOP_CLOSE_CYCLES || "20", 10);
const SETTLE_MS = parseInt(process.env.IU_DESKTOP_CLOSE_SETTLE_MS || "15000", 10);
const RESTORE_WAIT_MS = parseInt(process.env.IU_DESKTOP_CLOSE_RESTORE_WAIT_MS || "32000", 10);
const FEED_READY_WAIT_MS = parseInt(process.env.IU_DESKTOP_CLOSE_FEED_READY_MS || "30000", 10);
/** Fail-fast wall clock â€” prevents CI "hang forever" when waits stack / mis-serialize. */
const HARD_TIMEOUT_MS = parseInt(process.env.IU_DESKTOP_CLOSE_HARD_MS || "480000", 10);

const LEFT_RAIL_TOOLS = [
  { accent: "pocasi", label: "PoÄŤasĂ­" },
  { accent: "mapy", label: "Mapy" },
  { accent: "jr", label: "JĂ­zdnĂ­ Ĺ™Ăˇdy" },
  { accent: "tvprogram", label: "TV program" },
  { accent: "tvonline", label: "TV online" },
  { accent: "radio", label: "RĂˇdia" },
];

function isProdHost(base) {
  return /infouzel\.cz/i.test(base);
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      /* GET: some static servers answer slowly / oddly on HEAD under CI load. */
      const req = http.request({ host, port, path: "/projects/", method: "GET", timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("timeout", () => {
        try { req.destroy(); } catch {}
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 200);
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 200);
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

async function waitScrollNear(page, targetY, timeoutMs) {
  // IMPORTANT: Playwright serializes the predicate to the browser â€” Node closures
  // (e.g. RESTORE_TOL_PX) are NOT available. Pass tol explicitly or wait always burns timeoutMs.
  try {
    await page.waitForFunction(
      ({ y, tol }) => {
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
          return maxY >= Math.max(0, y - 8) && Math.abs(read - y) <= tol;
        } catch (_) {
          return false;
        }
      },
      { y: targetY, tol: RESTORE_TOL_PX },
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
    try {
      if (typeof window.iuSetMainScrollTop === "function") {
        window.iuSetMainScrollTop(target);
        return;
      }
    } catch (_) {}
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

async function openToolSection(page, accent) {
  await page.goto(buildUrl({ section: accent }), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#iuLeftRail .iu-leftNavItem", { timeout: 60000 });
  await ensureGuardLocalDataProtection(page);
  await page.waitForFunction(
    (ac) => String(document.body?.dataset?.section || "").toLowerCase() === ac,
    accent,
    { timeout: SETTLE_MS }
  );
  await page.waitForTimeout(400);
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

async function testToolCloseFlow(page, tool, mode) {
  await openToolSection(page, tool.accent);
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
  await topBtn.waitFor({ state: "visible", timeout: SETTLE_MS });

  if (mode === "top") await topBtn.click({ force: true });
  else if (mode === "bottom") await bottomBtn.click({ force: true });

  const closed = await waitSectionClosed(page, SETTLE_MS);
  if (!closed) throw new Error(`${tool.accent}: section not closed (${mode})`);
  await waitHubFeedReady(page, FEED_READY_WAIT_MS);
}

async function main() {
  exitIfMediaArticlesGuardsSkipped("iu-desktop-section-close-guard-v1");
  const startedAt = Date.now();
  const hardTimer = setTimeout(() => {
    console.error(
      "IU_DESKTOP_SECTION_CLOSE_GUARD_FATAL hard_timeout_ms=" +
        HARD_TIMEOUT_MS +
        " elapsed_ms=" +
        (Date.now() - startedAt)
    );
    process.exit(1);
  }, HARD_TIMEOUT_MS);

  let serverProc = null;
  if (USE_LOCAL_SERVER) {
    const serverScript = path.join(REPO, "server", "projects-static.mjs");
    serverProc = spawn(process.execPath, [serverScript], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });
    let serverErr = "";
    serverProc.stderr.on("data", (c) => {
      serverErr += String(c);
    });
    serverProc.on("exit", (code) => {
      if (code && code !== 0 && !serverErr) serverErr = `static server exit ${code}`;
    });
    try {
      await waitForPort("127.0.0.1", PORT, 90000);
    } catch (err) {
      if (serverErr) console.error(serverErr.trim());
      throw err;
    }
  }

  const ignorable = createIgnorableResourceTracker();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await installProofGuardNetworkStubs(context, ignorable);
  await installLocalDataProtectionAccepted(context);
  const page = await context.newPage();
  page.setDefaultTimeout(Math.min(60000, SETTLE_MS + 5000));

  const failures = [];
  const passes = [];
  const logStep = (msg) => {
    console.log("STEP t=" + (Date.now() - startedAt) + "ms " + msg);
  };

  try {
    logStep("ensureDesktopReady");
    await ensureDesktopReady(page);

    for (const tool of LEFT_RAIL_TOOLS) {
      for (const mode of ["top", "bottom"]) {
        logStep("tool " + tool.accent + "/" + mode);
        await resetHub(page);
        await scrollDeep(page);
        const beforeY = await readScrollY(page);
        if (beforeY < SCROLL_BEFORE_MIN - 100) {
          failures.push(`${tool.accent}/${mode}: deep scroll failed before=${beforeY}`);
          continue;
        }
        try {
          await testToolCloseFlow(page, tool, mode);
          const restore = await waitScrollNear(page, beforeY, RESTORE_WAIT_MS);
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
      const mode = i % 2 === 0 ? "top" : "bottom";
      logStep("regression " + (i + 1) + "/" + REGRESSION_CYCLES + " " + tool.accent + "/" + mode);
      try {
        await resetHub(page);
        await scrollDeep(page);
        const cycleBefore = await readScrollY(page);
        await testToolCloseFlow(page, tool, mode);
        let restore = await waitScrollNear(page, cycleBefore, RESTORE_WAIT_MS);
        if (!restore.ok) {
          await page.waitForTimeout(800);
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

    logStep("mobile viewport check");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(buildUrl({ section: "pocasi" }), { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(800);
    const mobileCloseCount = await page.locator("[data-iu-desktop-section-close]").count();
    if (mobileCloseCount > 0) {
      failures.push(`mobile: close buttons visible count=${mobileCloseCount}`);
    } else {
      passes.push("mobile: no close buttons");
    }
  } finally {
    clearTimeout(hardTimer);
    await browser.close().catch(() => {});
    if (serverProc) serverProc.kill("SIGTERM");
  }

  console.log("IU_DESKTOP_SECTION_CLOSE_GUARD");
  console.log("ELAPSED_MS=" + (Date.now() - startedAt));
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

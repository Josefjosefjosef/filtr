#!/usr/bin/env node
"use strict";

const { devices } = require("playwright");

const DEFAULT_URL = "http://127.0.0.1:8080/projects/";
const FAST_REACTION_MAX_MS = 250;
const STRESS_ENGINE_DELAY_MS = 2000;
/**
 * Stress timing contract (in-page pointerdown → optimistic value):
 * - Soft limit applies to the median of cold samples (product “snappy” bar).
 * - Hard ceiling catches systematic slowness / broken optimistic path.
 * - Adaptive sampling absorbs a single CI scheduler outlier without masking
 *   real failures (functional checks always fail-fast).
 *
 * Legacy single-sample Playwright Date.now() metric (STRESS_OPTIMISTIC_MAX_MS)
 * inflated ~150ms+ via IPC/polling and flaked at 282–294ms in CI while the
 * in-page reaction stayed ~20–50ms. Kept as alias of the soft limit for logs.
 */
const STRESS_OPTIMISTIC_SOFT_MS = 250;
const STRESS_OPTIMISTIC_HARD_MS = 1000;
const STRESS_OPTIMISTIC_MAX_MS = STRESS_OPTIMISTIC_SOFT_MS;
const STRESS_TIMING_SAMPLES_MAX = 3;
// CI runners + delayed engine route (STRESS_ENGINE_DELAY_MS) need headroom beyond
// the intentional 2s engine stall; 4500ms flaked on tablet/mobile cold opens.
const STRESS_FINAL_MAX_MS = 10000;

function timingStats(msArr) {
  const a = (msArr || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0).sort((x, y) => x - y);
  const n = a.length;
  if (!n) {
    return { n: 0, min: null, median: null, p90: null, max: null, samples: [] };
  }
  const pct = (p) => a[Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))];
  const median = n % 2 ? a[(n - 1) >> 1] : Math.round((a[n / 2 - 1] + a[n / 2]) / 2);
  return { n, min: a[0], median, p90: pct(90), max: a[n - 1], samples: a.slice() };
}

const PREFIX_CASES = [
  { key: "calendar", expected: "Do kalendáře ", label: "Do kalendáře" },
  { key: "reminder", expected: "Připomeň mi ", label: "Připomeň mi" },
  { key: "notes", expected: "Do poznámek ", label: "Do poznámek" },
];

const VIEWPORTS = [
  { id: "mobile", ...devices["iPhone 13"] },
  { id: "tablet", ...devices["iPad (gen 7)"] },
];

function envUrl() {
  const u = String(
    process.env.SILVER_HOME_PREFIX_FIRST_TAP_GUARD_URL ||
      process.env.SILVER_HOME_UX_GUARD_URL ||
      process.env.SILVER_LAYOUT_GUARD_URL ||
      DEFAULT_URL
  ).trim();
  return u || DEFAULT_URL;
}

function prefixSel(key) {
  return '#iuSilverHomeInputUx [data-iu-silver-home-prefix="' + key + '"]';
}

function quickActionSel(key) {
  return '#iuSilverHomeInputUx [data-iu-silver-home-quick-action="' + key + '"]';
}

async function prepareContext(context, opts) {
  const o = opts || {};
  if (o.disableSw !== false) {
    await context.route("**/sw.js", (route) => route.abort());
  }
  await context.addInitScript((args) => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:local-data-protection:notice-accepted-at:v1", String(Date.now()));
    } catch (_) {}
    if (args.disableSw) {
      try {
        if (navigator.serviceWorker && typeof navigator.serviceWorker.register === "function") {
          navigator.serviceWorker.register = function () {
            return Promise.reject(new Error("iu-guard-sw-disabled"));
          };
        }
      } catch (_) {}
    }
    try {
      window.__iuSilverPrefixOptimisticCount = 0;
      window.__iuSilverPrefixFinalizeCount = 0;
      window.__iuSilverPrefixOptimisticLast = "";
    } catch (_) {}
  }, { disableSw: o.disableSw !== false });
}

async function dismissOverlays(page) {
  await page.evaluate(() => {
    try {
      document.querySelectorAll(".iu-ldp-backdrop").forEach((el) => el.remove());
      document.documentElement.classList.remove("iu-ldp-dialog-open");
      document.body.classList.remove("iu-ldp-dialog-open");
    } catch (_) {}
  });
}

async function installEngineDelay(page, delayMs) {
  await page.route("**/iu-silver-p0-engine.js*", async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.continue();
  });
}

async function waitForPrefixVisible(page) {
  const btn = page.locator(prefixSel("calendar"));
  await btn.waitFor({ state: "visible", timeout: 30000 });
  await dismissOverlays(page);
  await page.waitForFunction(() => {
    const el = document.querySelector('#iuSilverHomeInputUx [data-iu-silver-home-prefix="calendar"]');
    if (!el) return false;
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.pointerEvents !== "none" && r.width > 8 && r.height > 8;
  }, null, { timeout: 15000 });
}

async function resetTemplateMode(page) {
  await page.evaluate(() => {
    const inp = document.getElementById("iuSilverHomeInput");
    if (!inp) return;
    inp.value = "";
    try {
      inp.blur();
    } catch (_) {}
    try {
      if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
    } catch (_) {}
    try {
      window.__iuSilverPrefixOptimisticCount = 0;
      window.__iuSilverPrefixFinalizeCount = 0;
      window.__iuSilverPrefixOptimisticLast = "";
    } catch (_) {}
  });
}

async function engineReady(page) {
  return page.evaluate(() => !!window.__iuSilverP0EngineReady);
}

async function waitEngineReady(page, timeoutMs) {
  await page.waitForFunction(() => !!window.__iuSilverP0EngineReady, null, { timeout: timeoutMs });
}

async function readInputValue(page) {
  return page.evaluate(() => {
    const inp = document.getElementById("iuSilverHomeInput");
    return inp ? String(inp.value || "") : "";
  });
}

async function readCounters(page) {
  return page.evaluate(() => ({
    optimistic: Number(window.__iuSilverPrefixOptimisticCount || 0),
    finalize: Number(window.__iuSilverPrefixFinalizeCount || 0),
    last: String(window.__iuSilverPrefixOptimisticLast || ""),
    ready: !!window.__iuSilverP0EngineReady,
    bound: !!(
      document.querySelector('#iuSilverHomeInputUx [data-iu-silver-home-prefix="calendar"]') &&
      document.querySelector('#iuSilverHomeInputUx [data-iu-silver-home-prefix="calendar"]').__iuSilverHomeUxBound
    ),
  }));
}

/**
 * Real Playwright pointer path + fully in-page reaction metric.
 *
 * Start: performance.now() on capture-phase pointerdown (prefix control).
 * End: performance.now() on first in-page observation that input value === expected,
 * armed BEFORE click() and recorded via rAF (so Playwright click() IPC return
 * cannot inflate reactionMs).
 */
async function firstTapPrefixMeasured(page, key, expected, maxWaitMs) {
  await dismissOverlays(page);
  const readyBefore = await engineReady(page);
  const countersBefore = await readCounters(page);

  await page.evaluate(
    ({ exp, maxWait }) => {
      window.__iuSilverTapArmActive = true;
      window.__iuSilverTapExpected = exp;
      window.__iuSilverTapMaxWait = maxWait;
      window.__iuSilverTapT0 = 0;
      window.__iuSilverTapMatchedAt = 0;
      window.__iuSilverTapMatchedValue = "";
      window.__iuSilverTapRaf = 0;
      window.__iuSilverPlaywrightClickReturnAt = 0;

      function stopRaf() {
        if (window.__iuSilverTapRaf) {
          cancelAnimationFrame(window.__iuSilverTapRaf);
          window.__iuSilverTapRaf = 0;
        }
      }

      function noteMatch(value, at) {
        if (window.__iuSilverTapMatchedAt) return;
        window.__iuSilverTapMatchedAt = at;
        window.__iuSilverTapMatchedValue = value;
        stopRaf();
      }

      function pollMatch() {
        if (!window.__iuSilverTapArmActive || !window.__iuSilverTapT0) return;
        if (window.__iuSilverTapMatchedAt) return;
        const inp = document.getElementById("iuSilverHomeInput");
        const value = inp ? String(inp.value || "") : "";
        const now = performance.now();
        if (value === window.__iuSilverTapExpected) {
          noteMatch(value, now);
          return;
        }
        if (now - window.__iuSilverTapT0 <= window.__iuSilverTapMaxWait) {
          window.__iuSilverTapRaf = requestAnimationFrame(pollMatch);
        }
      }

      if (!window.__iuSilverTapPdArm) {
        window.__iuSilverTapPdArm = 1;
        document.addEventListener(
          "pointerdown",
          function (e) {
            try {
              if (!window.__iuSilverTapArmActive) return;
              const t =
                e && e.target && e.target.closest
                  ? e.target.closest("[data-iu-silver-home-prefix]")
                  : null;
              if (!t) return;
              if (!window.__iuSilverTapT0) {
                window.__iuSilverTapT0 = performance.now();
                window.__iuSilverTapRaf = requestAnimationFrame(pollMatch);
              }
            } catch (_) {}
          },
          true
        );
      }
    },
    { exp: expected, maxWait: maxWaitMs }
  );

  await page.locator(prefixSel(key)).click({ timeout: 10000, force: false });

  await page.evaluate(() => {
    window.__iuSilverPlaywrightClickReturnAt = performance.now();
  });

  try {
    await page.waitForFunction(
      (maxWait) => {
        if (window.__iuSilverTapMatchedAt) return true;
        if (!window.__iuSilverTapT0) return false;
        return performance.now() - window.__iuSilverTapT0 > maxWait + 30;
      },
      maxWaitMs,
      { timeout: Math.max(5000, maxWaitMs + 5000) }
    );
  } catch (_) {}

  const result = await page.evaluate(() => {
    window.__iuSilverTapArmActive = false;
    if (window.__iuSilverTapRaf) {
      cancelAnimationFrame(window.__iuSilverTapRaf);
      window.__iuSilverTapRaf = 0;
    }
    const t0 = Number(window.__iuSilverTapT0 || 0);
    const matchedAt = Number(window.__iuSilverTapMatchedAt || 0);
    const clickReturnAt = Number(window.__iuSilverPlaywrightClickReturnAt || 0);
    const inp = document.getElementById("iuSilverHomeInput");
    const value =
      window.__iuSilverTapMatchedValue || (inp ? String(inp.value || "") : "");
    const expected = String(window.__iuSilverTapExpected || "");
    const inPageReactionMs = t0 && matchedAt ? Math.round(matchedAt - t0) : -1;
    const clickReturnLagMs = t0 && clickReturnAt ? Math.round(clickReturnAt - t0) : -1;
    const ok = matchedAt > 0 && value === expected;
    return {
      ok,
      value,
      expected,
      reactionMs: inPageReactionMs,
      inPageReactionMs,
      pointerdownAt: t0,
      valueMatchedAt: matchedAt,
      playwrightClickReturnAt: clickReturnAt,
      clickReturnLagMs,
      detail: ok ? "ok" : matchedAt ? "value_mismatch" : "timeout",
    };
  });

  const readyAfter = await engineReady(page);
  const countersAfter = await readCounters(page);
  return {
    readyBefore,
    readyAfter,
    countersBefore,
    countersAfter,
    ...result,
  };
}

/**
 * Real Playwright pointer path (exercises capture listeners). Falls back to polling value.
 */
async function firstTapPrefixPlaywright(page, key, expected, maxWaitMs) {
  await dismissOverlays(page);
  const readyBefore = await engineReady(page);
  const countersBefore = await readCounters(page);
  const started = Date.now();
  await page.locator(prefixSel(key)).click({ timeout: 10000, force: false });
  let value = "";
  let matchedAt = -1;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    value = await readInputValue(page);
    if (value === expected) {
      matchedAt = Date.now() - started;
      break;
    }
    await page.waitForTimeout(16);
  }
  const countersAfter = await readCounters(page);
  return {
    readyBefore,
    readyAfter: await engineReady(page),
    countersBefore,
    countersAfter,
    value,
    reactionMs: matchedAt >= 0 ? matchedAt : Date.now() - started,
    ok: matchedAt >= 0,
    detail: matchedAt >= 0 ? "ok" : "timeout",
  };
}

module.exports = {
  DEFAULT_URL,
  FAST_REACTION_MAX_MS,
  STRESS_ENGINE_DELAY_MS,
  STRESS_OPTIMISTIC_SOFT_MS,
  STRESS_OPTIMISTIC_HARD_MS,
  STRESS_OPTIMISTIC_MAX_MS,
  STRESS_TIMING_SAMPLES_MAX,
  STRESS_FINAL_MAX_MS,
  PREFIX_CASES,
  VIEWPORTS,
  envUrl,
  prefixSel,
  quickActionSel,
  prepareContext,
  dismissOverlays,
  installEngineDelay,
  waitForPrefixVisible,
  resetTemplateMode,
  engineReady,
  waitEngineReady,
  readInputValue,
  readCounters,
  firstTapPrefixMeasured,
  firstTapPrefixPlaywright,
  timingStats,
};

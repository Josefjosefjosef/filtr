#!/usr/bin/env node
"use strict";

/**
 * Functional regression: first tap on Silver home prefix buttons must work on mobile + tablet
 * even when the lazy P0 engine is still loading (cold open / reload / delayed import).
 *
 * Env:
 *   SILVER_HOME_PREFIX_FIRST_TAP_GUARD_URL (default http://127.0.0.1:8080/projects/)
 *
 * Run: node scripts/silver-home-prefix-first-tap-guard-v1.cjs
 */

const { chromium, devices } = require("playwright");

const DEFAULT_URL = "http://127.0.0.1:8080/projects/";
const ENGINE_DELAY_MS = 900;
const REACTION_MAX_MS = 4500;

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

async function prepareContext(context) {
  /* Abort SW so module import is a real network fetch that page.route can delay. */
  await context.route("**/sw.js", (route) => route.abort());
  await context.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:local-data-protection:notice-accepted-at:v1", String(Date.now()));
    } catch (_) {}
    try {
      if (navigator.serviceWorker && typeof navigator.serviceWorker.register === "function") {
        navigator.serviceWorker.register = function () {
          return Promise.reject(new Error("iu-guard-sw-disabled"));
        };
      }
    } catch (_) {}
  });
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

async function installEngineDelay(page) {
  await page.route("**/iu-silver-p0-engine.js*", async (route) => {
    await new Promise((r) => setTimeout(r, ENGINE_DELAY_MS));
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

async function engineReady(page) {
  return page.evaluate(() => !!window.__iuSilverP0EngineReady);
}

async function readInputValue(page) {
  return page.evaluate(() => {
    const inp = document.getElementById("iuSilverHomeInput");
    return inp ? String(inp.value || "") : "";
  });
}

async function firstTapPrefix(page, key) {
  const sel = prefixSel(key);
  await dismissOverlays(page);
  const readyBefore = await engineReady(page);
  const valueBefore = await readInputValue(page);
  const started = Date.now();

  /* Real pointer path (not element.click in page.evaluate) so capture prefetch + hold fire. */
  await page.locator(sel).click({ timeout: 10000, force: false });

  let value = valueBefore;
  let matchedAt = -1;
  const deadline = Date.now() + REACTION_MAX_MS;
  while (Date.now() < deadline) {
    value = await readInputValue(page);
    if (value === PREFIX_CASES.find((c) => c.key === key).expected) {
      matchedAt = Date.now() - started;
      break;
    }
    await page.waitForTimeout(40);
  }

  const readyAfter = await engineReady(page);
  return {
    readyBefore,
    readyAfter,
    valueBefore,
    value,
    matchedAt,
    reactionMs: matchedAt >= 0 ? matchedAt : Date.now() - started,
    ok: matchedAt >= 0,
  };
}

async function runCase(browser, viewport, prefix, url) {
  const context = await browser.newContext({
    ...viewport,
    locale: "cs-CZ",
  });
  await prepareContext(context);
  const page = await context.newPage();
  const result = {
    viewport: viewport.id,
    prefix: prefix.key,
    label: prefix.label,
    url,
    pass: false,
    detail: "",
  };

  try {
    await installEngineDelay(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);

    /* Ensure template mode: empty + not focused. */
    await page.evaluate(() => {
      const inp = document.getElementById("iuSilverHomeInput");
      if (inp) {
        inp.value = "";
        try {
          inp.blur();
        } catch (_) {}
      }
    });
    await page.waitForTimeout(120);

    const tap = await firstTapPrefix(page, prefix.key);
    result.readyBefore = tap.readyBefore;
    result.readyAfter = tap.readyAfter;
    result.value = tap.value;
    result.expected = prefix.expected;
    result.reactionMs = tap.reactionMs;

    if (tap.readyBefore) {
      result.detail = "engine_already_ready_before_first_tap_cold_path_not_exercised";
      result.pass = false;
    } else if (!tap.ok) {
      result.detail = "first_tap_did_not_set_prefix_value_within_" + REACTION_MAX_MS + "ms";
      result.pass = false;
    } else if (tap.value !== prefix.expected) {
      result.detail = "value_mismatch";
      result.pass = false;
    } else if (tap.reactionMs < ENGINE_DELAY_MS - 150) {
      /* With SW disabled + route delay, first tap must wait on hold/retry (not a warm no-op path). */
      result.detail = "reaction_faster_than_engine_delay_hold_path_not_proven";
      result.pass = false;
    } else {
      result.detail = "ok";
      result.pass = true;
    }
  } catch (err) {
    result.detail = String(err && err.message ? err.message : err);
    result.pass = false;
  } finally {
    await context.close();
  }
  return result;
}

async function runPageshowCase(browser, url) {
  const context = await browser.newContext({
    ...VIEWPORTS[0],
    locale: "cs-CZ",
  });
  await prepareContext(context);
  const page = await context.newPage();
  const result = {
    viewport: "mobile",
    prefix: "calendar",
    label: "pageshow_reload_first_tap",
    url,
    pass: false,
    detail: "",
  };
  try {
    await installEngineDelay(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await page.evaluate(() => {
      const inp = document.getElementById("iuSilverHomeInput");
      if (inp) {
        inp.value = "";
        try {
          inp.blur();
        } catch (_) {}
      }
    });
    const tap = await firstTapPrefix(page, "calendar");
    result.readyBefore = tap.readyBefore;
    result.readyAfter = tap.readyAfter;
    result.value = tap.value;
    result.expected = "Do kalendáře ";
    result.reactionMs = tap.reactionMs;
    if (tap.readyBefore) {
      result.detail = "engine_already_ready_after_reload";
      result.pass = false;
    } else if (!tap.ok || tap.value !== "Do kalendáře ") {
      result.detail = "reload_first_tap_failed";
      result.pass = false;
    } else if (tap.reactionMs < ENGINE_DELAY_MS - 150) {
      result.detail = "reload_reaction_faster_than_engine_delay_hold_path_not_proven";
      result.pass = false;
    } else {
      result.detail = "ok";
      result.pass = true;
    }
  } catch (err) {
    result.detail = String(err && err.message ? err.message : err);
    result.pass = false;
  } finally {
    await context.close();
  }
  return result;
}

async function main() {
  const url = envUrl();
  const browser = await chromium.launch({ headless: true });
  const cases = [];

  try {
    for (let v = 0; v < VIEWPORTS.length; v++) {
      for (let p = 0; p < PREFIX_CASES.length; p++) {
        /* Fresh context per case = cold open; reload semantics covered separately. */
        cases.push(await runCase(browser, VIEWPORTS[v], PREFIX_CASES[p], url));
      }
    }
    cases.push(await runPageshowCase(browser, url));
  } finally {
    await browser.close();
  }

  const pass = cases.every((c) => c.pass);
  const failed = cases.filter((c) => !c.pass).map((c) => c.viewport + ":" + c.prefix + ":" + c.detail);
  process.stdout.write(
    JSON.stringify({
      guard: "SILVER_HOME_PREFIX_FIRST_TAP_GUARD_V1",
      pass,
      failed,
      engineDelayMs: ENGINE_DELAY_MS,
      reactionMaxMs: REACTION_MAX_MS,
      url,
      cases,
      ts: new Date().toISOString(),
    }) + "\n"
  );
  if (!pass) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});

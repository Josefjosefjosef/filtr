#!/usr/bin/env node
"use strict";

/**
 * Silver home prefix first-tap guards (mobile + tablet):
 *  - FAST: normal production path — engine prefetched, reaction ≤ 250ms
 *  - STRESS: delayed engine — optimistic UI ≤ 250ms, final OK, single action
 *  - SCENARIOS: reload, history, visibility, bfcache/pageshow, SW, PWA-like, race
 *
 * Run: node scripts/silver-home-prefix-first-tap-guard-v1.cjs
 */

const { chromium } = require("playwright");
const {
  FAST_REACTION_MAX_MS,
  STRESS_ENGINE_DELAY_MS,
  STRESS_OPTIMISTIC_MAX_MS,
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
} = require("./silver-home-prefix-first-tap-shared.cjs");

function fail(result, detail) {
  result.detail = detail;
  result.pass = false;
  return result;
}

function ok(result, detail) {
  result.detail = detail || "ok";
  result.pass = true;
  return result;
}

async function openFresh(browser, viewport, url, opts) {
  const contextOpts = { ...viewport, locale: "cs-CZ" };
  if (opts && opts.standalone) {
    contextOpts.userAgent = (viewport.userAgent || "") + "";
    /* Playwright has no full PWA display-mode; emulate via init script + matchMedia. */
  }
  const context = await browser.newContext(contextOpts);
  await prepareContext(context, opts);
  if (opts && opts.standalone) {
    await context.addInitScript(() => {
      try {
        if (!window.__iuNativeMatchMedia) {
          window.__iuNativeMatchMedia = window.matchMedia.bind(window);
        }
        window.matchMedia = function (query) {
          if (String(query).indexOf("display-mode: standalone") >= 0) {
            return {
              matches: true,
              media: query,
              onchange: null,
              addListener: function () {},
              removeListener: function () {},
              addEventListener: function () {},
              removeEventListener: function () {},
              dispatchEvent: function () {
                return false;
              },
            };
          }
          return window.__iuNativeMatchMedia(query);
        };
      } catch (_) {}
    });
  }
  const page = await context.newPage();
  if (opts && opts.engineDelayMs) {
    await installEngineDelay(page, opts.engineDelayMs);
  }
  return { context, page };
}

async function runFastCase(browser, viewport, prefix, url) {
  const result = {
    suite: "fast",
    viewport: viewport.id,
    prefix: prefix.key,
    label: prefix.label,
    pass: false,
    detail: "",
  };
  const { context, page } = await openFresh(browser, viewport, url, { disableSw: true });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await waitEngineReady(page, 15000);
    await resetTemplateMode(page);
    await page.waitForTimeout(40);
    const readyBefore = await engineReady(page);
    if (!readyBefore) return fail(result, "prefetch_did_not_ready_engine_before_tap");
    const tap = await firstTapPrefixMeasured(page, prefix.key, prefix.expected, FAST_REACTION_MAX_MS);
    result.readyBefore = tap.readyBefore;
    result.reactionMs = tap.reactionMs;
    result.value = tap.value;
    result.expected = prefix.expected;
    if (!tap.ok) return fail(result, "fast_tap_timeout");
    if (tap.value !== prefix.expected) return fail(result, "value_mismatch");
    if (tap.reactionMs > FAST_REACTION_MAX_MS) return fail(result, "slow_reaction_" + tap.reactionMs + "ms");
    return ok(result, "ok");
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runStressCase(browser, viewport, prefix, url) {
  const result = {
    suite: "stress",
    viewport: viewport.id,
    prefix: prefix.key,
    label: prefix.label,
    pass: false,
    detail: "",
  };
  const { context, page } = await openFresh(browser, viewport, url, {
    disableSw: true,
    engineDelayMs: STRESS_ENGINE_DELAY_MS,
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await resetTemplateMode(page);
    /* Do not wait for engine — stress path must start cold. */
    const readyBefore = await engineReady(page);
    if (readyBefore) return fail(result, "engine_ready_before_stress_tap");

    const tap = await firstTapPrefixPlaywright(page, prefix.key, prefix.expected, STRESS_OPTIMISTIC_MAX_MS);
    result.readyBefore = tap.readyBefore;
    result.optimisticReactionMs = tap.reactionMs;
    result.value = tap.value;
    result.expected = prefix.expected;
    result.countersAfter = tap.countersAfter;

    if (!tap.ok) return fail(result, "stress_optimistic_ui_not_within_" + STRESS_OPTIMISTIC_MAX_MS + "ms");
    if (tap.reactionMs > STRESS_OPTIMISTIC_MAX_MS) return fail(result, "stress_optimistic_slow_" + tap.reactionMs + "ms");
    if ((tap.countersAfter && tap.countersAfter.optimistic) !== 1) {
      return fail(result, "expected_exactly_one_optimistic_apply_got_" + (tap.countersAfter && tap.countersAfter.optimistic));
    }

    await waitEngineReady(page, STRESS_FINAL_MAX_MS);
    await page.waitForTimeout(80);
    const finalValue = await readInputValue(page);
    const counters = await readCounters(page);
    result.finalValue = finalValue;
    result.finalizeCount = counters.finalize;
    result.optimisticCount = counters.optimistic;
    if (finalValue !== prefix.expected) return fail(result, "final_value_mismatch");
    if (counters.optimistic !== 1) return fail(result, "double_or_zero_optimistic_" + counters.optimistic);
    if (counters.finalize > 1) return fail(result, "double_finalize_" + counters.finalize);
    return ok(result, "ok");
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runReloadFast(browser, url) {
  const viewport = VIEWPORTS[0];
  const result = { suite: "scenario", id: "reload_fast_mobile", pass: false, detail: "" };
  const { context, page } = await openFresh(browser, viewport, url, { disableSw: true });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await waitEngineReady(page, 15000);
    await resetTemplateMode(page);
    const tap = await firstTapPrefixMeasured(page, "calendar", "Do kalendáře ", FAST_REACTION_MAX_MS);
    result.reactionMs = tap.reactionMs;
    if (!tap.ok || tap.reactionMs > FAST_REACTION_MAX_MS) return fail(result, "reload_fast_failed_" + tap.reactionMs);
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runHardReloadEquiv(browser, url) {
  /* Fresh context ≈ hard reload / clean document. */
  const result = { suite: "scenario", id: "hard_reload_equiv_tablet", pass: false, detail: "" };
  const { context, page } = await openFresh(browser, VIEWPORTS[1], url, { disableSw: true });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await waitEngineReady(page, 15000);
    await resetTemplateMode(page);
    const tap = await firstTapPrefixMeasured(page, "notes", "Do poznámek ", FAST_REACTION_MAX_MS);
    result.reactionMs = tap.reactionMs;
    if (!tap.ok || tap.reactionMs > FAST_REACTION_MAX_MS) return fail(result, "hard_reload_equiv_failed");
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runHistoryBack(browser, url) {
  const result = {
    suite: "scenario",
    id: "history_back_mobile",
    pass: false,
    detail: "",
    limitation: "same-origin history.back within SPA shell; not cross-site referrer",
  };
  const { context, page } = await openFresh(browser, VIEWPORTS[0], url, { disableSw: true });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await waitEngineReady(page, 15000);
    await page.evaluate(() => {
      history.pushState({ iu: 1 }, "", location.pathname + location.search + "#iu-guard-hist");
    });
    await page.evaluate(() => {
      history.back();
    });
    await page.waitForTimeout(200);
    await waitForPrefixVisible(page);
    await waitEngineReady(page, 15000);
    await resetTemplateMode(page);
    const tap = await firstTapPrefixMeasured(page, "reminder", "Připomeň mi ", FAST_REACTION_MAX_MS);
    result.reactionMs = tap.reactionMs;
    if (!tap.ok || tap.reactionMs > FAST_REACTION_MAX_MS) return fail(result, "history_back_tap_failed");
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runPageshowPersistedSim(browser, url) {
  const result = {
    suite: "scenario",
    id: "pageshow_persisted_sim_mobile",
    pass: false,
    detail: "",
    limitation: "Chromium CI cannot reliably force real bfcache; we dispatch pageshow{persisted:true} + visibility restore",
  };
  const { context, page } = await openFresh(browser, VIEWPORTS[0], url, { disableSw: true });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await waitEngineReady(page, 15000);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true, bubbles: true }));
    });
    await page.waitForTimeout(120);
    await waitEngineReady(page, 15000);
    await resetTemplateMode(page);
    const tap = await firstTapPrefixMeasured(page, "calendar", "Do kalendáře ", FAST_REACTION_MAX_MS);
    result.reactionMs = tap.reactionMs;
    if (!tap.ok || tap.reactionMs > FAST_REACTION_MAX_MS) return fail(result, "pageshow_persisted_sim_failed");
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runVisibilityResume(browser, url) {
  const result = { suite: "scenario", id: "visibility_resume_mobile", pass: false, detail: "" };
  const { context, page } = await openFresh(browser, VIEWPORTS[0], url, { disableSw: true });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await waitEngineReady(page, 15000);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(80);
    await waitEngineReady(page, 15000);
    await resetTemplateMode(page);
    const tap = await firstTapPrefixMeasured(page, "notes", "Do poznámek ", FAST_REACTION_MAX_MS);
    result.reactionMs = tap.reactionMs;
    if (!tap.ok || tap.reactionMs > FAST_REACTION_MAX_MS) return fail(result, "visibility_resume_failed");
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runStandalonePwaLike(browser, url) {
  const result = {
    suite: "scenario",
    id: "pwa_standalone_like_mobile",
    pass: false,
    detail: "",
    limitation: "emulated display-mode: standalone via matchMedia stub; not a real installed PWA package",
  };
  const { context, page } = await openFresh(browser, VIEWPORTS[0], url, { disableSw: true, standalone: true });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await waitEngineReady(page, 15000);
    await resetTemplateMode(page);
    const tap = await firstTapPrefixMeasured(page, "calendar", "Do kalendáře ", FAST_REACTION_MAX_MS);
    result.reactionMs = tap.reactionMs;
    if (!tap.ok || tap.reactionMs > FAST_REACTION_MAX_MS) return fail(result, "standalone_tap_failed");
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runWithServiceWorker(browser, url) {
  const result = {
    suite: "scenario",
    id: "service_worker_enabled_mobile",
    pass: false,
    detail: "",
    limitation: "allows sw.js registration on localhost checkout; not a production CDN SW update race",
  };
  const { context, page } = await openFresh(browser, VIEWPORTS[0], url, { disableSw: false });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await waitEngineReady(page, 20000);
    await resetTemplateMode(page);
    const tap = await firstTapPrefixMeasured(page, "reminder", "Připomeň mi ", FAST_REACTION_MAX_MS);
    result.reactionMs = tap.reactionMs;
    if (!tap.ok || tap.reactionMs > FAST_REACTION_MAX_MS) return fail(result, "sw_enabled_tap_failed");
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runCacheSecondVisit(browser, url) {
  const result = {
    suite: "scenario",
    id: "cache_second_visit_mobile",
    pass: false,
    detail: "",
    limitation: "second navigation in same context after SW-enabled first visit (HTTP cache/SW warm)",
  };
  const { context, page } = await openFresh(browser, VIEWPORTS[0], url, { disableSw: false });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await waitEngineReady(page, 20000);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await waitEngineReady(page, 20000);
    await resetTemplateMode(page);
    const tap = await firstTapPrefixMeasured(page, "calendar", "Do kalendáře ", FAST_REACTION_MAX_MS);
    result.reactionMs = tap.reactionMs;
    if (!tap.ok || tap.reactionMs > FAST_REACTION_MAX_MS) return fail(result, "cache_second_visit_failed");
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runSwUpdateReload(browser, url) {
  const result = {
    suite: "scenario",
    id: "sw_update_reload_sim_mobile",
    pass: false,
    detail: "",
    limitation: "simulates post-update reload via controllerchange-style full reload after SW-enabled visit",
  };
  const { context, page } = await openFresh(browser, VIEWPORTS[0], url, { disableSw: false });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await waitEngineReady(page, 20000);
    await resetTemplateMode(page);
    const tap = await firstTapPrefixMeasured(page, "notes", "Do poznámek ", FAST_REACTION_MAX_MS);
    result.reactionMs = tap.reactionMs;
    if (!tap.ok || tap.reactionMs > FAST_REACTION_MAX_MS) return fail(result, "sw_update_reload_sim_failed");
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function clickPrefixDom(page, key) {
  /* After optimistic apply, template buttons are hidden — still exercise capture hold via DOM click. */
  await page.evaluate((k) => {
    const btn = document.querySelector('#iuSilverHomeInputUx [data-iu-silver-home-prefix="' + k + '"]');
    if (!btn) throw new Error("missing_prefix_" + k);
    btn.click();
  }, key);
}

async function runRapidSwitchStress(browser, url) {
  const result = { suite: "scenario", id: "rapid_switch_stress_mobile", pass: false, detail: "" };
  const { context, page } = await openFresh(browser, VIEWPORTS[0], url, {
    disableSw: true,
    engineDelayMs: STRESS_ENGINE_DELAY_MS,
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await resetTemplateMode(page);
    await page.locator(prefixSel("calendar")).click({ timeout: 10000 });
    await page.waitForTimeout(30);
    await clickPrefixDom(page, "reminder");
    await page.waitForTimeout(30);
    await clickPrefixDom(page, "notes");
    const early = await readInputValue(page);
    if (early !== "Do poznámek ") return fail(result, "rapid_switch_optimistic_last_not_notes_got_" + early);
    await waitEngineReady(page, STRESS_FINAL_MAX_MS);
    await page.waitForTimeout(100);
    const finalValue = await readInputValue(page);
    const counters = await readCounters(page);
    result.finalValue = finalValue;
    result.optimisticCount = counters.optimistic;
    result.finalizeCount = counters.finalize;
    if (finalValue !== "Do poznámek ") return fail(result, "rapid_switch_final_mismatch");
    if (counters.optimistic !== 3) return fail(result, "expected_3_optimistic_got_" + counters.optimistic);
    if (counters.finalize > 1) return fail(result, "stale_pending_finalize_count_" + counters.finalize);
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runDoubleTapNoDouble(browser, url) {
  const result = { suite: "scenario", id: "double_tap_single_action_mobile", pass: false, detail: "" };
  const { context, page } = await openFresh(browser, VIEWPORTS[0], url, {
    disableSw: true,
    engineDelayMs: STRESS_ENGINE_DELAY_MS,
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await resetTemplateMode(page);
    await page.locator(prefixSel("calendar")).click({ timeout: 10000 });
    await clickPrefixDom(page, "calendar");
    await waitEngineReady(page, STRESS_FINAL_MAX_MS);
    await page.waitForTimeout(100);
    const value = await readInputValue(page);
    const counters = await readCounters(page);
    result.value = value;
    result.optimisticCount = counters.optimistic;
    result.finalizeCount = counters.finalize;
    if (value !== "Do kalendáře ") return fail(result, "double_tap_value_mismatch");
    if (counters.optimistic !== 2) return fail(result, "expected_2_optimistic_same_key_got_" + counters.optimistic);
    if (counters.finalize > 1) return fail(result, "double_finalize_after_double_tap_" + counters.finalize);
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runQuickActionsPresent(browser, url) {
  const result = {
    suite: "scenario",
    id: "quick_actions_same_lazy_path_mobile",
    pass: false,
    detail: "",
  };
  const { context, page } = await openFresh(browser, VIEWPORTS[0], url, {
    disableSw: true,
    engineDelayMs: STRESS_ENGINE_DELAY_MS,
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    const info = await page.evaluate(() => {
      const keys = ["calendar", "reminder", "notes"];
      const out = {};
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const el = document.querySelector('#iuSilverHomeInputUx [data-iu-silver-home-quick-action="' + k + '"]');
        out[k] = {
          found: !!el,
          pe: el ? getComputedStyle(el).pointerEvents : "",
          w: el ? el.getBoundingClientRect().width : 0,
        };
      }
      return out;
    });
    result.info = info;
    const missing = ["calendar", "reminder", "notes"].filter((k) => !info[k] || !info[k].found);
    if (missing.length) return fail(result, "missing_quick_actions_" + missing.join(","));

    /* Cold click hold should mark aria-busy then clear after engine (no throw). */
    await page.locator(quickActionSel("calendar")).click({ timeout: 10000 });
    const busy = await page.evaluate(() => {
      const el = document.querySelector('#iuSilverHomeInputUx [data-iu-silver-home-quick-action="calendar"]');
      return el ? el.getAttribute("aria-busy") : null;
    });
    if (busy !== "true") return fail(result, "quick_action_missing_immediate_aria_busy");
    await waitEngineReady(page, STRESS_FINAL_MAX_MS);
    await page.waitForTimeout(120);
    const busyAfter = await page.evaluate(() => {
      const el = document.querySelector('#iuSilverHomeInputUx [data-iu-silver-home-quick-action="calendar"]');
      return el ? el.getAttribute("aria-busy") : "missing";
    });
    if (busyAfter === "true") return fail(result, "quick_action_aria_busy_stuck");
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runPendingCancelOnNavigate(browser, url) {
  const result = { suite: "scenario", id: "pending_cancel_on_pageshow_mobile", pass: false, detail: "" };
  const { context, page } = await openFresh(browser, VIEWPORTS[0], url, {
    disableSw: true,
    engineDelayMs: STRESS_ENGINE_DELAY_MS,
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await resetTemplateMode(page);
    await page.locator(prefixSel("calendar")).click({ timeout: 10000 });
    /* Navigate away-equivalent: pageshow cancels pending; then new tap must not inherit stale finalize doubling. */
    await page.evaluate(() => {
      try {
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false, bubbles: true }));
      } catch (_) {
        window.dispatchEvent(new Event("pageshow"));
      }
    });
    await page.waitForTimeout(50);
    await clickPrefixDom(page, "notes");
    await waitEngineReady(page, STRESS_FINAL_MAX_MS);
    await page.waitForTimeout(120);
    const value = await readInputValue(page);
    const counters = await readCounters(page);
    result.value = value;
    result.finalizeCount = counters.finalize;
    if (value !== "Do poznámek ") return fail(result, "pending_cancel_wrong_final");
    if (counters.finalize > 1) return fail(result, "stale_pending_executed_finalize_" + counters.finalize);
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function main() {
  const url = envUrl();
  const browser = await chromium.launch({ headless: true });
  const cases = [];
  try {
    for (let v = 0; v < VIEWPORTS.length; v++) {
      for (let p = 0; p < PREFIX_CASES.length; p++) {
        cases.push(await runFastCase(browser, VIEWPORTS[v], PREFIX_CASES[p], url));
      }
    }
    for (let v = 0; v < VIEWPORTS.length; v++) {
      for (let p = 0; p < PREFIX_CASES.length; p++) {
        cases.push(await runStressCase(browser, VIEWPORTS[v], PREFIX_CASES[p], url));
      }
    }
    cases.push(await runReloadFast(browser, url));
    cases.push(await runHardReloadEquiv(browser, url));
    cases.push(await runHistoryBack(browser, url));
    cases.push(await runPageshowPersistedSim(browser, url));
    cases.push(await runVisibilityResume(browser, url));
    cases.push(await runStandalonePwaLike(browser, url));
    cases.push(await runWithServiceWorker(browser, url));
    cases.push(await runCacheSecondVisit(browser, url));
    cases.push(await runSwUpdateReload(browser, url));
    cases.push(await runRapidSwitchStress(browser, url));
    cases.push(await runDoubleTapNoDouble(browser, url));
    cases.push(await runQuickActionsPresent(browser, url));
    cases.push(await runPendingCancelOnNavigate(browser, url));
  } finally {
    await browser.close();
  }

  const pass = cases.every((c) => c.pass);
  const failed = cases
    .filter((c) => !c.pass)
    .map((c) => (c.suite || "?") + ":" + (c.id || c.viewport + ":" + c.prefix) + ":" + c.detail);
  process.stdout.write(
    JSON.stringify({
      guard: "SILVER_HOME_PREFIX_FIRST_TAP_GUARD_V1",
      pass,
      failed,
      fastReactionMaxMs: FAST_REACTION_MAX_MS,
      stressEngineDelayMs: STRESS_ENGINE_DELAY_MS,
      stressOptimisticMaxMs: STRESS_OPTIMISTIC_MAX_MS,
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

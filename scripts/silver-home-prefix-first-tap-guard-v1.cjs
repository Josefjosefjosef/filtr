#!/usr/bin/env node
"use strict";

/**
 * Silver home prefix first-tap guards (mobile + tablet):
 *  - FAST: cold-open production path — engine prefetched, reaction ≤ 250ms
 *  - STRESS: delayed engine — functional first-tap + fixed 5-sample true median
 *  - SCENARIOS: reload, history, visibility, bfcache/pageshow, SW, PWA-like, race
 *  - SELFTEST: negative functional / systematic-slowness probes (proves guard bite)
 *
 * Timing: browser performance.now() click→value (not pointerdown→Playwright IPC).
 * Run: node scripts/silver-home-prefix-first-tap-guard-v1.cjs
 */

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const {
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
  installEngineGate,
  waitForPrefixVisible,
  resetTemplateMode,
  engineReady,
  waitEngineReady,
  readInputValue,
  readCounters,
  firstTapPrefixMeasured,
  timingStats,
  evaluateStressSamples,
} = require("./silver-home-prefix-first-tap-shared.cjs");

const ARTIFACT_DIR =
  process.env.IU_SILVER_FIRST_TAP_ARTIFACT_DIR ||
  path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu-silver-first-tap-guard");

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
  let releaseEngineGate = null;
  if (opts && opts.engineGate) {
    releaseEngineGate = await installEngineGate(page);
  } else if (opts && opts.engineDelayMs) {
    await installEngineDelay(page, opts.engineDelayMs);
  }
  return { context, page, releaseEngineGate };
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

async function saveStressArtifact(page, result, tag) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const base =
      "stress-" +
      String(result.viewport || "vp") +
      "-" +
      String(result.prefix || "prefix") +
      "-" +
      String(tag || "fail") +
      "-" +
      Date.now();
    const shot = path.join(ARTIFACT_DIR, base + ".png");
    await page.screenshot({ path: shot, fullPage: true });
    result.screenshot = shot;
  } catch (_) {}
}

/**
 * One cold stress sample: engine gated until after first tap + in-page click→value timing
 * (performance.now in browser context; excludes Playwright IPC / Node scheduling).
 */
async function runStressSample(browser, viewport, prefix, url, hooks) {
  const h = hooks || {};
  const sample = {
    functionalOk: false,
    performanceMs: -1,
    contractFail: null,
    detail: "",
    value: "",
    finalValue: "",
    readyBefore: null,
    countersAfter: null,
    optimisticCount: null,
    finalizeCount: null,
  };
  const { context, page, releaseEngineGate } = await openFresh(browser, viewport, url, {
    disableSw: true,
    engineGate: true,
  });
  try {
    if (typeof h.initScript === "function") {
      await context.addInitScript(h.initScript);
    }
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForPrefixVisible(page);
    await resetTemplateMode(page);
    if (typeof h.afterReady === "function") {
      await h.afterReady(page);
    }
    const readyBefore = await engineReady(page);
    sample.readyBefore = readyBefore;
    if (readyBefore) {
      sample.contractFail = "functional";
      sample.detail = "engine_ready_before_stress_tap";
      return sample;
    }

    /* Wait budget for observing optimistic UI (functional). Timing uses in-page metric. */
    const tap = await firstTapPrefixMeasured(page, prefix.key, prefix.expected, STRESS_OPTIMISTIC_HARD_MS);
    sample.performanceMs = tap.reactionMs;
    sample.value = tap.value;
    sample.countersAfter = tap.countersAfter;

    if (tap.readyAtClick) {
      sample.contractFail = "functional";
      sample.detail = "engine_ready_at_click";
      await saveStressArtifact(page, sample, "ready-at-click");
      return sample;
    }
    if (!tap.ok || tap.value !== prefix.expected) {
      sample.contractFail = "functional";
      sample.detail = "stress_optimistic_ui_missing";
      await saveStressArtifact(page, sample, "no-optimistic");
      return sample;
    }
    if ((tap.countersAfter && tap.countersAfter.optimistic) !== 1) {
      sample.contractFail = "functional";
      sample.detail =
        "expected_exactly_one_optimistic_apply_got_" + (tap.countersAfter && tap.countersAfter.optimistic);
      await saveStressArtifact(page, sample, "optimistic-count");
      return sample;
    }

    if (typeof releaseEngineGate === "function") releaseEngineGate();
    await waitEngineReady(page, STRESS_FINAL_MAX_MS);
    await page.waitForTimeout(80);
    const finalValue = await readInputValue(page);
    const counters = await readCounters(page);
    sample.finalValue = finalValue;
    sample.finalizeCount = counters.finalize;
    sample.optimisticCount = counters.optimistic;
    if (finalValue !== prefix.expected) {
      sample.contractFail = "functional";
      sample.detail = "final_value_mismatch";
      await saveStressArtifact(page, sample, "final-mismatch");
      return sample;
    }
    if (counters.optimistic !== 1) {
      sample.contractFail = "functional";
      sample.detail = "double_or_zero_optimistic_" + counters.optimistic;
      await saveStressArtifact(page, sample, "optimistic-final");
      return sample;
    }
    if (counters.finalize > 1) {
      sample.contractFail = "functional";
      sample.detail = "double_finalize_" + counters.finalize;
      await saveStressArtifact(page, sample, "double-finalize");
      return sample;
    }

    sample.functionalOk = true;
    sample.detail = "ok";
    return sample;
  } catch (err) {
    sample.contractFail = "functional";
    sample.detail = String(err && err.message ? err.message : err);
    return sample;
  } finally {
    try {
      if (typeof releaseEngineGate === "function") releaseEngineGate();
    } catch (_) {}
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
    contract: null,
    expected: prefix.expected,
    softLimitMs: STRESS_OPTIMISTIC_SOFT_MS,
    hardLimitMs: STRESS_OPTIMISTIC_HARD_MS,
    metric: "in_page_click_to_value",
  };

  const times = [];
  let last = null;
  /* Fixed odd sample count — never early-exit based on interim results. */
  for (let i = 0; i < STRESS_TIMING_SAMPLES_MAX; i++) {
    last = await runStressSample(browser, viewport, prefix, url, {});
    if (!last.functionalOk) {
      result.contract = "functional";
      result.readyBefore = last.readyBefore;
      result.value = last.value;
      result.finalValue = last.finalValue;
      result.countersAfter = last.countersAfter;
      result.optimisticCount = last.optimisticCount;
      result.finalizeCount = last.finalizeCount;
      result.optimisticReactionMs = last.performanceMs;
      result.timing = timingStats(times.concat(last.performanceMs >= 0 ? [last.performanceMs] : []));
      result.screenshot = last.screenshot;
      return fail(result, last.detail || "stress_functional_fail");
    }
    times.push(last.performanceMs);
  }

  const evaln = evaluateStressSamples(times, STRESS_OPTIMISTIC_SOFT_MS, STRESS_OPTIMISTIC_HARD_MS);
  const timing = evaln.timing || timingStats(times);
  result.timing = timing;
  result.optimisticReactionMs = timing.median;
  result.readyBefore = last && last.readyBefore;
  result.value = last && last.value;
  result.finalValue = last && last.finalValue;
  result.countersAfter = last && last.countersAfter;
  result.optimisticCount = last && last.optimisticCount;
  result.finalizeCount = last && last.finalizeCount;

  if (!evaln.pass && evaln.contract === "performance_hard") {
    result.contract = "performance";
    return fail(
      result,
      "stress_performance_hard_max_" +
        timing.max +
        "ms_gt_" +
        STRESS_OPTIMISTIC_HARD_MS +
        "_median_" +
        timing.median +
        "_p90_" +
        timing.p90 +
        "_samples_" +
        JSON.stringify(timing.samples)
    );
  }
  if (!evaln.pass && evaln.contract === "performance_soft") {
    result.contract = "performance";
    return fail(
      result,
      "stress_performance_median_" +
        timing.median +
        "ms_gt_soft_" +
        STRESS_OPTIMISTIC_SOFT_MS +
        "_p90_" +
        timing.p90 +
        "_max_" +
        timing.max +
        "_samples_" +
        JSON.stringify(timing.samples)
    );
  }
  if (!evaln.pass) {
    result.contract = "performance";
    return fail(result, evaln.detail || "stress_performance_fail");
  }

  result.contract = "ok";
  return ok(result, "ok");
}

async function runNegativeSelftests(browser, url) {
  const viewport = VIEWPORTS[0];
  const prefix = PREFIX_CASES.find((p) => p.key === "notes") || PREFIX_CASES[0];
  const out = { suite: "selftest", id: "negative_probes", pass: false, detail: "", probes: [] };

  /* Functional bite: swallow writes to the Silver field (input or textarea). */
  const blocked = await runStressSample(browser, viewport, prefix, url, {
    afterReady: async (page) => {
      await page.evaluate(() => {
        const el = document.getElementById("iuSilverHomeInput");
        if (!el) return;
        const proto = Object.getPrototypeOf(el);
        const desc =
          Object.getOwnPropertyDescriptor(proto, "value") ||
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value") ||
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
        if (!desc || !desc.set || !desc.get) return;
        Object.defineProperty(el, "value", {
          configurable: true,
          enumerable: true,
          get: function () {
            return desc.get.call(el);
          },
          set: function () {
            desc.set.call(el, "");
          },
        });
      });
    },
  });
  out.probes.push({
    id: "block_optimistic",
    expect: "functional_fail",
    gotFunctionalOk: blocked.functionalOk,
    detail: blocked.detail,
    pass: !blocked.functionalOk && String(blocked.detail || "").indexOf("Illegal invocation") < 0,
  });

  /* Performance bite: delay the real value past the hard ceiling wait. */
  const slowed = await runStressSample(browser, viewport, prefix, url, {
    afterReady: async (page) => {
      await page.evaluate((delayMs) => {
        const el = document.getElementById("iuSilverHomeInput");
        if (!el) return;
        const proto = Object.getPrototypeOf(el);
        const desc =
          Object.getOwnPropertyDescriptor(proto, "value") ||
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value") ||
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
        if (!desc || !desc.set || !desc.get) return;
        let releaseAt = 0;
        Object.defineProperty(el, "value", {
          configurable: true,
          enumerable: true,
          get: function () {
            return desc.get.call(el);
          },
          set: function (v) {
            const val = v;
            if (!releaseAt) releaseAt = performance.now() + delayMs;
            const wait = Math.max(0, releaseAt - performance.now());
            setTimeout(function () {
              try {
                desc.set.call(el, val);
              } catch (_) {}
            }, wait);
            desc.set.call(el, "");
          },
        });
      }, STRESS_OPTIMISTIC_HARD_MS + 250);
    },
  });
  out.probes.push({
    id: "systematic_slow_optimistic",
    expect: "functional_timeout_or_slow",
    gotFunctionalOk: slowed.functionalOk,
    performanceMs: slowed.performanceMs,
    detail: slowed.detail,
    pass:
      String(slowed.detail || "").indexOf("Illegal invocation") < 0 &&
      (!slowed.functionalOk || slowed.performanceMs > STRESS_OPTIMISTIC_HARD_MS),
  });

  const fakeEval = evaluateStressSamples([200, 240, 1200, 1210, 1190], STRESS_OPTIMISTIC_SOFT_MS, STRESS_OPTIMISTIC_HARD_MS);
  out.probes.push({
    id: "fabricated_slow_median",
    expect: "performance_fail",
    timing: fakeEval.timing,
    contract: fakeEval.contract,
    pass: fakeEval.pass === false && (fakeEval.contract === "performance_hard" || fakeEval.contract === "performance_soft"),
  });

  out.pass = out.probes.every((p) => p.pass);
  out.detail = out.pass ? "ok" : "negative_probe_missed_bite";
  if (!out.pass) {
    out.failed = out.probes.filter((p) => !p.pass).map((p) => p.id + ":" + (p.detail || "no_bite"));
  }
  return out;
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
    cases.push(await runNegativeSelftests(browser, url));
  } finally {
    await browser.close();
  }

  const pass = cases.every((c) => c.pass);
  const failed = cases
    .filter((c) => !c.pass)
    .map((c) => {
      const id = c.id || c.viewport + ":" + c.prefix;
      const contract = c.contract ? ":contract=" + c.contract : "";
      return (c.suite || "?") + ":" + id + ":" + c.detail + contract;
    });
  const stressCases = cases.filter((c) => c.suite === "stress");
  process.stdout.write(
    JSON.stringify({
      guard: "SILVER_HOME_PREFIX_FIRST_TAP_GUARD_V1",
      pass,
      failed,
      fastReactionMaxMs: FAST_REACTION_MAX_MS,
      stressEngineDelayMs: STRESS_ENGINE_DELAY_MS,
      stressOptimisticSoftMs: STRESS_OPTIMISTIC_SOFT_MS,
      stressOptimisticHardMs: STRESS_OPTIMISTIC_HARD_MS,
      stressOptimisticMaxMs: STRESS_OPTIMISTIC_MAX_MS,
      stressTimingSamplesMax: STRESS_TIMING_SAMPLES_MAX,
      stressMetric: "in_page_click_to_value",
      stressEngineGate: true,
      artifactDir: ARTIFACT_DIR,
      url,
      stressTimingSummary: stressCases.map((c) => ({
        viewport: c.viewport,
        prefix: c.prefix,
        pass: c.pass,
        contract: c.contract,
        timing: c.timing || null,
        detail: c.detail,
        screenshot: c.screenshot || null,
      })),
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

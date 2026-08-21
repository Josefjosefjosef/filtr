#!/usr/bin/env node
"use strict";

/**
 * Silver home prefix first-tap guards (mobile + tablet):
 *  - FAST: normal production path — engine prefetched, reaction ≤ 250ms
 *  - STRESS: delayed engine — functional first-tap + robust in-page timing
 *  - SCENARIOS: reload, history, visibility, bfcache/pageshow, SW, PWA-like, race
 *  - SELFTEST: negative functional / systematic-slowness probes (proves guard bite)
 *
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
  waitForPrefixVisible,
  resetTemplateMode,
  engineReady,
  waitEngineReady,
  readInputValue,
  readCounters,
  firstTapPrefixMeasured,
  timingStats,
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
    result.reactionMs = tap.inPageReactionMs != null ? tap.inPageReactionMs : tap.reactionMs;
    result.inPageReactionMs = tap.inPageReactionMs;
    result.pointerdownAt = tap.pointerdownAt;
    result.valueMatchedAt = tap.valueMatchedAt;
    result.playwrightClickReturnAt = tap.playwrightClickReturnAt;
    result.clickReturnLagMs = tap.clickReturnLagMs;
    result.value = tap.value;
    result.expected = prefix.expected;
    result.functionalOk = !!(tap.ok && tap.value === prefix.expected);
    result.timingOk =
      typeof result.reactionMs === "number" &&
      result.reactionMs >= 0 &&
      result.reactionMs <= FAST_REACTION_MAX_MS;
    process.stdout.write(
      JSON.stringify({
        diag: "FAST_TAP",
        viewport: viewport.id,
        prefix: prefix.key,
        pointerdownAt: result.pointerdownAt,
        valueMatchedAt: result.valueMatchedAt,
        inPageReactionMs: result.inPageReactionMs,
        playwrightClickReturnAt: result.playwrightClickReturnAt,
        clickReturnLagMs: result.clickReturnLagMs,
        functionalOk: result.functionalOk,
        timingOk: result.timingOk,
      }) + "\n"
    );
    if (!tap.ok && tap.detail === "timeout") return fail(result, "fast_tap_timeout");
    if (tap.value !== prefix.expected) return fail(result, "value_mismatch");
    if (!result.functionalOk) return fail(result, "functional_fail");
    if (result.reactionMs > FAST_REACTION_MAX_MS) {
      return fail(result, "slow_reaction_" + result.reactionMs + "ms");
    }
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
 * One cold stress sample: Playwright pointer click (exercises capture listeners)
 * with in-page pointerdown→value timing (avoids IPC inflation that flaked at 282–294ms).
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
  const { context, page } = await openFresh(browser, viewport, url, {
    disableSw: true,
    engineDelayMs: STRESS_ENGINE_DELAY_MS,
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
    metric: "in_page_pointerdown_to_value",
  };

  const times = [];
  let last = null;
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
    /* Fast path: first cold sample already under soft limit — no need for more. */
    if (last.performanceMs <= STRESS_OPTIMISTIC_SOFT_MS) break;
  }

  const timing = timingStats(times);
  result.timing = timing;
  result.optimisticReactionMs = timing.median;
  result.readyBefore = last && last.readyBefore;
  result.value = last && last.value;
  result.finalValue = last && last.finalValue;
  result.countersAfter = last && last.countersAfter;
  result.optimisticCount = last && last.optimisticCount;
  result.finalizeCount = last && last.finalizeCount;

  if (timing.max != null && timing.max > STRESS_OPTIMISTIC_HARD_MS) {
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
  if (timing.median != null && timing.median > STRESS_OPTIMISTIC_SOFT_MS) {
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

  const fakeTiming = timingStats([1200, 1210, 1190]);
  out.probes.push({
    id: "fabricated_slow_median",
    expect: "performance_fail",
    timing: fakeTiming,
    pass:
      fakeTiming.median > STRESS_OPTIMISTIC_SOFT_MS || fakeTiming.max > STRESS_OPTIMISTIC_HARD_MS,
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
    try {
      await page.waitForFunction(
        () => Number(window.__iuSilverPrefixOptimisticCount || 0) >= 3,
        null,
        { timeout: 2000 }
      );
    } catch (_) {
      const countersEarly = await readCounters(page);
      return fail(result, "expected_3_optimistic_got_" + countersEarly.optimistic);
    }
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

    /* Cold click hold should mark aria-busy then clear after engine (no throw).
       Arm BEFORE click so brief busy is not missed, but keep timeout above
       Playwright actionability wait — a short armed waiter rejects as unhandled
       while click() is still pending and crashes the process. */
    let busySeen = false;
    const busyWait = page
      .waitForFunction(
        () => {
          const el = document.querySelector('#iuSilverHomeInputUx [data-iu-silver-home-quick-action="calendar"]');
          return !!(el && el.getAttribute("aria-busy") === "true");
        },
        null,
        { timeout: 12000 }
      )
      .then(() => {
        busySeen = true;
      })
      .catch(() => {
        busySeen = false;
      });
    await page.locator(quickActionSel("calendar")).click({ timeout: 10000 });
    await busyWait;
    if (!busySeen) return fail(result, "quick_action_missing_immediate_aria_busy");
    await waitEngineReady(page, STRESS_FINAL_MAX_MS);
    try {
      await page.waitForFunction(
        () => {
          const el = document.querySelector('#iuSilverHomeInputUx [data-iu-silver-home-quick-action="calendar"]');
          return !el || el.getAttribute("aria-busy") !== "true";
        },
        null,
        { timeout: 5000 }
      );
    } catch (_) {
      return fail(result, "quick_action_aria_busy_stuck");
    }
    return ok(result);
  } catch (err) {
    return fail(result, String(err && err.message ? err.message : err));
  } finally {
    await context.close();
  }
}

async function runMeasurementIntegritySelftests(browser) {
  const result = {
    suite: "selftest",
    id: "in_page_measurement_integrity",
    pass: false,
    detail: "",
    probes: [],
  };
  const html =
    "<!doctype html><html><body>" +
    '<input id="iuSilverHomeInput" />' +
    '<div id="iuSilverHomeInputUx">' +
    '<button type="button" data-iu-silver-home-prefix="calendar">Do kalendáře</button>' +
    "</div>" +
    "<script>" +
    "(function () {" +
    "  window.__iuProbeTapCount = 0;" +
    "  window.__iuProbeTimer = 0;" +
    "  window.__iuProbeGen = 0;" +
    "  document.querySelector('[data-iu-silver-home-prefix=\"calendar\"]').addEventListener('pointerdown', function () {" +
    "    window.__iuProbeTapCount = Number(window.__iuProbeTapCount || 0) + 1;" +
    "    if (window.__iuProbeTimer) { clearTimeout(window.__iuProbeTimer); window.__iuProbeTimer = 0; }" +
    "    if (window.__iuProbeNoOp) return;" +
    "    if (window.__iuProbeSecondTapOnly && window.__iuProbeTapCount < 2) return;" +
    "    var delay = Number(window.__iuProbeDelayMs || 15);" +
    "    var val = String(window.__iuProbeValue || 'Do kalendáře ');" +
    "    var gen = Number(window.__iuProbeGen || 0);" +
    "    window.__iuProbeTimer = setTimeout(function () {" +
    "      if (gen !== Number(window.__iuProbeGen || 0)) return;" +
    "      document.getElementById('iuSilverHomeInput').value = val;" +
    "      window.__iuProbeTimer = 0;" +
    "    }, delay);" +
    "  }, true);" +
    "})();" +
    "</script></body></html>";

  const context = await browser.newContext();
  const page = await context.newPage();
  async function resetProbe(opts) {
    await page.evaluate((o) => {
      window.__iuProbeGen = Number(window.__iuProbeGen || 0) + 1;
      if (window.__iuProbeTimer) {
        clearTimeout(window.__iuProbeTimer);
        window.__iuProbeTimer = 0;
      }
      window.__iuProbeTapCount = 0;
      window.__iuProbeNoOp = !!o.noOp;
      window.__iuProbeSecondTapOnly = !!o.secondTapOnly;
      window.__iuProbeDelayMs = Number(o.delayMs || 15);
      window.__iuProbeValue = String(o.value == null ? "Do kalendáře " : o.value);
      const inp = document.getElementById("iuSilverHomeInput");
      if (inp) inp.value = "";
    }, opts || {});
  }
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      window.__iuSilverP0EngineReady = true;
    });

    /* Probe 1: delayed Playwright click return must not inflate in-page reaction. */
    await resetProbe({ noOp: false, secondTapOnly: false, delayMs: 15, value: "Do kalendáře " });
    const realLocator = page.locator.bind(page);
    page.locator = function (sel) {
      const l = realLocator(sel);
      if (String(sel).indexOf("data-iu-silver-home-prefix") >= 0) {
        const real = l.click.bind(l);
        l.click = async function (opts) {
          await real(opts);
          await new Promise((r) => setTimeout(r, 320));
        };
      }
      return l;
    };
    const tap1 = await firstTapPrefixMeasured(page, "calendar", "Do kalendáře ", FAST_REACTION_MAX_MS);
    page.locator = realLocator;
    const p1 =
      tap1.ok &&
      tap1.inPageReactionMs >= 0 &&
      tap1.inPageReactionMs <= 120 &&
      tap1.clickReturnLagMs >= 250;
    result.probes.push({
      id: "delayed_click_return_excluded",
      expect: "inPage_le_120_and_clickLag_ge_250",
      pass: !!p1,
      inPageReactionMs: tap1.inPageReactionMs,
      clickReturnLagMs: tap1.clickReturnLagMs,
    });

    /* Probe 2: true slow in-page reaction (>250) must FAIL timing. */
    await resetProbe({ noOp: false, secondTapOnly: false, delayMs: 320, value: "Do kalendáře " });
    const tap2 = await firstTapPrefixMeasured(page, "calendar", "Do kalendáře ", FAST_REACTION_MAX_MS);
    const p2 = !tap2.ok || tap2.inPageReactionMs > FAST_REACTION_MAX_MS;
    result.probes.push({
      id: "true_slow_reaction_fails",
      expect: "timeout_or_gt_250",
      pass: !!p2,
      ok: tap2.ok,
      inPageReactionMs: tap2.inPageReactionMs,
      detail: tap2.detail,
    });

    /* Probe 3: missing first tap / no value change → fail. */
    await resetProbe({ noOp: true, secondTapOnly: false, delayMs: 15, value: "Do kalendáře " });
    const tap3 = await firstTapPrefixMeasured(page, "calendar", "Do kalendáře ", FAST_REACTION_MAX_MS);
    const p3 = !tap3.ok;
    result.probes.push({
      id: "missing_first_tap_value",
      expect: "functional_fail",
      pass: !!p3,
      ok: tap3.ok,
      detail: tap3.detail,
    });

    /* Probe 4: wrong prefix value → fail. */
    await resetProbe({ noOp: false, secondTapOnly: false, delayMs: 15, value: "Připomeň mi " });
    const tap4 = await firstTapPrefixMeasured(page, "calendar", "Do kalendáře ", FAST_REACTION_MAX_MS);
    const p4 = !tap4.ok || tap4.value !== "Do kalendáře ";
    result.probes.push({
      id: "wrong_prefix_value",
      expect: "functional_fail",
      pass: !!p4,
      ok: tap4.ok,
      value: tap4.value,
    });

    /* Probe 5: second tap required (first tap no-op) → fail within budget. */
    await resetProbe({ noOp: false, secondTapOnly: true, delayMs: 15, value: "Do kalendáře " });
    const tap5 = await firstTapPrefixMeasured(page, "calendar", "Do kalendáře ", FAST_REACTION_MAX_MS);
    const p5 = !tap5.ok;
    result.probes.push({
      id: "second_tap_required",
      expect: "functional_fail_on_first",
      pass: !!p5,
      ok: tap5.ok,
      detail: tap5.detail,
    });

    const all = result.probes.every((p) => p.pass);
    if (!all) {
      return fail(
        result,
        "probes_failed_" +
          result.probes
            .filter((p) => !p.pass)
            .map((p) => p.id)
            .join(",")
      );
    }
    return ok(result, "ok");
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
    cases.push(await runMeasurementIntegritySelftests(browser));
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
      stressMetric: "in_page_pointerdown_to_value_matched_before_click_return",
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

#!/usr/bin/env node
"use strict";

/**
 * Offline timing-bound / functional regression fixtures for Silver first-tap guard.
 * Pure contract helpers + in-page synthetic harness (no product code changes).
 */
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { chromium } = require("playwright");
const {
  SOFT_LIMIT_MS,
  HARD_LIMIT_MS,
  STRESS_SAMPLE_COUNT,
  classifySoft,
  classifyHard,
  classifyPerformance,
  evaluateStressSamples,
  trueMedian,
} = require("./silver-home-prefix-first-tap-timing-contract.cjs");

const REPO = path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_SILVER_TIMING_FIXTURE_PORT || 18092);
const BASE = "http://127.0.0.1:" + PORT + "/";

function record(id, pass, results, detail) {
  results.push({ id, pass: !!pass, detail: detail || "" });
}

function waitForServer(maxMs) {
  const deadline = Date.now() + maxMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(BASE, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) resolve();
        else if (Date.now() >= deadline) reject(new Error("server not ready"));
        else setTimeout(tick, 150);
      });
      req.on("error", () => {
        if (Date.now() >= deadline) reject(new Error("server not ready"));
        else setTimeout(tick, 150);
      });
    };
    tick();
  });
}

/**
 * Synthetic harness mirrors guard measurement:
 * performance.now() immediately before click → value milestone.
 * Options simulate functional failures without changing product code.
 */
async function measureSynthetic(page, delayMs, opts) {
  const o = opts || {};
  return page.evaluate(
    async ({ delayMs, expected, appliedText, failOpen, requireSecondTap, missingMilestone, controllerDelayMs, tapsToDispatch }) => {
      const inp = document.getElementById("iuSilverHomeInput");
      const btn = document.querySelector('#iuSilverHomeInputUx [data-iu-silver-home-prefix="calendar"]');
      if (!inp || !btn) return { ok: false, detail: "missing_dom", reactionMs: -1, value: "", taps: 0 };

      inp.value = "";
      let taps = 0;
      const handler = (e) => {
        try {
          e.preventDefault();
          e.stopImmediatePropagation();
        } catch (_) {}
        taps += 1;
        if (failOpen) return;
        if (requireSecondTap && taps < 2) return;
        const text = appliedText;
        const apply = () => {
          if (missingMilestone) return;
          inp.value = text;
        };
        if (delayMs > 0) setTimeout(apply, delayMs);
        else apply();
      };
      btn.addEventListener("click", handler, true);

      const t0 = performance.now();
      for (let i = 0; i < tapsToDispatch; i++) {
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      }
      const endAt = t0 + 2000;
      while (performance.now() < endAt) {
        const value = String(inp.value || "");
        if (!missingMilestone && !failOpen && value === appliedText && (!requireSecondTap || taps >= 2)) {
          const reactionMs = Math.round(performance.now() - t0);
          if (controllerDelayMs > 0) {
            await new Promise((r) => setTimeout(r, controllerDelayMs));
          }
          btn.removeEventListener("click", handler, true);
          const functionalOk =
            !failOpen &&
            !missingMilestone &&
            value === expected &&
            !(requireSecondTap && tapsToDispatch < 2);
          return {
            ok: functionalOk,
            reactionMs,
            value,
            taps,
            detail: functionalOk
              ? "ok"
              : value !== expected
                ? "wrong_value"
                : requireSecondTap && tapsToDispatch < 2
                  ? "second_tap_required"
                  : "functional_fail",
          };
        }
        await new Promise((r) => requestAnimationFrame(() => r(true)));
      }
      btn.removeEventListener("click", handler, true);
      return {
        ok: false,
        reactionMs: Math.round(performance.now() - t0),
        value: String(inp.value || ""),
        taps,
        detail: failOpen ? "no_open" : missingMilestone ? "missing_milestone" : "timeout",
      };
    },
    {
      delayMs,
      expected: o.expected || "Do kalendáře ",
      appliedText: o.appliedText || o.expected || "Do kalendáře ",
      failOpen: !!o.failOpen,
      requireSecondTap: !!o.requireSecondTap,
      missingMilestone: !!o.missingMilestone,
      controllerDelayMs: o.controllerDelayMs || 0,
      tapsToDispatch: o.tapsToDispatch == null ? 1 : o.tapsToDispatch,
    }
  );
}

async function main() {
  const results = [];

  record("BOUND_249", classifySoft(249) === "pass_soft", results);
  record("BOUND_250", classifySoft(250) === "pass_soft", results);
  record("BOUND_251", classifySoft(251) === "fail_soft", results);
  record("BOUND_999_SOFT", classifySoft(999) === "fail_soft", results);
  record("BOUND_999_HARD", classifyHard(999) === "pass_hard", results);
  record("BOUND_1000_HARD", classifyHard(1000) === "pass_hard", results);
  record("BOUND_1001_HARD", classifyHard(1001) === "fail_hard", results);

  record("CLASSIFY_251_PERF", classifyPerformance(251) === "fail_soft", results);
  record("CLASSIFY_1001_PERF", classifyPerformance(1001) === "fail_hard", results);

  const med = trueMedian([10, 20, 30, 40, 50]);
  record("TRUE_MEDIAN_ODD_5", med.median === 30 && med.n === 5, results);

  const softFail = evaluateStressSamples([200, 240, 260, 270, 280], SOFT_LIMIT_MS, HARD_LIMIT_MS);
  record("STRESS_SOFT_MEDIAN_FAIL", softFail.pass === false && softFail.contract === "performance_soft", results);

  const hardFail = evaluateStressSamples([10, 20, 30, 40, 1001], SOFT_LIMIT_MS, HARD_LIMIT_MS);
  record("STRESS_HARD_ANY_SAMPLE", hardFail.pass === false && hardFail.contract === "performance_hard", results);

  const softPass = evaluateStressSamples([10, 20, 30, 40, 50], SOFT_LIMIT_MS, HARD_LIMIT_MS);
  record("STRESS_SOFT_MEDIAN_PASS", softPass.pass === true, results);

  record(
    "SAMPLE_COUNT_FIXED_ODD",
    STRESS_SAMPLE_COUNT === 5 && STRESS_SAMPLE_COUNT % 2 === 1,
    results
  );

  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    await waitForServer(30000);
    const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('#iuSilverHomeInputUx [data-iu-silver-home-prefix="calendar"]', {
      timeout: 30000,
    });

    /* Cold-open: Silver not open before first measured tap. */
    const before = await page.evaluate(() => String((document.getElementById("iuSilverHomeInput") || {}).value || ""));
    record("COLD_OPEN_NOT_OPEN_BEFORE", before === "", results);

    const cold = await measureSynthetic(page, 0, {});
    record(
      "COLD_OPEN_FIXTURE",
      cold.ok === true && cold.reactionMs >= 0 && cold.reactionMs <= SOFT_LIMIT_MS,
      results,
      "ms=" + cold.reactionMs
    );

    const noOpen = await measureSynthetic(page, 0, { failOpen: true });
    record("NO_OPEN_REGRESSION", noOpen.ok === false && noOpen.detail === "no_open", results);

    const wrongPrefix = await measureSynthetic(page, 0, {
      expected: "Do kalendáře ",
      appliedText: "WRONG_PREFIX ",
    });
    record(
      "WRONG_PREFIX_REGRESSION",
      wrongPrefix.ok === false && wrongPrefix.detail === "wrong_value",
      results
    );

    const wrongFn = await measureSynthetic(page, 0, {
      expected: "Do poznámek ",
      appliedText: "Do kalendáře ",
    });
    record(
      "WRONG_FUNCTION_REGRESSION",
      wrongFn.ok === false && wrongFn.detail === "wrong_value",
      results
    );

    /* One tap when second is required → functional FAIL (value never appears). */
    const second = await measureSynthetic(page, 0, {
      requireSecondTap: true,
      tapsToDispatch: 1,
    });
    record(
      "SECOND_TAP_REGRESSION",
      second.ok === false && (second.detail === "timeout" || second.detail === "second_tap_required"),
      results,
      second.detail
    );

    const missing = await measureSynthetic(page, 0, { missingMilestone: true });
    record(
      "MISSING_MILESTONE_REGRESSION",
      missing.ok === false && missing.detail === "missing_milestone",
      results
    );

    const delayed = await measureSynthetic(page, 40, { controllerDelayMs: 150 });
    record(
      "CONTROLLER_DELAY_ISOLATION",
      delayed.ok === true && delayed.reactionMs < 100,
      results,
      "ms=" + delayed.reactionMs
    );

    await context.close();
  } finally {
    await browser.close();
    try {
      server.kill("SIGTERM");
    } catch (_) {}
  }

  const failed = results.filter((r) => !r.pass);
  const out = {
    pass: failed.length === 0,
    SOFT_LIMIT_MS,
    HARD_LIMIT_MS,
    STRESS_SAMPLE_COUNT,
    results,
  };
  console.log(JSON.stringify(out, null, 2));
  if (!out.pass) {
    console.error("SILVER_FIRST_TAP_TIMING_FIXTURES_FAIL");
    process.exit(1);
  }
  console.log("SILVER_FIRST_TAP_TIMING_FIXTURES_PASS");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

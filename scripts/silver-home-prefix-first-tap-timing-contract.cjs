#!/usr/bin/env node
"use strict";

/**
 * Pure timing/contract helpers for Silver first-tap guard (test-only).
 * Soft: ms <= 250 PASS soft; ms >= 251 FAIL soft.
 * Hard: ms <= 1000 no hard failure; ms >= 1001 FAIL hard.
 */

const SOFT_LIMIT_MS = 250;
const HARD_LIMIT_MS = 1000;
const STRESS_SAMPLE_COUNT = 5;

function trueMedian(msArr) {
  const a = (msArr || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0).sort((x, y) => x - y);
  const n = a.length;
  if (!n) return { n: 0, median: null, samples: [], min: null, max: null, p90: null };
  if (n % 2 === 0) {
    throw new Error("trueMedian requires odd sample count, got " + n);
  }
  const median = a[(n - 1) >> 1];
  const p90 = a[Math.min(n - 1, Math.max(0, Math.ceil((90 / 100) * n) - 1))];
  return { n, median, samples: a.slice(), min: a[0], max: a[n - 1], p90 };
}

function classifySoft(ms, softMs) {
  const soft = softMs == null ? SOFT_LIMIT_MS : softMs;
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n <= soft ? "pass_soft" : "fail_soft";
}

function classifyHard(ms, hardMs) {
  const hard = hardMs == null ? HARD_LIMIT_MS : hardMs;
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n <= hard ? "pass_hard" : "fail_hard";
}

function classifyPerformance(ms, softMs, hardMs) {
  const soft = classifySoft(ms, softMs);
  const hard = classifyHard(ms, hardMs);
  if (soft === "invalid" || hard === "invalid") return "invalid";
  if (hard === "fail_hard") return "fail_hard";
  if (soft === "fail_soft") return "fail_soft";
  return "pass";
}

function evaluateStressSamples(samples, softMs, hardMs) {
  const soft = softMs == null ? SOFT_LIMIT_MS : softMs;
  const hard = hardMs == null ? HARD_LIMIT_MS : hardMs;
  if (!Array.isArray(samples) || samples.length !== STRESS_SAMPLE_COUNT) {
    return { pass: false, contract: "invalid_sample_count", timing: null };
  }
  for (let i = 0; i < samples.length; i++) {
    if (classifyHard(samples[i], hard) === "fail_hard") {
      return {
        pass: false,
        contract: "performance_hard",
        timing: trueMedian(samples),
        detail: "hard_sample_" + samples[i],
      };
    }
  }
  const timing = trueMedian(samples);
  if (timing.median > soft) {
    return {
      pass: false,
      contract: "performance_soft",
      timing,
      detail: "median_" + timing.median + "_gt_soft_" + soft,
    };
  }
  return { pass: true, contract: "ok", timing, detail: "ok" };
}

module.exports = {
  SOFT_LIMIT_MS,
  HARD_LIMIT_MS,
  STRESS_SAMPLE_COUNT,
  trueMedian,
  classifySoft,
  classifyHard,
  classifyPerformance,
  evaluateStressSamples,
};

#!/usr/bin/env node
/**
 * Guard: bounded /health retry helper used by deploy-chmi-cap-watchdog.yml
 * (logic mirrored here for unit test — no network).
 */
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

/**
 * @param {{ attempt: number, maxAttempts: number, baseDelayMs?: number, maxDelaySec?: number }} opts
 */
export function healthRetrySleepSec(opts) {
  const attempt = Math.max(1, Number(opts.attempt) || 1);
  const base = Math.max(1, Number(opts.baseDelayMs) || 500);
  const cap = Math.max(0.1, Number(opts.maxDelaySec) || 8);
  const sec = (base * Math.pow(2, attempt - 1)) / 1000;
  return Math.min(cap, sec);
}

/**
 * @param {{ httpCode: number, body: string, attempt: number, maxAttempts: number }} r
 */
export function healthRetryDecision(r) {
  const maxAttempts = Math.max(1, Number(r.maxAttempts) || 8);
  const attempt = Math.max(1, Number(r.attempt) || 1);
  let okBody = false;
  try {
    const j = JSON.parse(r.body || "");
    okBody = j && j.ok === true;
  } catch (_) {
    okBody = false;
  }
  if (Number(r.httpCode) === 200 && okBody) {
    return { action: "success", attempt };
  }
  if (attempt >= maxAttempts) {
    return { action: "fail", attempt, reason: "exhausted" };
  }
  return {
    action: "retry",
    attempt,
    sleepSec: healthRetrySleepSec({ attempt, maxAttempts, baseDelayMs: 500, maxDelaySec: 8 }),
  };
}

// immediate success
ok(
  "immediate_ok",
  healthRetryDecision({ httpCode: 200, body: '{"ok":true}', attempt: 1, maxAttempts: 8 }).action === "success"
);
// transient 404 then success path
ok(
  "404_retry",
  healthRetryDecision({ httpCode: 404, body: "not found", attempt: 1, maxAttempts: 8 }).action === "retry"
);
ok(
  "5xx_retry",
  healthRetryDecision({ httpCode: 503, body: "", attempt: 2, maxAttempts: 8 }).action === "retry"
);
ok(
  "bad_body_retry",
  healthRetryDecision({ httpCode: 200, body: '{"ok":false}', attempt: 1, maxAttempts: 8 }).action === "retry"
);
ok(
  "permanent_fail",
  healthRetryDecision({ httpCode: 404, body: "", attempt: 8, maxAttempts: 8 }).action === "fail"
);
ok(
  "success_last_attempt",
  healthRetryDecision({ httpCode: 200, body: '{"ok":true,"version":"1"}', attempt: 8, maxAttempts: 8 }).action ===
    "success"
);
ok("backoff_grows", healthRetrySleepSec({ attempt: 1 }) < healthRetrySleepSec({ attempt: 3 }));
ok("backoff_capped", healthRetrySleepSec({ attempt: 20 }) === 8);

// workflow file contains bounded retry (no || true)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wf = fs.readFileSync(path.join(REPO, ".github/workflows/deploy-chmi-cap-watchdog.yml"), "utf8");
ok("wf_has_MAX_ATTEMPTS", /MAX_ATTEMPTS=8/.test(wf));
ok("wf_no_or_true", !/\|\|\s*true/.test(wf));
ok("wf_exit_1_on_exhaust", /exit 1/.test(wf));
ok("wf_backoff_sleep", /health_retry sleep_s=/.test(wf));

if (fails.length) {
  console.error("IU_CHMI_DEPLOY_HEALTH_RETRY_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_DEPLOY_HEALTH_RETRY_GUARD=PASS");

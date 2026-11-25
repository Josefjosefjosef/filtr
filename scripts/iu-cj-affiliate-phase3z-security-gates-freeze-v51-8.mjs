#!/usr/bin/env node
/**
 * V51.8 — security gates freeze assert (pure, no IO).
 *
 * assertSecurityGates({ uncapped, growthRemaining, executeArmed, emailArmed, ownerTokenIssued })
 * PASS only when all activation arms are false:
 *   uncapped===false && executeArmed===false && emailArmed===false && ownerTokenIssued===false
 *
 * growthRemaining is accepted for audit context and does not affect PASS/FAIL.
 *
 * CLI selftest:
 *   node scripts/iu-cj-affiliate-phase3z-security-gates-freeze-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const SECURITY_GATES_FREEZE_SCHEMA =
  "iu-cj-affiliate-phase3z-security-gates-freeze-v51-8";

/**
 * @param {object} input
 * @param {boolean} [input.uncapped]
 * @param {*} [input.growthRemaining]
 * @param {boolean} [input.executeArmed]
 * @param {boolean} [input.emailArmed]
 * @param {boolean} [input.ownerTokenIssued]
 */
export function assertSecurityGates({
  uncapped = false,
  growthRemaining = null,
  executeArmed = false,
  emailArmed = false,
  ownerTokenIssued = false,
} = {}) {
  const fails = [];
  if (uncapped !== false) fails.push("uncapped");
  if (executeArmed !== false) fails.push("executeArmed");
  if (emailArmed !== false) fails.push("emailArmed");
  if (ownerTokenIssued !== false) fails.push("ownerTokenIssued");

  const pass = fails.length === 0;
  return {
    schema: SECURITY_GATES_FREEZE_SCHEMA,
    at: new Date().toISOString(),
    pass,
    verdict: pass ? "PASS" : "FAIL",
    growthRemaining,
    gates: {
      uncapped: uncapped === false,
      executeArmed: executeArmed === false,
      emailArmed: emailArmed === false,
      ownerTokenIssued: ownerTokenIssued === false,
    },
    fails,
    note: pass
      ? "Security gates frozen — no activation arms set."
      : "FAIL — one or more activation arms are set; freeze required.",
  };
}

/** Selftest: PASS on safe defaults; FAIL if any arm is set. */
export function runSecurityGatesFreezeSelftest() {
  const checks = [];
  function check(name, cond, detail) {
    checks.push({ name, ok: cond === true, detail: detail ?? null });
  }

  const safe = assertSecurityGates({
    uncapped: false,
    growthRemaining: 0,
    executeArmed: false,
    emailArmed: false,
    ownerTokenIssued: false,
  });
  check("safe_defaults_PASS", safe.pass === true && safe.verdict === "PASS", safe);

  const defaults = assertSecurityGates();
  check("empty_opts_PASS", defaults.pass === true && defaults.verdict === "PASS", defaults);

  const armedCases = [
    { label: "uncapped", input: { uncapped: true } },
    { label: "executeArmed", input: { executeArmed: true } },
    { label: "emailArmed", input: { emailArmed: true } },
    { label: "ownerTokenIssued", input: { ownerTokenIssued: true } },
  ];
  for (const c of armedCases) {
    const r = assertSecurityGates({
      uncapped: false,
      growthRemaining: 0,
      executeArmed: false,
      emailArmed: false,
      ownerTokenIssued: false,
      ...c.input,
    });
    check(
      `armed_${c.label}_FAIL`,
      r.pass === false && r.verdict === "FAIL" && r.fails.includes(c.label),
      r,
    );
  }

  const multi = assertSecurityGates({
    uncapped: true,
    executeArmed: true,
    emailArmed: false,
    ownerTokenIssued: true,
  });
  check(
    "multi_armed_FAIL",
    multi.pass === false &&
      multi.fails.includes("uncapped") &&
      multi.fails.includes("executeArmed") &&
      multi.fails.includes("ownerTokenIssued") &&
      !multi.fails.includes("emailArmed"),
    multi,
  );

  const growthOnly = assertSecurityGates({
    uncapped: false,
    growthRemaining: 500,
    executeArmed: false,
    emailArmed: false,
    ownerTokenIssued: false,
  });
  check(
    "growthRemaining_ignored_for_pass",
    growthOnly.pass === true && growthOnly.growthRemaining === 500,
    growthOnly,
  );

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: SECURITY_GATES_FREEZE_SCHEMA + "-selftest",
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    checks,
    sample: {
      safeVerdict: safe.verdict,
      multiFails: multi.fails,
    },
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg) === path.resolve(self);
}

if (isDirectRun()) {
  const result = runSecurityGatesFreezeSelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_SECURITY_GATES_FREEZE_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}

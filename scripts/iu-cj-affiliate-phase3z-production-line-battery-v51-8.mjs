#!/usr/bin/env node
/**
 * Accelerated production-line selftest battery (offline / isolated).
 * Does not touch production growth EXECUTE or email-only publish.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TESTS = [
  "scripts/iu-cj-affiliate-phase3z-partner-lifecycle-v51-8-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3z-email-technical-readiness-v51-8-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3z-feed-continuation-v47-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3z-feed-completeness-v51-8-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3z-uncapped-growth-readiness-v51-8-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3z-publication-lkg-v51-8-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3z-growth-approval-nonce-lifecycle-v51-8-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3z-safe-autonomous-growth-v51-8-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3z-48h-observation-ledger-v51-8-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3z-offers-freshness-v32-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3z-execute-growth-activation-ci-v51-8-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3z-growth-shadow-mode-v51-8-selftest.mjs",
];

const results = [];
for (const script of TESTS) {
  if (!fs.existsSync(script)) {
    results.push({ script, pass: false, reason: "MISSING" });
    continue;
  }
  const r = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: process.env,
  });
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  const pass = r.status === 0;
  results.push({
    script,
    pass,
    status: r.status,
    tail: out.slice(-400),
  });
  console.log(JSON.stringify({ script, pass, status: r.status }));
  if (!pass) {
    // Fail-fast per line but continue battery for independent coverage
  }
}

const summary = {
  schema: "iu-cj-affiliate-phase3z-production-line-battery-v51-8",
  at: new Date().toISOString(),
  passCount: results.filter((x) => x.pass).length,
  failCount: results.filter((x) => !x.pass).length,
  results,
  ownerGatesPreserved: {
    growthExecute: false,
    emailOnlyPublishing: "DISARMED",
    uncapped: false,
  },
};
const outPath = path.join(
  process.env.TEMP || "/tmp",
  "iu-cj-production-line-battery.json",
);
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(
  JSON.stringify({
    IU_CJ_PRODUCTION_LINE_BATTERY: summary.failCount === 0 ? "PASS" : "FAIL",
    outPath,
    passCount: summary.passCount,
    failCount: summary.failCount,
  }),
);
process.exit(summary.failCount === 0 ? 0 : 2);

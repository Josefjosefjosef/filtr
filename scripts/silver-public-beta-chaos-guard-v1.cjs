#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-beta-ux-hardening-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_PUBLIC_BETA_CHAOS_CASES || "1600", 10);
const REPORT = path.join(__dirname, "silver-public-beta-chaos-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_PUBLIC_BETA_CHAOS_MIN_PCT || "99", 10);

function main() {
  const cases = shared.buildCorpusV1(TARGET);
  const res = shared.runAudit("silver_public_beta_chaos_v1", cases, REPORT, {
    public_beta_chaos_cases: cases.length,
    new_audit_families: shared.AUDIT_FAMILIES.length
  });
  const ok = shared.printHeader("silver_public_beta_chaos_v1", res.report, MIN_PCT);
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();

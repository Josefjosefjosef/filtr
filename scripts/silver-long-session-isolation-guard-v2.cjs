#!/usr/bin/env node
"use strict";
const path = require("path");
const pbux = require("./silver-public-beta-ux-hardening-v1-shared.cjs");
const cap = require("./silver-conversational-orchestration-cap-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-long-session-isolation-guard-v2-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_LONG_SESSION_ISOLATION_V2_MIN_PCT || "98", 10);
function main() {
  const capCases = cap.filterFamily(cap.buildCapCorpusV1(80), ["stale_context_reset", "followup_ownership"]);
  const pb = pbux.buildCorpusV1(400);
  const pbCases = pb.filter((c) => c.mode === "long_session" || (c.family && c.family.indexOf("long_session") >= 0));
  const merged = capCases.concat(pbCases).slice(0, Math.max(160, capCases.length + pbCases.length));
  const res = pbux.runAudit("silver_long_session_isolation_v2", merged, REPORT, {
    long_session_v2_cases: merged.length
  });
  const ok = pbux.printHeader("silver_long_session_isolation_v2", res.report, MIN_PCT);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();

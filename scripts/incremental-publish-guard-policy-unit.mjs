/**
 * Policy unit tests: incremental publish guard vs media aggregation cutover state.
 * Run: node scripts/incremental-publish-guard-policy-unit.mjs
 */
import { evaluateIncrementalPublishGuard } from "./incremental-publish-guard.mjs";

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed += 1;
  }
}

const staleGen = "2026-07-29T07:41:45.361Z";
const freshGen = new Date().toISOString();
const nowMs = Date.parse("2026-10-04T12:00:00.000Z");

// A: aggregation disabled — stale empty bundle must not fail freshness
{
  const r = evaluateIncrementalPublishGuard({
    aggregationEnabled: false,
    articlesDoc: { generatedAt: staleGen, articles: [] },
    nowMs,
  });
  assert(r.ok && r.skipped, "caseA ok+skipped");
  assert(r.mediaArticleFreshnessCheck === "NOT_APPLICABLE", "caseA N/A");
  console.log("PASS caseA_disabled_stale_empty");
}

// B: aggregation enabled — empty + stale must fail
{
  const r = evaluateIncrementalPublishGuard({
    aggregationEnabled: true,
    articlesDoc: { generatedAt: staleGen, articles: [] },
    nowMs,
    maxGeneratedAgeH: 72,
  });
  assert(!r.ok && !r.skipped, "caseB fail");
  assert(r.failures.some((f) => f.includes("older than")), "caseB stale");
  assert(r.failures.some((f) => f.includes("empty")), "caseB empty");
  console.log("PASS caseB_enabled_stale_empty");
}

// C: aggregation enabled — fresh non-empty must pass
{
  const r = evaluateIncrementalPublishGuard({
    aggregationEnabled: true,
    articlesDoc: {
      generatedAt: freshGen,
      articles: [{ section: "aktualne", publishedAt: freshGen }],
    },
    nowMs: Date.now(),
    maxGeneratedAgeH: 72,
  });
  assert(r.ok && !r.skipped, "caseC pass");
  console.log("PASS caseC_enabled_fresh_nonempty");
}

if (failed) {
  console.error(`incremental-publish-guard-policy-unit RESULT=FAIL count=${failed}`);
  process.exit(1);
}
console.log("incremental-publish-guard-policy-unit RESULT=PASS");
process.exit(0);

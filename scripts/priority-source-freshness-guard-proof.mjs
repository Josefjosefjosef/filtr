/**
 * Proof: priority-source-freshness-guard dual source-of-truth (articles + pool).
 * Run: node scripts/priority-source-freshness-guard-proof.mjs
 */
import {
  evaluatePriorityFreshness,
  mergePriorityNewestTs,
  newestInSection,
} from "./priority-source-freshness-guard.mjs";

const now = Date.parse("2026-06-13T19:00:00.000Z");

function article(section, publishedAt, title = "t") {
  return { section, publishedAt, title, url: `https://example.com/${section}/${publishedAt}` };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testMergeUsesFresherPoolSport() {
  const articles = [
    article("aktualne", "2026-06-13T18:30:00Z"),
    article("sport", "2026-06-12T22:39:52Z", "stale sport.cz"),
  ];
  const pool = [
    article("aktualne", "2026-06-13T18:55:00Z"),
    article("sport", "2026-06-13T18:57:42Z", "fresh ct sport"),
  ];
  const result = evaluatePriorityFreshness({
    articles,
    poolArticles: pool,
    nowMs: now,
    maxPriorityAgeH: 12,
  });
  const sport = result.sectionLog.find((row) => row.section === "sport");
  assert(sport, "missing sport row");
  assert(sport.source === "publishable_pool.json", `expected pool source got ${sport.source}`);
  assert(sport.ageH < 1, `expected fresh pool sport age_h < 1 got ${sport.ageH}`);
  assert(result.ok, `expected PASS got failures=${result.failures.join(";")}`);
}

function testFailWhenBothStale() {
  const articles = [
    article("aktualne", "2026-06-12T09:00:00Z"),
    article("sport", "2026-06-12T10:00:00Z"),
  ];
  const pool = [
    article("aktualne", "2026-06-12T08:00:00Z"),
    article("sport", "2026-06-12T11:00:00Z"),
  ];
  const result = evaluatePriorityFreshness({
    articles,
    poolArticles: pool,
    nowMs: now,
    maxPriorityAgeH: 12,
  });
  assert(!result.ok, "expected FAIL when both sources stale");
  assert(result.failures.some((f) => f.includes("sport")), "expected sport failure");
}

function testArticlesOnlyFallback() {
  const articles = [
    article("aktualne", "2026-06-13T18:30:00Z"),
    article("sport", "2026-06-13T18:00:00Z"),
  ];
  const result = evaluatePriorityFreshness({
    articles,
    poolArticles: [],
    nowMs: now,
    maxPriorityAgeH: 12,
  });
  assert(result.ok, "expected PASS with articles only");
}

function testMergePriorityNewestTs() {
  const a = Date.parse("2026-06-12T10:00:00Z");
  const p = Date.parse("2026-06-13T10:00:00Z");
  assert(mergePriorityNewestTs(a, p).source === "publishable_pool.json");
  assert(mergePriorityNewestTs(a, null).source === "articles.json");
  assert(mergePriorityNewestTs(null, p).source === "publishable_pool.json");
}

function testNewestInSection() {
  const arts = [
    article("sport", "2026-06-12T10:00:00Z"),
    article("sport", "2026-06-13T12:00:00Z"),
  ];
  assert(newestInSection(arts, "sport") === Date.parse("2026-06-13T12:00:00Z"));
}

function main() {
  const tests = [
    ["mergePriorityNewestTs", testMergePriorityNewestTs],
    ["newestInSection", testNewestInSection],
    ["articlesOnlyFallback", testArticlesOnlyFallback],
    ["mergeUsesFresherPoolSport", testMergeUsesFresherPoolSport],
    ["failWhenBothStale", testFailWhenBothStale],
  ];
  for (const [name, fn] of tests) {
    fn();
    console.log(`PASS ${name}`);
  }
  console.log("PRIORITY_SOURCE_FRESHNESS_GUARD_PROOF=PASS");
  console.log("SPORT_FRESHNESS_PASS=YES");
  console.log("DUAL_SOURCE_OF_TRUTH=YES");
}

try {
  main();
} catch (err) {
  console.error(`PRIORITY_SOURCE_FRESHNESS_GUARD_PROOF=FAIL ${err.message}`);
  process.exit(1);
}

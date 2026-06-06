/**
 * Policy unit tests for content freshness guard (PASS_WITH_WARN when pipeline alive).
 * Run: node scripts/content-freshness-guard-policy-unit.mjs
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  P0_CONTENT_SOURCES,
  evaluateContentFreshnessPolicy,
} from "./content-freshness-guard-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = __dirname;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function isoMinutesAgo(min) {
  return new Date(Date.now() - min * 60_000).toISOString();
}

function row(sourceId, gapMinutes, opts = {}) {
  const def = P0_CONTENT_SOURCES.find((d) => d.id === sourceId);
  const prodTs = Date.now() - (gapMinutes === Infinity ? 0 : (gapMinutes + 30) * 60_000);
  return {
    source: def?.label || sourceId,
    sourceId,
    fetchError: opts.fetchError || null,
    gapMinutes,
    productionLatest: opts.noProduction
      ? null
      : { ts: prodTs, iso: new Date(prodTs).toISOString(), title: "t", url: "https://example.com/a" },
    rssLatest: { ts: Date.now(), iso: new Date().toISOString(), title: "rss", url: "https://example.com/rss" },
  };
}

function baseReport(overrides = {}) {
  const now = Date.now();
  return {
    generatedAt: new Date(now - 30 * 60_000).toISOString(),
    generatedAtTs: now - 30 * 60_000,
    contentNewerThanGenerated: 19,
    articleCount: 120,
    rows: [
      row("ct24", 260),
      row("idnes", 220),
      row("sportcz", 215),
      row("novinky", 65),
      row("seznam", 15),
    ],
    ...overrides,
  };
}

// CI-like failure: large gaps but pipeline alive → PASS_WITH_WARN
{
  const v = evaluateContentFreshnessPolicy(baseReport(), { warnMin: 60, failMin: 120 });
  assert(v.result === "PASS_WITH_WARN", `CI-like gaps expected PASS_WITH_WARN got ${v.result}`);
  assert(!v.failed, "CI-like gaps must not hard fail");
  assert(v.pipelineAlive, "pipeline_alive");
  console.log("PASS test_content_freshness_ct24_gap_fixed_or_warned");
  console.log("PASS test_content_freshness_idnes_gap_fixed_or_warned");
  console.log("PASS test_content_freshness_sportcz_gap_fixed_or_warned");
  console.log("PASS test_content_freshness_does_not_block_when_pipeline_alive");
}

// Hard fail: empty bundle
{
  const v = evaluateContentFreshnessPolicy(
    { generatedAt: isoMinutesAgo(5), generatedAtTs: Date.now() - 5 * 60_000, contentNewerThanGenerated: 0, articleCount: 0, rows: [] },
    { warnMin: 60, failMin: 120 },
  );
  assert(v.failed && v.result === "FAIL", "empty articles must FAIL");
  assert(v.hardFailReasons.some((r) => r.includes("articles_empty")), "articles_empty reason");
  console.log("PASS test_content_freshness_hard_fail_dead_data");
  console.log("PASS test_articles_json_not_empty");
}

// Hard fail: generatedAt moved without real content
{
  const v = evaluateContentFreshnessPolicy(
    {
      generatedAt: isoMinutesAgo(10),
      generatedAtTs: Date.now() - 10 * 60_000,
      contentNewerThanGenerated: 0,
      articleCount: 50,
      rows: [row("seznam", 15), row("novinky", 20)],
    },
    { warnMin: 60, failMin: 120 },
  );
  assert(v.failed, "generatedAt without content must FAIL");
  assert(v.hardFailReasons.some((r) => r.includes("generatedAt_without_content")), "generatedAt_without_content");
  console.log("PASS test_generatedAt_not_moved_without_real_content");
}

// Hard fail: all sources stale, pipeline not alive
{
  const v = evaluateContentFreshnessPolicy(
    {
      generatedAt: isoMinutesAgo(200),
      generatedAtTs: Date.now() - 200 * 60_000,
      contentNewerThanGenerated: 0,
      articleCount: 80,
      rows: [row("ct24", 260), row("idnes", 220), row("sportcz", 215), row("novinky", 180), row("seznam", 150)],
    },
    { warnMin: 60, failMin: 120 },
  );
  assert(v.failed, "all stale without pipeline content must FAIL");
  console.log("PASS test_active_trace_still_required (policy leaves trace guard unchanged)");
}

function runNodeTest(relPath, label) {
  const r = spawnSync(process.execPath, [path.join(scriptsDir, relPath)], {
    cwd: path.join(scriptsDir, ".."),
    encoding: "utf8",
  });
  assert(r.status === 0, `${label}: ${r.stderr || r.stdout}`);
  console.log(`PASS ${label}`);
}

runNodeTest("content-freshness-guard-unit.mjs", "content-freshness-guard-unit");
runNodeTest("topic-dedupe-false-positive-guard.mjs", "test_vzdelavani_precision_still_pass");

// SECTION_TOPIC_CAP + recency checks via python tests
function runPyTest(moduleName, testName) {
  const py = process.platform === "win32" ? "py" : "python";
  const r = spawnSync(py, ["-m", "unittest", `${moduleName}.${testName}`], {
    cwd: path.join(scriptsDir, ".."),
    encoding: "utf8",
  });
  assert(r.status === 0, `${testName}: ${r.stderr || r.stdout}`);
  console.log(`PASS ${testName}`);
}

runPyTest("scripts.test_iu_section_topic_cap", "SectionTopicCapTests.test_section_topic_cap_25_percent");
runPyTest("scripts.test_iu_section_topic_cap", "SectionTopicCapTests.test_no_recency_decay_present");
runPyTest("scripts.test_iu_section_topic_cap", "SectionTopicCapTests.test_no_age_based_ranking_present");

console.log("PASS content-freshness-guard-policy-unit");

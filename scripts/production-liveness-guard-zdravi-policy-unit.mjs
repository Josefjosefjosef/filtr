/**
 * Zdraví liveness policy unit tests (isolated vertical WARN when pipeline alive).
 * Run: node scripts/production-liveness-guard-zdravi-policy-unit.mjs
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_MIN_2H,
  evaluateProductionLiveness,
  isPipelineLivenessAlive,
} from "./production-liveness-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const CI_NOW = Date.parse("2026-06-06T21:22:01.000Z");
const CI_GENERATED_AT = Date.parse("2026-06-06T21:05:03.295Z");

function art(section, publishedAt, extra = {}) {
  return { section, topic: section, publishedAt, ...extra };
}

/** CI-like bundle from run 27073563888 (Zdraví stale, pipeline alive). */
function ciLikeArticles() {
  return [
    ...Array.from({ length: 8 }, (_, i) =>
      art("aktualne", new Date(CI_NOW - (30 + i * 10) * 60_000).toISOString()),
    ),
    ...Array.from({ length: 2 }, (_, i) =>
      art("sport", new Date(CI_NOW - (60 + i * 20) * 60_000).toISOString()),
    ),
    art("finance", new Date(CI_NOW - 145 * 60_000).toISOString()),
    ...Array.from({ length: 10 }, (_, i) =>
      art("cestovani", new Date(CI_NOW - (10 + i) * 60_000).toISOString()),
    ),
    art("zdravi", "2026-06-06T12:40:59.000Z"),
    ...Array.from({ length: 17 }, (_, i) =>
      art("aktualne", new Date(CI_GENERATED_AT + (i + 1) * 60_000).toISOString()),
    ),
  ];
}

{
  const articles = ciLikeArticles();
  const r = evaluateProductionLiveness(articles, {
    nowMs: CI_NOW,
    generatedAt: "2026-06-06T21:05:03.295367Z",
    generatedAtTs: CI_GENERATED_AT,
  });
  assert(r.report.sections.zdravi.counts.last_4h === 0, "ZDRAVI_ARTICLES_LAST_4H=0");
  assert(r.report.sections.zdravi.newestAgeMin > 480, "ZDRAVI_NEWEST_AGE_MINUTES>480");
  assert(r.result === "PASS_WITH_WARN", "CI-like bundle must not block release");
  assert(r.report.pipeline_alive_soft_fail_sections?.includes("zdravi"), "zdravi soft fail");
  assert(isPipelineLivenessAlive(r.report, { articles, generatedAtTs: CI_GENERATED_AT, nowMs: CI_NOW }), "pipeline alive");
  console.log("PASS test_zdravi_liveness_ingest_trace");
  console.log("PASS test_zdravi_liveness_policy_pass_with_warn_when_pipeline_alive");
  console.log("PASS test_zdravi_liveness_does_not_block_release_when_only_zdravi_stale");
}

{
  const CI_NOW2 = Date.parse("2026-06-06T23:17:31.000Z");
  const CI_GEN2 = Date.parse("2026-06-06T23:01:38.180Z");
  const articles = [
    ...Array.from({ length: 6 }, (_, i) =>
      art("aktualne", new Date(CI_NOW2 - (40 + i * 10) * 60_000).toISOString()),
    ),
    art("sport", new Date(CI_NOW2 - 130 * 60_000).toISOString()),
    art("sport", new Date(CI_NOW2 - 150 * 60_000).toISOString()),
    art("finance", new Date(CI_NOW2 - 77 * 60_000).toISOString()),
    art("finance", new Date(CI_NOW2 - 100 * 60_000).toISOString()),
    ...Array.from({ length: 10 }, (_, i) =>
      art("cestovani", new Date(CI_NOW2 - (10 + i) * 60_000).toISOString()),
    ),
    art("zdravi", "2026-06-06T12:40:59.000Z"),
    ...Array.from({ length: 17 }, (_, i) =>
      art("aktualne", new Date(CI_GEN2 + (i + 1) * 60_000).toISOString()),
    ),
  ];
  const r = evaluateProductionLiveness(articles, {
    nowMs: CI_NOW2,
    generatedAt: "2026-06-06T23:01:38.180773Z",
    generatedAtTs: CI_GEN2,
  });
  assert(r.report.sections.sport.counts.last_2h === 0, "sport 2h=0");
  assert(r.report.sections.sport.counts.last_4h === 2, "sport 4h=2");
  assert(r.report.sections.zdravi.counts.last_4h === 0, "zdravi 4h=0");
  assert(r.result === "PASS_WITH_WARN", "sport+zdravi stale must not block release");
  assert(r.report.pipeline_alive_soft_fail_sections?.includes("sport"), "sport softened");
  assert(r.report.pipeline_alive_soft_fail_sections?.includes("zdravi"), "zdravi softened");
  console.log("PASS test_sport_zdravi_combined_pipeline_alive_warn");
}

{
  const r = evaluateProductionLiveness([], { nowMs: CI_NOW });
  assert(r.failed && r.result === "FAIL", "empty articles hard fail");
  console.log("PASS test_zdravi_liveness_hard_fail_when_articles_empty");
}

{
  const articles = [art("aktualne", new Date(CI_NOW - 5 * 60_000).toISOString())];
  const r = evaluateProductionLiveness(articles, {
    nowMs: CI_NOW,
    generatedAt: new Date(CI_NOW - 10 * 60_000).toISOString(),
    generatedAtTs: CI_NOW - 10 * 60_000,
  });
  assert(r.failed, "generatedAt without newer content must fail");
  console.log("PASS test_zdravi_liveness_hard_fail_when_generatedAt_moves_without_content");
}

{
  const stale = (h) => new Date(CI_NOW - h * 3600_000).toISOString();
  const articles = [
    art("aktualne", stale(12)),
    art("sport", stale(12)),
    art("finance", stale(12)),
    art("zdravi", stale(12)),
    art("cestovani", stale(12)),
  ];
  const r = evaluateProductionLiveness(articles, { nowMs: CI_NOW });
  assert(r.failed && r.result === "FAIL", "dead site must hard fail");
  console.log("PASS test_zdravi_liveness_hard_fail_when_site_dead");
}

function runNode(rel) {
  const r = spawnSync(process.execPath, [path.join(__dirname, rel)], { cwd: root, encoding: "utf8" });
  assert(r.status === 0, `${rel}: ${r.stderr || r.stdout}`);
}

function runPy(module, test) {
  const py = process.platform === "win32" ? "py" : "python";
  const r = spawnSync(py, ["-m", "unittest", `${module}.${test}`], { cwd: root, encoding: "utf8" });
  assert(r.status === 0, `${test}: ${r.stderr || r.stdout}`);
}

runNode("content-freshness-guard-policy-unit.mjs");
runNode("production-liveness-guard-unit.mjs");
runNode("topic-dedupe-false-positive-guard.mjs");
runPy("scripts.test_iu_section_topic_cap", "SectionTopicCapTests.test_section_topic_cap_25_percent");
runPy("scripts.test_iu_section_topic_cap", "SectionTopicCapTests.test_no_recency_decay_present");
runPy("scripts.test_iu_section_topic_cap", "SectionTopicCapTests.test_no_age_based_ranking_present");

console.log("PASS test_content_freshness_still_passes_or_warns");
console.log("PASS test_section_topic_cap_still_enabled");
console.log("PASS test_vzdelavani_precision_still_pass");
console.log("PASS test_no_recency_decay_present");
console.log("PASS test_no_age_based_ranking_present");
console.log("PASS production-liveness-guard-zdravi-policy-unit");

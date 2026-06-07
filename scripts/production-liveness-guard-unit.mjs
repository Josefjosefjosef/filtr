/**
 * Unit tests: Finance / Zdraví 4h blocking / 2h warning production-liveness contract.
 * Run: node scripts/production-liveness-guard-unit.mjs
 */
import {
  DEFAULT_MIN_2H,
  evaluatePrioritySectionLiveness,
  evaluateProductionLiveness,
} from "./production-liveness-guard.mjs";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const NOW = Date.parse("2026-06-05T19:48:48.000Z");

function art(section, publishedAt) {
  return { section, topic: section, publishedAt };
}

/** Fresh articles for priority sections; override per-section publishedAt via except. */
function freshPriority(except = {}) {
  const fresh = "2026-06-05T19:00:00.000Z";
  return ["aktualne", "sport", "finance", "zdravi", "cestovani"].map((section) =>
    art(section, except[section] ?? fresh),
  );
}

// Scenario 1 — Finance 2h=0, 4h=1 → PASS_WITH_WARN
{
  const articles = freshPriority({ finance: "2026-06-05T17:30:00.000Z" });
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "PASS_WITH_WARN", "finance_4h_contract_test: expected PASS_WITH_WARN");
  assert(r.report.sections.finance.counts.last_2h === 0, "finance 2h=0");
  assert(r.report.sections.finance.counts.last_4h === 1, "finance 4h=1");
  console.log("finance_4h_contract_test: PASS");
}

// Scenario 2 — Finance 2h=0, 4h=0 → FAIL
{
  const articles = freshPriority({ finance: "2026-06-05T10:00:00.000Z" });
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "FAIL", "finance_zero_4h_fail_test: expected FAIL");
  assert(r.failed, "finance_zero_4h_fail_test: failed flag");
  console.log("finance_zero_4h_fail_test: PASS");
}

// Scenario 3 — Finance 2h=1 → PASS
{
  const articles = freshPriority({ finance: "2026-06-05T19:30:00.000Z" });
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "PASS", "finance_2h_pass_test: expected PASS");
  assert(r.report.sections.finance.counts.last_2h === 1, "finance 2h=1");
  console.log("finance_2h_pass_test: PASS");
}

// Scenario 4 — Zdraví rules unchanged
{
  const zdraviWarn = evaluatePrioritySectionLiveness("zdravi", { last_2h: 0, last_4h: 1 }, DEFAULT_MIN_2H);
  assert(zdraviWarn.ok && zdraviWarn.warn, "zdravi_regression_test: 2h warn / 4h pass");
  const articles = freshPriority({ zdravi: "2026-06-05T16:10:27.000Z" });
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "PASS_WITH_WARN", "zdravi_regression_test: expected PASS_WITH_WARN");
  console.log("zdravi_regression_test: PASS");
}

// Scenario 5 — P0 headline sections (Zprávy / Sport) still 2h blocking
{
  const sportFail = evaluatePrioritySectionLiveness("sport", { last_2h: 0, last_4h: 2 }, DEFAULT_MIN_2H);
  const zpravyFail = evaluatePrioritySectionLiveness("aktualne", { last_2h: 0, last_4h: 3 }, DEFAULT_MIN_2H);
  assert(!sportFail.ok, "headline_regression_test: sport 2h blocking");
  assert(!zpravyFail.ok, "headline_regression_test: zpravy 2h blocking");
  const articles = freshPriority({
    finance: "2026-06-05T19:30:00.000Z",
    zdravi: "2026-06-05T19:00:00.000Z",
  });
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "PASS", "headline_regression_test: fresh sport+zpravy PASS");
  console.log("headline_regression_test: PASS");
}

// Scenario 6 — Zdraví 4h=0 but newest within soft window → PASS_WITH_WARN (release not blocked)
{
  const articles = freshPriority({ zdravi: "2026-06-05T13:00:00.000Z" });
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "PASS_WITH_WARN", "zdravi_soft_newest_test: expected PASS_WITH_WARN");
  assert(r.report.sections.zdravi.counts.last_4h === 0, "zdravi 4h=0");
  assert(r.report.sections.zdravi.newestAgeMin <= 8 * 60, "zdravi newest within 8h");
  console.log("zdravi_soft_newest_test: PASS");
}

// Scenario 7 — Zdraví 4h=0 and newest stale alone → PASS_WITH_WARN when pipeline alive
{
  const articles = freshPriority({ zdravi: "2026-06-05T08:00:00.000Z" });
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "PASS_WITH_WARN", "zdravi_isolated_stale_pipeline_alive: expected PASS_WITH_WARN");
  assert(r.report.pipeline_alive_soft_fail_sections?.includes("zdravi"), "zdravi soft fail flag");
  console.log("zdravi_isolated_stale_pipeline_alive: PASS");
}

// Scenario 7b — site dead when headline sections stale too
{
  const articles = freshPriority({
    aktualne: "2026-06-05T08:00:00.000Z",
    sport: "2026-06-05T08:00:00.000Z",
    finance: "2026-06-05T08:00:00.000Z",
    zdravi: "2026-06-05T08:00:00.000Z",
    cestovani: "2026-06-05T08:00:00.000Z",
  });
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "FAIL", "zdravi_stale_newest_fail_test: expected FAIL when site dead");
  console.log("zdravi_stale_newest_fail_test: PASS");
}

// Scenario 8 — single flex section soft fail does not block whole release
{
  const articles = freshPriority({
    zdravi: "2026-06-05T16:10:27.000Z",
    finance: "2026-06-05T19:30:00.000Z",
  });
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "PASS_WITH_WARN", "single_section_warn_test: expected PASS_WITH_WARN");
  console.log("single_section_warn_test: PASS");
}

// Scenario 9 — batch mode: priority sections empty this tick but new content published → WARN not FAIL
{
  const genTs = Date.parse("2026-06-07T10:00:00.000Z");
  const articles = [
    art("aktualne", "2026-06-07T06:00:00.000Z", { iuReleaseAt: "2026-06-07T10:05:00.000Z" }),
    art("finance", "2026-06-07T10:04:00.000Z", { iuReleaseAt: "2026-06-07T10:04:00.000Z" }),
    art("cestovani", "2026-06-07T10:03:00.000Z"),
  ];
  const r = evaluateProductionLiveness(articles, {
    nowMs: Date.parse("2026-06-07T10:10:00.000Z"),
    generatedAt: "2026-06-07T10:00:00.000Z",
    generatedAtTs: genTs,
    batchMode: true,
  });
  assert(r.result === "PASS_WITH_WARN", "batch_publish_soft_fail: expected PASS_WITH_WARN");
  assert(r.report.content_newer_than_generated >= 1, "batch_publish_soft_fail: content newer");
  console.log("batch_publish_soft_fail_test: PASS");
}

// Scenario 10 — batch mode: site dead (no recent hub content, no new publish) → FAIL
{
  const articles = freshPriority({
    aktualne: "2026-06-05T08:00:00.000Z",
    sport: "2026-06-05T08:00:00.000Z",
    finance: "2026-06-05T08:00:00.000Z",
    zdravi: "2026-06-05T08:00:00.000Z",
    cestovani: "2026-06-05T08:00:00.000Z",
  });
  const r = evaluateProductionLiveness(articles, {
    nowMs: NOW,
    batchMode: true,
  });
  assert(r.result === "FAIL", "batch_site_dead_test: expected FAIL");
  console.log("batch_site_dead_test: PASS");
}

// Scenario 11 — batch mode: Zprávy/Sport 2h miss with pipeline alive → PASS_WITH_WARN
{
  const articles = freshPriority({
    aktualne: "2026-06-05T16:00:00.000Z",
    sport: "2026-06-05T16:30:00.000Z",
    finance: "2026-06-05T19:30:00.000Z",
    zdravi: "2026-06-05T19:00:00.000Z",
  });
  const r = evaluateProductionLiveness(articles, { nowMs: NOW, batchMode: true });
  assert(r.result === "PASS_WITH_WARN", "batch_headline_soft_test: expected PASS_WITH_WARN");
  console.log("batch_headline_soft_test: PASS");
}

console.log("PASS production-liveness-guard-unit");

/**
 * Unit tests: Zdraví 4h blocking / 2h warning production-liveness contract.
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

/** Fresh articles for non-zdravi priority sections so zdravi contract tests isolate zdravi. */
function freshOtherPriority(except = {}) {
  const fresh = "2026-06-05T19:00:00.000Z";
  return ["aktualne", "sport", "finance", "cestovani"].map((section) =>
    art(section, except[section] ?? fresh),
  );
}

// Scenario 1 — Zdraví 2h=0, 4h=1 → PASS_WITH_WARN
{
  const articles = [...freshOtherPriority(), art("zdravi", "2026-06-05T16:10:27.000Z")];
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "PASS_WITH_WARN", "zdravi_4h_contract_test: expected PASS_WITH_WARN");
  assert(r.report.sections.zdravi.counts.last_2h === 0, "zdravi 2h=0");
  assert(r.report.sections.zdravi.counts.last_4h === 1, "zdravi 4h=1");
  console.log("zdravi_4h_contract_test: PASS");
}

// Scenario 2 — Zdraví 2h=0, 4h=0 → FAIL
{
  const articles = [...freshOtherPriority(), art("zdravi", "2026-06-05T10:00:00.000Z")];
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "FAIL", "zdravi_zero_4h_fail_test: expected FAIL");
  assert(r.failed, "zdravi_zero_4h_fail_test: failed flag");
  console.log("zdravi_zero_4h_fail_test: PASS");
}

// Scenario 3 — Zdraví 2h=1 → PASS
{
  const articles = [...freshOtherPriority(), art("zdravi", "2026-06-05T19:00:00.000Z")];
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "PASS", "zdravi_2h_pass_test: expected PASS");
  assert(r.report.sections.zdravi.counts.last_2h === 1, "zdravi 2h=1");
  console.log("zdravi_2h_pass_test: PASS");
}

// Scenario 4 — Finance 2h=0 still FAIL (even with 4h content)
{
  const articles = [
    ...freshOtherPriority({ finance: "2026-06-05T16:00:00.000Z" }),
    art("zdravi", "2026-06-05T19:00:00.000Z"),
  ];
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "FAIL", "finance_regression_test: finance 2h=0 must FAIL");
  const finance = evaluatePrioritySectionLiveness("finance", { last_2h: 0, last_4h: 1 }, DEFAULT_MIN_2H);
  assert(!finance.ok, "finance_regression_test: 2h blocking unchanged");
  console.log("finance_regression_test: PASS");
}

// Scenario 5 — Sport / Zprávy rules unchanged
{
  const sportFail = evaluatePrioritySectionLiveness("sport", { last_2h: 0, last_4h: 2 }, DEFAULT_MIN_2H);
  const zpravyFail = evaluatePrioritySectionLiveness("aktualne", { last_2h: 0, last_4h: 3 }, DEFAULT_MIN_2H);
  assert(!sportFail.ok, "sport_zpravy_regression_test: sport 2h blocking");
  assert(!zpravyFail.ok, "sport_zpravy_regression_test: zpravy 2h blocking");
  const articles = [
    ...freshOtherPriority(),
    art("zdravi", "2026-06-05T19:00:00.000Z"),
    art("sport", "2026-06-05T19:30:00.000Z"),
    art("aktualne", "2026-06-05T19:20:00.000Z"),
  ];
  const r = evaluateProductionLiveness(articles, { nowMs: NOW });
  assert(r.result === "PASS", "sport_zpravy_regression_test: fresh sport+zpravy PASS");
  console.log("sport_zpravy_regression_test: PASS");
}

console.log("PASS production-liveness-guard-unit");

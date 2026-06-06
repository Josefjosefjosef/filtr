/**
 * Unit tests: dedupe-loss guard today-scoped metric alignment.
 * Run: node scripts/dedupe-loss-guard-unit.mjs
 */
import {
  VERTICALS,
  evaluateDedupeLossGuard,
  isVerticalRubricMirror,
} from "./dedupe-loss-guard.mjs";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const TODAY = "2026-06-05";

function art(feedId, section, publishedAt, url = "https://example.com/a") {
  return {
    feedId,
    topic: section,
    section,
    publishedAt,
    url,
  };
}

function telemetryRow(sourceId, topic, extra = {}) {
  return {
    source_id: sourceId,
    topic,
    feed_url: extra.feed_url || `https://example.com/${sourceId}`,
    entry_type: extra.entry_type || "native",
    written_to_articles_json_count: extra.written_to_articles_json_count || 0,
    today_written_to_articles_json_count: extra.today_written_to_articles_json_count || 0,
    sample_titles: extra.sample_titles || [],
  };
}

// Scenario 1 — historical ingest, today=0 → PASS
{
  const articles = [
    art("ces_svetcestovatele", "cestovani", "2026-05-20T10:00:00.000Z"),
    art("hry_zing", "hry", "2026-05-18T08:00:00.000Z"),
  ];
  const telemetryRows = [
    telemetryRow("ces_svetcestovatele", "cestovani", { written_to_articles_json_count: 9 }),
    telemetryRow("hry_zing", "hry", { written_to_articles_json_count: 27 }),
  ];
  const r = evaluateDedupeLossGuard({ today: TODAY, articles, telemetryRows });
  assert(!r.failed, "guard_false_positive_test: historical ingest with json_today=0 must PASS");
  assert(r.todayWritten.cestovani === 0 && r.todayWritten.hry === 0, "today_vs_today_test: no today ingest");
  assert(r.jsonToday.cestovani === 0 && r.jsonToday.hry === 0, "today_vs_today_test: json_today=0");
  console.log("guard_false_positive_test: PASS");
  console.log("today_vs_today_test: PASS (scenario 1)");
}

// Scenario 2 — today ingest + json_today exist → PASS
{
  const articles = [
    art("ces_svetcestovatele", "cestovani", `${TODAY}T08:00:00.000Z`),
    art("hry_zing", "hry", `${TODAY}T09:00:00.000Z`),
  ];
  const telemetryRows = [
    telemetryRow("ces_svetcestovatele", "cestovani", { today_written_to_articles_json_count: 1 }),
    telemetryRow("hry_zing", "hry", { today_written_to_articles_json_count: 1 }),
  ];
  const r = evaluateDedupeLossGuard({ today: TODAY, articles, telemetryRows });
  assert(!r.failed, "today ingest + json_today must PASS");
  assert(r.jsonToday.cestovani === 1 && r.jsonToday.hry === 1, "json_today counts");
  console.log("today_vs_today_test: PASS (scenario 2)");
}

// Scenario 3 — today ingest exists, articles absent from json → FAIL
{
  const articles = [
    art("zpr_novinky_domaci", "aktualne", `${TODAY}T10:00:00.000Z`),
  ];
  const telemetryRows = [
    telemetryRow("hry_zing", "hry", { today_written_to_articles_json_count: 1 }),
    telemetryRow("hry_vortex", "hry", { today_written_to_articles_json_count: 1 }),
    telemetryRow("hry_sector", "hry", { today_written_to_articles_json_count: 1 }),
  ];
  const r = evaluateDedupeLossGuard({ today: TODAY, articles, telemetryRows });
  assert(r.failed, "real_wipeout_test: today_written>=3 with json_today=0 must FAIL");
  assert(r.failures.includes("hry"), "real_wipeout_test: hry section must fail");
  console.log("real_wipeout_test: PASS");
}

// Scenario 3b — syndicated section reassignment (feedId preserved) → PASS
{
  const articles = [
    art("hry_zing", "aktualne", `${TODAY}T10:00:00.000Z`),
    art("hry_vortex", "aktualne", `${TODAY}T11:00:00.000Z`),
    art("hry_sector", "aktualne", `${TODAY}T12:00:00.000Z`),
  ];
  const telemetryRows = [
    telemetryRow("hry_zing", "hry", { today_written_to_articles_json_count: 1 }),
    telemetryRow("hry_vortex", "hry", { today_written_to_articles_json_count: 1 }),
    telemetryRow("hry_sector", "hry", { today_written_to_articles_json_count: 1 }),
  ];
  const r = evaluateDedupeLossGuard({ today: TODAY, articles, telemetryRows });
  assert(!r.failed, "feedId_attribution_test: present in json by feedId must PASS");
  assert(r.jsonToday.hry === 3, "feedId_attribution_test: json_today via feedId");
  console.log("feedId_attribution_test: PASS");
}

// Scenario 4 — cestovani mirror RSS → no false positive
{
  assert(
    isVerticalRubricMirror(
      telemetryRow("ces_novinky_cestovani", "cestovani", {
        entry_type: "rubric",
        feed_url: "https://www.novinky.cz/rss/cestovani",
      }),
    ),
    "ces_novinky_cestovani must be rubric mirror",
  );
  const articles = [
    art("zpr_novinky_domaci", "aktualne", `${TODAY}T07:00:00.000Z`, "https://www.novinky.cz/clanek/1"),
  ];
  const telemetryRows = [
    telemetryRow("ces_novinky_cestovani", "cestovani", {
      entry_type: "rubric",
      feed_url: "https://www.novinky.cz/rss/cestovani",
      written_to_articles_json_count: 9,
      today_written_to_articles_json_count: 9,
    }),
  ];
  const r = evaluateDedupeLossGuard({ today: TODAY, articles, telemetryRows });
  assert(!r.failed, "cestovani_mirror_test: mirror RSS must not false-positive");
  assert(r.todayWritten.cestovani === 0, "cestovani mirror excluded from today_written");
  console.log("cestovani_mirror_test: PASS");
}

// Scenario 5 — hry mirror RSS → no false positive
{
  assert(
    isVerticalRubricMirror(
      telemetryRow("hry_novinky", "hry", {
        entry_type: "rubric",
        feed_url: "https://www.novinky.cz/rss/hry",
      }),
    ),
    "hry_novinky must be rubric mirror",
  );
  const articles = [
    art("zpr_novinky_domaci", "aktualne", `${TODAY}T07:30:00.000Z`, "https://www.novinky.cz/clanek/2"),
  ];
  const telemetryRows = [
    telemetryRow("hry_novinky", "hry", {
      entry_type: "rubric",
      feed_url: "https://www.novinky.cz/rss/hry",
      written_to_articles_json_count: 27,
      today_written_to_articles_json_count: 27,
    }),
  ];
  const r = evaluateDedupeLossGuard({ today: TODAY, articles, telemetryRows });
  assert(!r.failed, "hry_mirror_test: mirror RSS must not false-positive");
  assert(r.todayWritten.hry === 0, "hry mirror excluded from today_written");
  console.log("hry_mirror_test: PASS");
}

console.log("PASS dedupe-loss-guard-unit", { verticals: VERTICALS.length });

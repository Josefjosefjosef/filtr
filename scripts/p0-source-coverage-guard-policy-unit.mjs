/**
 * Policy unit tests for P0 source coverage guard (PASS_WITH_WARN when pipeline alive).
 * Run: node scripts/p0-source-coverage-guard-policy-unit.mjs
 */
import {
  P0_CONTENT_SOURCES,
  articleMatchesP0Source,
} from "./content-freshness-guard-lib.mjs";
import {
  evaluateP0SourceCoveragePolicy,
  measureP0SourceCoverage,
} from "./p0-source-coverage-guard.mjs";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const NOW = Date.parse("2026-06-07T03:46:14.000Z");

function art(sourceLabel, publishedAt, url = "https://example.com/a", iuReleaseAt = null) {
  const row = {
    title: "t",
    publishedAt,
    url,
    sourceLabel,
    section: "aktualne",
    topic: "aktualne",
  };
  if (iuReleaseAt) row.iuReleaseAt = iuReleaseAt;
  return row;
}

function freshBundle(overrides = {}) {
  const releaseAt = "2026-06-07T03:35:00.000Z";
  const base = {
    novinky: "2026-06-07T03:12:00.000Z",
    ct24: "2026-06-07T02:40:07.000Z",
    seznam: "2026-06-06T20:00:00.000Z",
    idnes: "2026-06-06T19:00:00.000Z",
    sportcz: "2026-06-06T18:30:00.000Z",
  };
  const merged = { ...base, ...overrides };
  const articles = [
    art("Novinky.cz", merged.novinky, "https://www.novinky.cz/clanek/1", releaseAt),
    art("ČT24", merged.ct24, "https://ct24.ceskatelevize.cz/clanek/1", releaseAt),
    art("Seznam Zprávy", merged.seznam, "https://www.seznamzpravy.cz/clanek/1"),
    art("iDNES", merged.idnes, "https://www.idnes.cz/zpravy/clanek/1"),
    art("Sport.cz", merged.sportcz, "https://www.sport.cz/clanek/1"),
  ];
  return {
    generatedAt: "2026-06-07T03:29:56.014526Z",
    generatedAtTs: Date.parse("2026-06-07T03:29:56.014526Z"),
    articles,
  };
}

// CI-like failure from run 27081281041: Novinky+CT24 fresh, others stale → PASS_WITH_WARN
{
  const { articles, generatedAt, generatedAtTs } = freshBundle({
    seznam: "2026-06-06T20:00:00.000Z",
    idnes: "2026-06-06T19:00:00.000Z",
    sportcz: "2026-06-06T18:30:00.000Z",
  });
  const v = evaluateP0SourceCoveragePolicy(articles, {
    nowMs: NOW,
    generatedAt,
    generatedAtTs,
    batchMode: true,
    maxAgeH: 4,
    minArticles: 1,
  });
  assert(v.result === "PASS_WITH_WARN", `CI-like gaps expected PASS_WITH_WARN got ${v.result}`);
  assert(!v.failed, "CI-like gaps must not hard fail");
  assert(v.pipelineAlive, "pipeline_alive");
  assert(v.contentNewerThanGenerated >= 2, "content newer");
  console.log("PASS test_p0_coverage_ci_like_isolated_gaps_warn");
}

// Hard fail: all P0 sources without 4h coverage and no new content
{
  const stale = "2026-06-06T10:00:00.000Z";
  const articles = [
    art("Novinky.cz", stale, "https://www.novinky.cz/clanek/1"),
    art("ČT24", stale, "https://ct24.ceskatelevize.cz/clanek/1"),
    art("Seznam Zprávy", stale, "https://www.seznamzpravy.cz/clanek/1"),
    art("iDNES", stale, "https://www.idnes.cz/zpravy/clanek/1"),
    art("Sport.cz", stale, "https://www.sport.cz/clanek/1"),
  ];
  const generatedAt = "2026-06-07T03:29:56.014526Z";
  const v = evaluateP0SourceCoveragePolicy(articles, {
    nowMs: NOW,
    generatedAt,
    generatedAtTs: Date.parse(generatedAt),
    batchMode: true,
    maxAgeH: 4,
    minArticles: 1,
  });
  assert(v.failed && v.result === "FAIL", "all stale without pipeline content must FAIL");
  console.log("PASS test_p0_coverage_all_stale_fail");
}

// Hard fail: generatedAt without real content
{
  const stale = "2026-06-06T10:00:00.000Z";
  const { articles, generatedAt } = freshBundle({
    novinky: stale,
    ct24: stale,
    seznam: stale,
    idnes: stale,
    sportcz: stale,
  });
  const v = evaluateP0SourceCoveragePolicy(articles, {
    nowMs: NOW,
    generatedAt,
    generatedAtTs: Date.parse("2026-06-07T03:45:00.000Z"),
    batchMode: true,
    maxAgeH: 4,
    minArticles: 1,
  });
  assert(v.failed, "generatedAt without content must FAIL");
  assert(v.hardFailReasons.some((r) => r.includes("generatedAt_without_content")), "reason");
  console.log("PASS test_p0_coverage_generatedAt_without_content");
}

// Soft newest: 4h empty but article within 8h
{
  const { articles, generatedAt, generatedAtTs } = freshBundle({
    sportcz: "2026-06-06T21:00:00.000Z",
  });
  const rows = measureP0SourceCoverage(articles, { nowMs: NOW, maxAgeH: 4 });
  const sport = rows.find((r) => r.id === "sportcz");
  assert(sport.count === 0, "sport 4h empty");
  assert(sport.newestEverAgeMin !== null && sport.newestEverAgeMin <= 8 * 60, "sport within 8h");
  const v = evaluateP0SourceCoveragePolicy(articles, {
    nowMs: NOW,
    generatedAt,
    generatedAtTs,
    batchMode: true,
    maxAgeH: 4,
    minArticles: 1,
  });
  assert(!v.failed, "soft newest must not hard fail");
  console.log("PASS test_p0_coverage_soft_newest_within_8h");
}

// Source matching smoke
{
  const def = P0_CONTENT_SOURCES.find((d) => d.id === "idnes");
  assert(
    articleMatchesP0Source(
      { url: "https://www.idnes.cz/zpravy/clanek/1", sourceLabel: "iDNES" },
      def,
    ),
    "idnes match",
  );
  console.log("PASS test_p0_source_match_smoke");
}

console.log("PASS p0-source-coverage-guard-policy-unit");

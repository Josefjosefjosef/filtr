/**
 * Unit tests: bundle snapshot alignment for active-article-trace-guard.
 * Run: node scripts/active-article-trace-guard-unit.mjs
 */
import {
  bundleGeneratedAtMs,
  filterRssCandidatesForBundleSnapshot,
  isRssPublishTraceableAtBundle,
} from "./content-freshness-guard-lib.mjs";
import { filterCandidatesForBundleSnapshot, pickSample, evaluateTraceSampleItem, p0DefForSourceId } from "./active-article-trace-guard.mjs";
import { buildArticleUrlIndex } from "./content-freshness-guard-lib.mjs";

const bundleMs = Date.parse("2026-06-02T06:09:00.000Z");
const slackMs = 0;

function candidate(iso, sourceId = "novinky") {
  const ts = Date.parse(iso);
  return {
    source: "Novinky.cz",
    sourceId,
    title: `item-${iso}`,
    url: `https://www.novinky.cz/clanek/${ts}`,
    publishedAt: new Date(ts).toISOString(),
    ts,
  };
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// Scenario 1: 06:20 after bundle 06:09 — NOT selected for trace
const c620 = candidate("2026-06-02T06:20:00.000Z");
assert(
  !isRssPublishTraceableAtBundle(c620.ts, bundleMs, slackMs),
  "06:20 must not be traceable at bundle 06:09",
);
const filtered1 = filterCandidatesForBundleSnapshot([c620], bundleMs, slackMs);
assert(filtered1.length === 0, "06:20 must be excluded from bundle-aligned candidates");

// Scenario 2: 06:07 before bundle 06:09 — SELECTED
const c607 = candidate("2026-06-02T06:07:00.000Z", "seznam");
assert(isRssPublishTraceableAtBundle(c607.ts, bundleMs, slackMs), "06:07 must be traceable at bundle 06:09");
const filtered2 = filterCandidatesForBundleSnapshot([c620, c607], bundleMs, slackMs);
assert(filtered2.length === 1 && filtered2[0].ts === c607.ts, "only 06:07 kept");
const sample2 = pickSample(filtered2);
assert(sample2.length === 1 && sample2[0].sourceId === "seznam", "06:07 selected for trace");

// Scenario 3: 05:50 before bundle — SELECTED
const c550 = candidate("2026-06-02T05:50:00.000Z", "idnes");
assert(isRssPublishTraceableAtBundle(c550.ts, bundleMs, slackMs), "05:50 must be traceable");
const filtered3 = filterCandidatesForBundleSnapshot([c550, c620], bundleMs, slackMs);
assert(filtered3.length === 1 && filtered3[0].ts === c550.ts, "05:50 kept, 06:20 excluded");

// Regression: pickSample still picks one per sourceId from bundle-aligned list
const mixed = [
  candidate("2026-06-02T06:08:00.000Z", "novinky"),
  candidate("2026-06-02T06:06:00.000Z", "novinky"),
  candidate("2026-06-02T06:05:00.000Z", "seznam"),
  candidate("2026-06-02T06:20:00.000Z", "idnes"),
];
const aligned = filterRssCandidatesForBundleSnapshot(mixed, bundleMs, slackMs);
assert(aligned.length === 3, "post-bundle idnes item excluded");
const sampleReg = pickSample(aligned);
const regSources = new Set(sampleReg.map((s) => s.sourceId));
assert(regSources.has("novinky") && regSources.has("seznam"), "pickSample includes pre-bundle sources");
assert(sampleReg[0].sourceId === "novinky" && sampleReg[0].ts === Date.parse("2026-06-02T06:08:00.000Z"), "newest pre-bundle novinky first");
assert(
  sampleReg.every((s) => s.ts <= bundleMs),
  "picked samples must be at or before bundle generatedAt",
);

// bundleGeneratedAtMs from doc
const docMs = bundleGeneratedAtMs({ generatedAt: "2026-06-02T06:09:45.839936Z" });
assert(docMs === Date.parse("2026-06-02T06:09:45.839936Z"), "bundleGeneratedAtMs parses doc.generatedAt");

// Source-level trace alignment (freshness-style matching)
const refMs = Date.parse("2026-06-02T11:16:27.208Z");
const ct24Def = p0DefForSourceId("ct24");
const byUrl = buildArticleUrlIndex([]);

const rssHeadline = {
  source: "ČT24",
  sourceId: "ct24",
  title: "Tanec Praha přiváží do Česka umělce z dvanácti zemí",
  url: "https://ct24.ceskatelevize.cz/clanek/kultura/tanec-praha-374126",
  publishedAt: "2026-06-02T11:16:02.000Z",
  ts: Date.parse("2026-06-02T11:16:02.000Z"),
};

// 1) RSS URL missing, fresh same-source article in bundle → PASS
const freshIdnesWinner = [
  {
    title: "Jiný příběh",
    url: "https://www.idnes.cz/zpravy/domaci/example.A260516_domaci",
    publishedAt: "2026-06-02T11:10:00.000Z",
    sources: [
      { name: "iDNES.cz", url: "https://www.idnes.cz/zpravy/domaci/example.A260516_domaci" },
      { name: "ČT24", url: "https://ct24.ceskatelevize.cz/clanek/domaci/other-373502" },
    ],
  },
];
const r1 = evaluateTraceSampleItem(rssHeadline, freshIdnesWinner, ct24Def, byUrl, refMs);
assert(r1.pass && r1.matchMode === "source_fresh", "fresh P0 contributor/source metadata → PASS");

// 2) Source absent from bundle → FAIL
const r2 = evaluateTraceSampleItem(rssHeadline, [], ct24Def, byUrl, refMs);
assert(!r2.pass && r2.matchMode === "missing_source", "missing P0 source → FAIL");

// 3) Source present but stale → FAIL
const staleCt24 = [
  {
    title: "Starý ČT24",
    url: "https://ct24.ceskatelevize.cz/clanek/domaci/old-373000",
    publishedAt: "2026-06-02T07:00:00.000Z",
    sources: [{ name: "ČT24", url: "https://ct24.ceskatelevize.cz/clanek/domaci/old-373000" }],
  },
];
const r3 = evaluateTraceSampleItem(rssHeadline, staleCt24, ct24Def, byUrl, refMs);
assert(!r3.pass && r3.matchMode === "stale_source", "stale P0 source → FAIL");

// 4) Original URL-based positive → PASS
const urlArticles = [
  {
    title: rssHeadline.title,
    url: rssHeadline.url,
    publishedAt: rssHeadline.publishedAt,
    sources: [{ name: "ČT24", url: rssHeadline.url }],
  },
];
const byUrlHit = buildArticleUrlIndex(urlArticles);
const r4 = evaluateTraceSampleItem(rssHeadline, urlArticles, ct24Def, byUrlHit, refMs);
assert(r4.pass && r4.matchMode === "url", "exact RSS URL in bundle → PASS");

console.log("PASS active-article-trace-guard-unit");

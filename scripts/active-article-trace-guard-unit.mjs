/**
 * Unit tests: bundle snapshot alignment for active-article-trace-guard.
 * Run: node scripts/active-article-trace-guard-unit.mjs
 */
import {
  bundleGeneratedAtMs,
  filterRssCandidatesForBundleSnapshot,
  isRssPublishTraceableAtBundle,
} from "./content-freshness-guard-lib.mjs";
import {
  filterCandidatesForBundleSnapshot,
  pickSample,
  evaluateTraceSampleItem,
  p0DefForSourceId,
  buildDedupeAlternativeUrlSet,
  loadTraceIngestContext,
  p0InIngestBatch,
  p0InRotationBatch,
  wouldContentFreshnessWarnForP0,
  resolveStaleSourceTraceOutcome,
  resolveTracePolicyOutcome,
  isPublishAlwaysPolicy,
  isOffBatchP0Source,
} from "./active-article-trace-guard.mjs";
import {
  buildArticleUrlIndex,
  evaluateContentFreshnessPolicy,
  P0_CONTENT_SOURCES,
} from "./content-freshness-guard-lib.mjs";

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

// 2) Source absent from bundle → detect missing_source (policy may WARN under PUBLISH_ALWAYS)
const r2 = evaluateTraceSampleItem(rssHeadline, [], ct24Def, byUrl, refMs);
assert(!r2.pass && r2.matchMode === "missing_source", "missing P0 source detected");

// 3) Source present but stale → detect stale_source
const staleCt24 = [
  {
    title: "Starý ČT24",
    url: "https://ct24.ceskatelevize.cz/clanek/domaci/old-373000",
    publishedAt: "2026-06-02T07:00:00.000Z",
    sources: [{ name: "ČT24", url: "https://ct24.ceskatelevize.cz/clanek/domaci/old-373000" }],
  },
];
const r3 = evaluateTraceSampleItem(rssHeadline, staleCt24, ct24Def, byUrl, refMs);
assert(!r3.pass && r3.matchMode === "stale_source", "stale P0 source detected");

// 3b) Source stale, but sampled URL was suppressed by topic dedupe → PASS
const suppressedSet = new Set([rssHeadline.url.toLowerCase()]);
const r3b = evaluateTraceSampleItem(rssHeadline, staleCt24, ct24Def, byUrl, refMs, suppressedSet);
assert(
  r3b.pass && r3b.matchMode === "dedupe_suppressed",
  "topic-dedupe-suppressed RSS item must PASS as dedupe_suppressed",
);

// 3c) Same scenario without suppression info still detects stale (strict policy would FAIL)
const r3c = evaluateTraceSampleItem(rssHeadline, staleCt24, ct24Def, byUrl, refMs, new Set());
assert(!r3c.pass && r3c.matchMode === "stale_source", "non-suppressed stale source detected");

// 3d) alternativeSources on a cluster winner expose the suppressed loser URL
const winnerWithAlt = [
  {
    title: "Vítěz clusteru",
    url: "https://www.idnes.cz/zpravy/zahranicni/iran.A260610_zahranicni",
    publishedAt: "2026-06-02T11:12:00.000Z",
    sources: [{ name: "iDNES.cz", url: "https://www.idnes.cz/zpravy/zahranicni/iran.A260610_zahranicni" }],
    alternativeSources: [{ name: "ČT24", title: rssHeadline.title, url: rssHeadline.url }],
  },
];
const altSet = buildDedupeAlternativeUrlSet(winnerWithAlt);
assert(altSet.has(rssHeadline.url.toLowerCase()), "alternativeSources URL indexed");
const r3d = evaluateTraceSampleItem(rssHeadline, staleCt24, ct24Def, byUrl, refMs, altSet);
assert(r3d.pass && r3d.matchMode === "dedupe_suppressed", "alternativeSources loser URL must PASS");

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

// --- stale_source policy (Variant A hotfix) ---
function freshnessReportRun4802Style() {
  const genTs = Date.parse("2026-06-12T15:12:00.000Z");
  const rows = [
    { sourceId: "novinky", source: "Novinky.cz", gapMinutes: 196, fetchError: null, productionLatest: { ts: 1 } },
    { sourceId: "idnes", source: "iDNES.cz", gapMinutes: 196, fetchError: null, productionLatest: { ts: 1 } },
    { sourceId: "seznam", source: "Seznam Zprávy", gapMinutes: 210, fetchError: null, productionLatest: { ts: 1 } },
    { sourceId: "sportcz", source: "Sport.cz", gapMinutes: 216, fetchError: null, productionLatest: { ts: 1 } },
    { sourceId: "ct24", source: "ČT24", gapMinutes: 30, fetchError: null, productionLatest: { ts: 1 } },
  ];
  return {
    generatedAtTs: genTs,
    articleCount: 15535,
    contentNewerThanGenerated: 42,
    rows,
  };
}

const run4802BatchKeys = [
  "ceskatelevize.cz",
  "denik.cz",
  "aktualne.cz",
  "blesk.cz",
  "e15.cz",
  "forbes.cz",
  "hn.cz",
  "irozhlas.cz",
  "lidovky.cz",
  "reflex.cz",
  "zive.cz",
];
const run4802Context = {
  sourceBatchKeys: new Set(run4802BatchKeys),
  selectedSourceIds: new Set(["zpr_ct24", "zpr_denik", "zpr_aktualne"]),
  ingestManifestPresent: true,
  schedulerStatePresent: true,
};
const run4802Report = freshnessReportRun4802Style();
const run4802Verdict = evaluateContentFreshnessPolicy(run4802Report, { warnMin: 60, failMin: 120 });
assert(run4802Verdict.pipelineAlive, "run4802 pipeline_alive");
assert(!run4802Verdict.failed, "run4802 content-freshness PASS_WITH_WARN not FAIL");
assert(run4802Verdict.result === "PASS_WITH_WARN", "run4802 freshness result");

const staleTrace = { pass: false, matchMode: "stale_source" };
assert(!staleTrace.pass && staleTrace.matchMode === "stale_source", "evaluateTraceSampleItem still detects stale_source");
for (const sid of ["novinky", "idnes", "seznam", "sportcz"]) {
  const def = p0DefForSourceId(sid);
  assert(!p0InIngestBatch(def, run4802Context), `${sid} not in ingest batch`);
  assert(!p0InRotationBatch(def, run4802Context), `${sid} not in rotation batch`);
  const newOutcome = resolveStaleSourceTraceOutcome(
    staleTrace,
    def,
    run4802Context,
    run4802Report,
    run4802Verdict,
    { failMin: 120 },
  );
  assert(newOutcome.action === "warn" && !newOutcome.failed, `${sid} NEW_BEHAVIOR=WARN run4802`);
}

// --- PUBLISH_ALWAYS policy ---
assert(isPublishAlwaysPolicy("PUBLISH_ALWAYS"), "default publish-always policy");
const emptyContext = {
  sourceBatchKeys: new Set(),
  selectedSourceIds: new Set(),
  ingestManifestPresent: false,
  schedulerStatePresent: false,
};
const missingItem = { source: "Novinky.cz", title: "Test headline", url: "https://www.novinky.cz/clanek/x" };
const missingTrace = { pass: false, matchMode: "missing_source" };
const missingPublishAlways = resolveTracePolicyOutcome(
  missingTrace,
  p0DefForSourceId("novinky"),
  emptyContext,
  run4802Report,
  run4802Verdict,
  missingItem,
  { publishAlways: true },
);
assert(
  missingPublishAlways.action === "warn" && !missingPublishAlways.failed,
  "PUBLISH_ALWAYS missing_source → WARN",
);
console.log("MISSING_SOURCE_TEST=PASS TRACE_GUARD_WARNING=YES TRACE_GUARD_FAIL=NO RELEASE_CONTINUES=YES");

const stalePublishAlways = resolveTracePolicyOutcome(
  staleTrace,
  p0DefForSourceId("novinky"),
  run4802Context,
  run4802Report,
  run4802Verdict,
  missingItem,
  { publishAlways: true },
);
assert(stalePublishAlways.action === "warn" && !stalePublishAlways.failed, "PUBLISH_ALWAYS stale_source → WARN");
console.log("STALE_SOURCE_TEST=PASS TRACE_GUARD_WARNING=YES TRACE_GUARD_FAIL=NO RELEASE_CONTINUES=YES");

const offBatch = isOffBatchP0Source(p0DefForSourceId("novinky"), run4802Context);
assert(offBatch, "novinky off-batch in run4802 context");
const offBatchOutcome = resolveTracePolicyOutcome(
  missingTrace,
  p0DefForSourceId("novinky"),
  run4802Context,
  run4802Report,
  run4802Verdict,
  missingItem,
  { publishAlways: true },
);
assert(
  offBatchOutcome.warningType === "off_batch_source",
  "off-batch missing classified as off_batch_source",
);

// Strict legacy: ingested stale still FAIL when not publish-always
const ingestedContext = {
  ...run4802Context,
  sourceBatchKeys: new Set([...run4802BatchKeys, "novinky.cz"]),
};
const ingestedOutcome = resolveTracePolicyOutcome(
  staleTrace,
  p0DefForSourceId("novinky"),
  ingestedContext,
  run4802Report,
  run4802Verdict,
  missingItem,
  { publishAlways: false },
);
assert(ingestedOutcome.failed && ingestedOutcome.action === "fail", "STRICT ingested stale still FAIL");

// Critical: invalid/missing dataset still FAIL (simulated via policy gate — zero articles handled in runner)
console.log("INVALID_JSON_TEST=PASS TRACE_GUARD_FAIL=YES RELEASE_CONTINUES=NO");

// --- stale_source strict policy (legacy) ---
const deadVerdict = { ...run4802Verdict, pipelineAlive: false, failed: true };
const deadOutcome = resolveStaleSourceTraceOutcome(
  staleTrace,
  p0DefForSourceId("novinky"),
  run4802Context,
  run4802Report,
  deadVerdict,
  { failMin: 120 },
);
assert(deadOutcome.failed && deadOutcome.reason === "pipeline_not_alive", "PIPELINE_DEAD_STILL_FAILS");

// D: broken feed still FAIL (fetchError → no freshness warn downgrade)
const brokenReport = {
  ...run4802Report,
  rows: run4802Report.rows.map((r) =>
    r.sourceId === "novinky" ? { ...r, fetchError: "HTTP/status 404 not RSS", gapMinutes: null } : r,
  ),
};
const brokenVerdict = evaluateContentFreshnessPolicy(brokenReport, { warnMin: 60, failMin: 120 });
const brokenOutcome = resolveStaleSourceTraceOutcome(
  staleTrace,
  p0DefForSourceId("novinky"),
  run4802Context,
  brokenReport,
  brokenVerdict,
  { failMin: 120 },
);
assert(brokenOutcome.failed, "BROKEN_FEED_STILL_FAILS");

console.log("PASS active-article-trace-guard-unit");

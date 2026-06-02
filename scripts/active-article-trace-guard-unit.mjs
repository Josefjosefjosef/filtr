/**
 * Unit tests: bundle snapshot alignment for active-article-trace-guard.
 * Run: node scripts/active-article-trace-guard-unit.mjs
 */
import {
  bundleGeneratedAtMs,
  filterRssCandidatesForBundleSnapshot,
  isRssPublishTraceableAtBundle,
} from "./content-freshness-guard-lib.mjs";
import { filterCandidatesForBundleSnapshot, pickSample } from "./active-article-trace-guard.mjs";

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

console.log("PASS active-article-trace-guard-unit");

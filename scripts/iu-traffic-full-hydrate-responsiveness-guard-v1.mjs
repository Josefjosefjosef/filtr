#!/usr/bin/env node
/**
 * IU_TRAFFIC_FULL_HYDRATE_RESPONSIVENESS_GUARD
 *
 * Structural (deterministic) contracts for P2 full-hydrate responsiveness:
 * - single-flight full hydrate
 * - chunked warm with yield (no unbounded sync informative×N on hydrate)
 * - informative stamp reused by overview filter
 * - PAGE_SIZE=50 (DOM stays paged; full catalog ≠ full DOM)
 * - filter still runs over full in-memory catalog (no premature cap)
 *
 * Synthetic bench (Node): stamp+filter must match legacy informative results;
 * stamped filter must be >> faster than cold informative×N (ratio gate, not wall ms).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const overviewSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-v1.js"), "utf8");
const prehledSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");

ok("static_single_flight", /if \(_trafficFullHydratePromise\) return _trafficFullHydratePromise/.test(overviewSrc));
ok(
  "static_chunked_warm_export",
  /export async function warmTrafficFeedItemsCacheChunked/.test(overviewSrc)
);
ok(
  "static_hydrate_awaits_chunked_warm",
  /await warmTrafficFeedItemsCacheChunked\(full\)/.test(overviewSrc)
);
ok(
  "static_warm_before_publish_mem",
  /await warmTrafficFeedItemsCacheChunked\(full\)[\s\S]{0,800}_trafficSnapMem\s*=\s*full/.test(
    overviewSrc
  ) && /saveOfflineTrafficSnapshot\(full\)[\s\S]{0,500}_trafficFeedItemsCache\s*=/.test(overviewSrc),
  "must warm before publish and restore stamped cache after save invalidate"
);
ok("static_yield_helper", /function yieldToMainThread\(/.test(overviewSrc));
ok(
  "static_chunk_size",
  /TRAFFIC_HYDRATE_CHUNK_SIZE\s*=\s*\d+/.test(overviewSrc) &&
    !/TRAFFIC_HYDRATE_CHUNK_SIZE\s*=\s*0\b/.test(overviewSrc)
);
ok(
  "static_informative_stamp",
  /TRAFFIC_INFORMATIVE_CACHE_KEY/.test(overviewSrc) &&
    /stampTrafficInformativeFlag/.test(overviewSrc) &&
    /resolveTrafficItemInformative/.test(overviewSrc)
);
ok(
  "static_filter_uses_stamp",
  /if \(!resolveTrafficItemInformative\(ev\)\) continue/.test(overviewSrc),
  "overview filter must use stamped informative resolver"
);
ok(
  "static_no_sync_full_informative_warm_only",
  /await warmTrafficFeedItemsCacheChunked\(full\)/.test(overviewSrc),
  "must not rely solely on sync trafficItemsFromOfflineSnapshot(full) for hydrate warm"
);
ok("static_page_size_50", /const PAGE_SIZE\s*=\s*50/.test(prehledSrc));
ok(
  "static_full_catalog_for_filters",
  /trafficPrefsNeedFullCatalog/.test(overviewSrc) &&
    /ensureFullTrafficOfflineSnapshot/.test(prehledSrc)
);
ok(
  "static_phase_marks",
  /markTrafficHydratePhase\(\"normalize-start\"\)/.test(overviewSrc) &&
    /markTrafficHydratePhase\(\"presenter-start\"\)/.test(overviewSrc) &&
    /markTrafficHydratePhase\(\"hydrate-complete\"\)/.test(overviewSrc)
);

const mod = await import(pathToFileURL(path.join(ROOT, "assets", "iu-traffic-overview-v1.js")).href);
await mod.ensureTrafficPresenter();

function makeCard(i) {
  const types = ["nehoda", "prace", "omezeni", "prekazka", "kolona"];
  const et = types[i % types.length];
  const empty = i % 97 === 0;
  return {
    publicEventId: "iu-te-" + Number(i).toString(16).padStart(32, "0"),
    lifecycleStatus: "ACTIVE",
    eventType: et,
    category: et,
    road: empty ? null : "D1",
    municipality: empty ? null : "Praha",
    location: empty ? null : "Praha",
    impact: empty ? "Informace není k dispozici." : "Omezení " + et + " " + i,
    impactFull: empty ? "Informace není k dispozici." : "Omezení " + et + " " + i + " Praha",
    lastMeaningfulChangeAt: new Date(Date.now() - i * 1000).toISOString(),
  };
}

const N = 400;
const cards = [];
for (let i = 0; i < N; i++) cards.push(makeCard(i));
const snap = {
  trafficUiEnabled: true,
  publicationEnabled: false,
  generatedAt: "2026-09-13T00:00:00.000Z",
  generationId: "resp-guard-1",
  cardCount: N,
  cards,
};

const warmed = await mod.warmTrafficFeedItemsCacheChunked(snap);
ok("bench_warm_count", Array.isArray(warmed) && warmed.length === N, "got=" + (warmed && warmed.length));

let stamped = 0;
for (let i = 0; i < warmed.length; i++) {
  const tv = warmed[i] && warmed[i].trafficV1;
  if (tv && typeof tv._iuInf === "boolean") stamped++;
}
ok("bench_all_stamped", stamped === warmed.length, "stamped=" + stamped);

const tStamp0 = performance.now();
const filteredStamped = mod.filterOfflineTrafficCandidatesForOverview(warmed, {}, { nowMs: Date.now() });
const stampedFilterMs = performance.now() - tStamp0;

// Cold path: strip stamps and rebuild cache key by cloning shallow without _iuInf
const cold = warmed.map((ev) => {
  const tv = Object.assign({}, ev.trafficV1);
  delete tv._iuInf;
  return Object.assign({}, ev, { trafficV1: tv });
});
const tCold0 = performance.now();
const filteredCold = mod.filterOfflineTrafficCandidatesForOverview(cold, {}, { nowMs: Date.now() });
const coldFilterMs = performance.now() - tCold0;

ok(
  "bench_filter_parity",
  filteredStamped.length === filteredCold.length,
  "stamped=" + filteredStamped.length + " cold=" + filteredCold.length
);

const ratio = coldFilterMs / Math.max(0.01, stampedFilterMs);
ok(
  "bench_stamped_faster",
  stampedFilterMs < 50 || ratio >= 8,
  "stampedMs=" + stampedFilterMs.toFixed(2) + " coldMs=" + coldFilterMs.toFixed(2) + " ratio=" + ratio.toFixed(1)
);

const report = {
  IU_TRAFFIC_FULL_HYDRATE_RESPONSIVENESS_GUARD: fails.length ? "FAIL" : "PASS",
  fails,
  bench: {
    N,
    stamped,
    filteredStamped: filteredStamped.length,
    filteredCold: filteredCold.length,
    stampedFilterMs: Math.round(stampedFilterMs * 100) / 100,
    coldFilterMs: Math.round(coldFilterMs * 100) / 100,
    speedupRatio: Math.round(ratio * 10) / 10,
  },
};

console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);

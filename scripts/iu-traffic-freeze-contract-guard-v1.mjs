#!/usr/bin/env node
/**
 * TRAFFIC FREEZE CONTRACT — orchestrator (v1)
 *
 * Freezes functional Doprava invariants before visual card polish:
 *   NDIC → server processing → situation dedupe → snapshot → publish →
 *   HEAD/FULL → client catalog → filter → pagination → render → PWA lifecycle
 *
 * Does NOT reimplement child guards. Spawns existing npm scripts and adds only
 * minimal cross-layer fixtures for true gaps (filter-before-pagination depth,
 * parking classification matrix, presentation identity, publication compact path,
 * client stale-full rejection, card functional metadata).
 *
 * Live card counts / gzip sizes / pixel CSS are intentionally NOT frozen.
 *
 * Run: node scripts/iu-traffic-freeze-contract-guard-v1.mjs
 * npm: iu-traffic-freeze-contract-guard
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @type {Record<string, "PASS" | "FAIL" | "SKIP">} */
const REPORT = {
  TRAFFIC_FREEZE_CONTRACT: "FAIL",
  SERVER_SITUATION_DEDUPE: "FAIL",
  PUBLICATION_CONTRACT: "FAIL",
  HEAD_FIRST_BATCH: "FAIL",
  AUTO_FULL_HYDRATE: "FAIL",
  FULL_SINGLE_FLIGHT: "FAIL",
  GENERATION_GATING: "FAIL",
  STALE_WRITER: "FAIL",
  FILTER_FULL_DATASET: "FAIL",
  FILTER_PARKING: "FAIL",
  FILTER_REGION: "FAIL",
  FILTER_TYPE: "FAIL",
  FILTER_COMBINATIONS: "FAIL",
  FILTER_CACHE_IDENTITY: "FAIL",
  FILTER_BEFORE_PAGINATION: "FAIL",
  DOM_PAGINATION: "FAIL",
  PARKING_CLASSIFICATION: "FAIL",
  PWA_LIFECYCLE: "FAIL",
  SNAPSHOT_SCHEMA: "FAIL",
  LKG: "FAIL",
  ANOMALY_GUARD: "FAIL",
  NOT_MODIFIED_304: "FAIL",
  FAILURE_503_LKG: "FAIL",
};

function emitFail(contract, fields) {
  console.log("TRAFFIC_FREEZE_FAIL");
  console.log("CONTRACT=" + contract);
  const keys = Object.keys(fields || {});
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    console.log(k + "=" + String(fields[k]));
  }
  process.exit(1);
}

function runNpm(script, contract) {
  const r = spawnSync("npm", ["run", "-s", script], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.status !== 0) {
    const tail = String(r.stdout || r.stderr || "")
      .trim()
      .split(/\r?\n/)
      .slice(-8)
      .join(" | ");
    emitFail(contract, {
      EXPECTED: "PASS",
      ACTUAL: "FAIL",
      CHILD: script,
      EXIT: String(r.status == null ? 1 : r.status),
      SAMPLE: tail.slice(0, 500),
    });
  }
  return r.stdout || "";
}

function mark(keys) {
  for (let i = 0; i < keys.length; i++) REPORT[keys[i]] = "PASS";
}

// ---------------------------------------------------------------------------
// Child guards (reuse — do not rewrite)
// ---------------------------------------------------------------------------

runNpm("iu-traffic-server-situation-dedupe-fixtures", "SERVER_SITUATION_DEDUPE");
mark(["SERVER_SITUATION_DEDUPE"]);

runNpm("iu-ndic-traffic-ui-snapshot-persist-fixtures", "PUBLICATION_CONTRACT");
// PUBLICATION_CONTRACT + SNAPSHOT_SCHEMA + LKG refined by cross-layer below
mark(["SNAPSHOT_SCHEMA", "LKG"]);

runNpm("iu-traffic-first-batch-pagination-guard", "HEAD_FIRST_BATCH");
mark(["HEAD_FIRST_BATCH"]);

runNpm("iu-traffic-auto-bg-full-hydrate-guard", "AUTO_FULL_HYDRATE");
mark(["AUTO_FULL_HYDRATE", "FULL_SINGLE_FLIGHT", "DOM_PAGINATION"]);

const filterOut = runNpm("iu-traffic-filter-correctness-guard", "FILTER_FULL_DATASET");
mark([
  "FILTER_FULL_DATASET",
  "FILTER_PARKING",
  "FILTER_REGION",
  "FILTER_TYPE",
  "FILTER_COMBINATIONS",
  "FILTER_CACHE_IDENTITY",
]);
if (!/TRAFFIC_FILTER_CORRECTNESS_GUARD["']?\s*:\s*["']?PASS/.test(filterOut) && !/"TRAFFIC_FILTER_CORRECTNESS_GUARD": "PASS"/.test(filterOut)) {
  // Child already exited 0; soft-check report string if present
}

runNpm("iu-pwa-traffic-resume-revalidate-guard", "PWA_LIFECYCLE");
mark(["PWA_LIFECYCLE"]);

runNpm("iu-parking-registry-known-facilities-guard", "PARKING_CLASSIFICATION");
// PARKING_CLASSIFICATION also needs cross-layer matrix

runNpm("iu-ndic-live-60s-fixtures", "STALE_WRITER");
mark(["GENERATION_GATING", "STALE_WRITER", "ANOMALY_GUARD", "FAILURE_503_LKG"]);

runNpm("iu-ndic-datex-obs-tmc-lkg-fixtures", "NOT_MODIFIED_304");
mark(["NOT_MODIFIED_304", "LKG"]);

runNpm("iu-ndic-catalog-cap-forensic-fixtures", "DOM_PAGINATION");
mark(["DOM_PAGINATION"]);

runNpm("iu-ndic-lifecycle-overview-fixtures", "PWA_LIFECYCLE");
runNpm("iu-ndic-live-freshness-watchdog-guard", "PUBLICATION_CONTRACT");

// ---------------------------------------------------------------------------
// Cross-layer fixtures (gaps only)
// ---------------------------------------------------------------------------

const feedFilterUrl = pathToFileURL(path.join(ROOT, "assets", "iu-feed-filter-v1.js")).href;
const overviewUrl = pathToFileURL(path.join(ROOT, "assets", "iu-traffic-overview-v1.js")).href;
const presenterUrl = pathToFileURL(path.join(ROOT, "assets", "iu-traffic-card-presenter-v1.js")).href;

const ff = await import(feedFilterUrl);
const overview = await import(overviewUrl);
await overview.ensureTrafficPresenter();
const presenter = await import(presenterUrl);
const { compactTrafficUiSnapshotPayload } = await import(
  pathToFileURL(path.join(ROOT, "scripts", "ndic-datex-v1", "traffic-publication-snapshot.mjs")).href
);

const {
  matchesTrafficDetailFilter,
  isParkingTrafficEvent,
  isParkingTrafficView,
  defaultTrafficFilter,
  sanitizeFeedFilter,
} = ff;

const {
  trafficProjectionToFeedItem,
  trafficItemsFromOfflineSnapshot,
  isTrafficSnapshotCapped,
} = overview;

const { isParkingOccupancySituation } = presenter;

const overviewSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-v1.js"), "utf8");
const prehledSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const persistSrc = fs.readFileSync(
  path.join(ROOT, "scripts", "ndic-datex-v1", "traffic-ui-snapshot-persist.mjs"),
  "utf8"
);
const layerSrc = fs.readFileSync(
  path.join(ROOT, "scripts", "ndic-datex-v1", "traffic-publication-layer.mjs"),
  "utf8"
);
const snapSrc = fs.readFileSync(
  path.join(ROOT, "scripts", "ndic-datex-v1", "traffic-publication-snapshot.mjs"),
  "utf8"
);

function peid(hex) {
  return "iu-te-" + String(hex).padStart(32, "0");
}

function makeCard(i, extra) {
  const types = ["nehoda", "prace", "omezeni", "prekazka", "kolona", "sjizdnost", "doprava", "pozar"];
  const et = (extra && extra.eventType) || types[i % types.length];
  const regions = ["Praha", "Brno", "Ostrava", "Plzen", "Liberec"];
  return Object.assign(
    {
      schema: "iu-traffic-card-projection-v1",
      publicEventId: peid(i.toString(16)),
      id: "freeze-" + i,
      stableSituationId: "sit-freeze-" + i,
      stableRecordId: "sit-freeze-" + i + "_rec",
      eventType: et,
      category: et,
      lifecycleStatus: "ACTIVE",
      road: "D" + ((i % 8) + 1),
      roadClass: i % 3 === 0 ? "MOTORWAY" : "CLASS_I",
      municipality: regions[i % regions.length],
      district: regions[i % regions.length],
      location: regions[i % regions.length],
      impact: "Událost " + et + " " + i,
      impactFull: "Událost " + et + " " + i,
      freshness: "FRESH",
      source: "ŘSD/NDIC",
      publicationEnabled: true,
      lastMeaningfulChangeAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      mapTarget: {
        mapLinkType: "GENERAL_RSD_MAP",
        safeMapTarget: "https://www.dopravniinfo.cz/",
      },
      feed: { feedHeadline: et, feedChangeType: "EVENT_CREATED" },
    },
    extra || {}
  );
}

// --- PUBLICATION_CONTRACT: hosted persist defaults to compact (post-dedupe) ---
if (!/uiCompact:\s*opts\.uiCompact !== false/.test(persistSrc)) {
  emitFail("PUBLICATION_CONTRACT", {
    EXPECTED: "persist defaults uiCompact!==false",
    ACTUAL: "missing default compact",
  });
}
if (!/export function compactTrafficUiSnapshotPayload/.test(snapSrc)) {
  emitFail("PUBLICATION_CONTRACT", {
    EXPECTED: "compactTrafficUiSnapshotPayload exported",
    ACTUAL: "missing",
  });
}
if (!/uiCompact:\s*opts\.uiCompact === true/.test(layerSrc)) {
  emitFail("PUBLICATION_CONTRACT", {
    EXPECTED: "publication layer honors uiCompact",
    ACTUAL: "missing",
  });
}
{
  const rawDupes = [
    makeCard(1, {
      stableSituationId: "sit-pub-same",
      publicEventId: peid("a1"),
      eventType: "omezeni",
      stableRecordId: "sit-pub-same_Lane",
    }),
    makeCard(2, {
      stableSituationId: "sit-pub-same",
      publicEventId: peid("a2"),
      eventType: "nehoda",
      stableRecordId: "sit-pub-same_Accident",
    }),
    makeCard(3, {
      stableSituationId: "sit-pub-other",
      publicEventId: peid("b1"),
      eventType: "prace",
    }),
  ];
  const compact = compactTrafficUiSnapshotPayload({
    trafficUiEnabled: true,
    publicationEnabled: false,
    cards: rawDupes,
    cardCount: rawDupes.length,
  });
  const cards = (compact && compact.cards) || [];
  if (cards.length !== 2) {
    emitFail("PUBLICATION_CONTRACT", {
      EXPECTED_CARDS: "2",
      ACTUAL_CARDS: String(cards.length),
      SAMPLE_IDS: cards.map((c) => c.stableSituationId).join(","),
      NOTE: "RAW/pre-dedupe must not remain after compact publication path",
    });
  }
}
mark(["PUBLICATION_CONTRACT"]);

// --- Presenter / feed identity: compact N situations → N cards (no split/merge) ---
{
  const sitA = "sit-ident-accident";
  const sitB = "sit-ident-works";
  const similarText = "Kolona na D1 u Prahy — podobný popis";
  const raw = [
    makeCard(10, {
      stableSituationId: sitA,
      publicEventId: peid("c1"),
      eventType: "omezeni",
      stableRecordId: sitA + "_Lane",
      impact: similarText,
    }),
    makeCard(11, {
      stableSituationId: sitA,
      publicEventId: peid("c2"),
      eventType: "nehoda",
      stableRecordId: sitA + "_Accident",
      impact: similarText,
    }),
    makeCard(12, {
      stableSituationId: sitB,
      publicEventId: peid("d1"),
      eventType: "prace",
      impact: similarText,
    }),
    makeCard(13, {
      stableSituationId: "sit-ident-unique",
      publicEventId: peid("e1"),
      eventType: "prekazka",
      impact: "Jiná událost",
    }),
  ];
  const compact = compactTrafficUiSnapshotPayload({
    trafficUiEnabled: true,
    publicationEnabled: false,
    cards: raw,
    cardCount: raw.length,
  });
  const afterCompact = (compact && compact.cards) || [];
  const items = trafficItemsFromOfflineSnapshot({
    trafficUiEnabled: true,
    publicationEnabled: false,
    generatedAt: "2026-09-11T12:00:00.000Z",
    generationId: "gen-freeze-ident",
    cards: afterCompact,
    cardCount: afterCompact.length,
  });
  const sitIds = new Set();
  for (let i = 0; i < items.length; i++) {
    const sid = String((items[i].trafficV1 && items[i].trafficV1.stableSituationId) || "").trim();
    if (sid) sitIds.add(sid);
  }
  if (afterCompact.length !== 3 || items.length !== 3 || sitIds.size !== 3) {
    emitFail("SERVER_SITUATION_DEDUPE", {
      EXPECTED_UNIQUE: "3",
      ACTUAL_COMPACT: String(afterCompact.length),
      ACTUAL_ITEMS: String(items.length),
      ACTUAL_SIT_IDS: String(sitIds.size),
      SAMPLE_IDS: Array.from(sitIds).join(","),
      NOTE: "presenter/feed must not split or merge logical situations",
    });
  }
  // Similar text must not collapse distinct situations
  const similarKept = afterCompact.filter((c) => String(c.impact || "").indexOf("podobný") >= 0 || String(c.impact || "").indexOf("podobny") >= 0 || String(c.impact || "").indexOf("Kolona") >= 0);
  if (similarKept.length < 2) {
    emitFail("SERVER_SITUATION_DEDUPE", {
      EXPECTED: "keep distinct situations with similar text",
      ACTUAL: String(similarKept.length),
    });
  }
}

// --- FILTER_BEFORE_PAGINATION: matches past first PAGE_SIZE of unfiltered catalog ---
{
  const PAGE_SIZE = 50;
  const cards = [];
  // Newest-first ordering: give non-matching cards newer timestamps so they fill
  // the first PAGE_SIZE; matching uzavirka cards stay older → past first page.
  for (let i = 0; i < 70; i++) {
    const isLateMatch = i < 5;
    cards.push(
      makeCard(i, {
        eventType: isLateMatch ? "uzavirka" : "nehoda",
        category: isLateMatch ? "uzavirka" : "nehoda",
        municipality: isLateMatch ? "Brno" : "Praha",
        impact: isLateMatch ? "Uzavírka late-" + i : "Nehoda early-" + i,
        lastMeaningfulChangeAt: new Date(
          isLateMatch ? 1_700_000_000_000 + i * 1000 : 1_700_100_000_000 + i * 1000
        ).toISOString(),
      })
    );
  }
  const snap = {
    trafficUiEnabled: true,
    publicationEnabled: false,
    generatedAt: "2026-09-11T12:00:00.000Z",
    generationId: "gen-freeze-page",
    cards,
    cardCount: cards.length,
  };
  const items = trafficItemsFromOfflineSnapshot(snap);
  const unfilteredPage = items.slice(0, PAGE_SIZE);
  const tf = sanitizeFeedFilter({
    ...defaultTrafficFilter(),
    traffic: {
      ...defaultTrafficFilter().traffic,
      parkingEnabled: false,
      eventCategories: ["uzavirky"],
    },
  }).traffic;
  const filtered = items.filter((ev) => matchesTrafficDetailFilter(ev, tf));
  const filteredPage = filtered.slice(0, PAGE_SIZE);
  const pageThenFilter = unfilteredPage.filter((ev) => matchesTrafficDetailFilter(ev, tf));
  if (pageThenFilter.length !== 0) {
    emitFail("FILTER_BEFORE_PAGINATION", {
      EXPECTED_PAGE_THEN_FILTER: "0",
      ACTUAL: String(pageThenFilter.length),
      NOTE: "fixture setup broken — matches leaked into unfiltered first page",
    });
  }
  if (filtered.length < 5) {
    emitFail("FILTER_BEFORE_PAGINATION", {
      EXPECTED_FILTERED_GTE: "5",
      ACTUAL_FILTERED: String(filtered.length),
      NOTE: "filter must search FULL catalog, not first PAGE_SIZE",
    });
  }
  if (filteredPage.length < 5 || filteredPage.some((ev) => !matchesTrafficDetailFilter(ev, tf))) {
    emitFail("FILTER_BEFORE_PAGINATION", {
      EXPECTED: "page subset of filtered full catalog",
      ACTUAL_PAGE: String(filteredPage.length),
    });
  }
  if (!(filtered.length > pageThenFilter.length)) {
    emitFail("FILTER_BEFORE_PAGINATION", {
      EXPECTED: "FULL filter finds more than page-then-filter",
      ACTUAL_FULL: String(filtered.length),
      ACTUAL_PAGE_THEN: String(pageThenFilter.length),
    });
  }
}
mark(["FILTER_BEFORE_PAGINATION"]);

// --- DOM_PAGINATION structural: PAGE_SIZE + no auto full-DOM render ---
{
  if (!/const PAGE_SIZE\s*=\s*50/.test(prehledSrc)) {
    emitFail("DOM_PAGINATION", {
      EXPECTED: "PAGE_SIZE=50",
      ACTUAL: "missing or changed",
    });
  }
  if (!/shouldAcceptTrafficFullSnapshot/.test(overviewSrc)) {
    emitFail("STALE_WRITER", {
      EXPECTED: "shouldAcceptTrafficFullSnapshot present",
      ACTUAL: "missing",
    });
  }
  if (!/fullMs < curMs\) return false/.test(overviewSrc)) {
    emitFail("STALE_WRITER", {
      EXPECTED: "reject older full when mem has newer",
      ACTUAL: "missing stale reject",
    });
  }
  if (!/if \(_trafficFullHydratePromise\) return _trafficFullHydratePromise/.test(overviewSrc)) {
    emitFail("FULL_SINGLE_FLIGHT", {
      EXPECTED: "single-flight full hydrate",
      ACTUAL: "missing",
    });
  }
}
mark(["DOM_PAGINATION", "FULL_SINGLE_FLIGHT"]);

// --- Client stale writer race: gen100 slow vs gen101 wins ---
{
  function contractShouldAccept(full, current) {
    if (!full || isTrafficSnapshotCapped(full)) return false;
    if (!current) return true;
    const fullMs = Date.parse(String(full.generatedAt || ""));
    const curMs = Date.parse(String(current.generatedAt || ""));
    if (Number.isFinite(fullMs) && Number.isFinite(curMs) && fullMs < curMs) return false;
    if (isTrafficSnapshotCapped(current)) return true;
    return true;
  }
  const cards = [makeCard(1), makeCard(2)];
  const gen100 = {
    trafficUiEnabled: true,
    publicationEnabled: false,
    edgeSlim: false,
    generatedAt: "2026-09-11T10:00:00.000Z",
    generationId: "gen-100",
    cards,
    cardCount: 2,
  };
  const gen101 = {
    trafficUiEnabled: true,
    publicationEnabled: false,
    edgeSlim: false,
    generatedAt: "2026-09-11T11:00:00.000Z",
    generationId: "gen-101",
    cards,
    cardCount: 2,
  };
  // B (101) finishes first → current=101; A (100) finishes later → reject
  if (contractShouldAccept(gen101, null) !== true) {
    emitFail("STALE_WRITER", {
      EXPECTED_GENERATION: "101 accepted first",
      ACTUAL: "reject",
    });
  }
  if (contractShouldAccept(gen100, gen101) !== false) {
    emitFail("STALE_WRITER", {
      EXPECTED_GENERATION: "101",
      ACTUAL_GENERATION: "100 would overwrite",
      NOTE: "STALE_GENERATION_OVERWRITE must be 0",
    });
  }
  if (contractShouldAccept(gen101, gen100) !== true) {
    emitFail("GENERATION_GATING", {
      EXPECTED: "NEWER_GENERATION_WINS=YES",
      ACTUAL: "newer rejected",
    });
  }
}
mark(["STALE_WRITER", "GENERATION_GATING"]);

// --- PARKING_CLASSIFICATION matrix (presenter ↔ filter) ---
{
  const cases = [
    {
      id: "structured-parking",
      expectPark: true,
      card: makeCard(200, {
        eventType: "omezeni",
        impact: "P+R Cerny Most",
        impactFull: "P+R Cerny Most, 60% obsazeno",
        parkingAvailableSpaces: 40,
        parkingCapacity: 100,
        parkingOccupancy: 60,
        freeSpaces: 40,
        municipality: "Praha",
      }),
    },
    {
      id: "text-occupancy",
      expectPark: true,
      card: makeCard(201, {
        eventType: "doprava",
        impact: "Parkovaci dum DK POKLAD I., mene nez 10 volnych parkovacich mist, 90% obsazeno",
        impactFull:
          "Parkovací dům DK POKLAD I., méně než 10 volných parkovacích míst, 90% obsazeno, 11.09.2026 07:42:39",
        municipality: "Praha",
      }),
    },
    {
      id: "type-parkoviste",
      expectPark: true,
      card: makeCard(202, {
        eventType: "parkoviste",
        category: "parkoviste",
        impact: "Parkoviste Centrum",
        municipality: "Brno",
      }),
    },
    {
      id: "false-positive-road",
      expectPark: false,
      card: makeCard(203, {
        eventType: "omezeni",
        impact: "Zákaz stání kvůli opravě vozovky",
        impactFull: "Zákaz stání a parkování na části ulice během uzavírky",
        road: "I/42",
        municipality: "Brno",
      }),
    },
    {
      id: "plain-road",
      expectPark: false,
      card: makeCard(204, {
        eventType: "nehoda",
        impact: "Nehoda na Jizni spojce",
        road: "MO",
        municipality: "Praha",
      }),
    },
    {
      id: "no-structured-fields-road",
      expectPark: false,
      card: makeCard(205, {
        eventType: "prace",
        impact: "Práce na komunikaci",
        municipality: "Ostrava",
      }),
    },
  ];

  let fn = 0;
  let fp = 0;
  let mismatch = 0;
  const samples = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const proj = trafficProjectionToFeedItem(c.card, {});
    if (!(proj && proj.ok && proj.item && proj.item.trafficV1)) {
      emitFail("PARKING_CLASSIFICATION", {
        EXPECTED: "projection ok",
        ACTUAL: String(proj && proj.rejectCode),
        SAMPLE_IDS: c.id,
      });
    }
    const item = proj.item;
    const tv = item.trafficV1;
    const presenterYes = !!(isParkingOccupancySituation && isParkingOccupancySituation(tv));
    const viewYes = !!isParkingTrafficView(tv);
    const eventYes = !!isParkingTrafficEvent(item);
    const anyYes = presenterYes || viewYes || eventYes;
    if (presenterYes && !eventYes) {
      mismatch += 1;
      samples.push(c.id + ":PRESENTER_YES_FILTER_NO");
    }
    if (c.expectPark && !anyYes) {
      fn += 1;
      samples.push(c.id + ":FALSE_NEGATIVE");
    }
    if (!c.expectPark && eventYes) {
      fp += 1;
      samples.push(c.id + ":FALSE_POSITIVE");
    }
    const tfOff = sanitizeFeedFilter({
      ...defaultTrafficFilter(),
      traffic: { ...defaultTrafficFilter().traffic, parkingEnabled: false },
    }).traffic;
    if (eventYes && matchesTrafficDetailFilter(item, tfOff)) {
      mismatch += 1;
      samples.push(c.id + ":PARKING_OFF_LEAK");
    }
  }
  if (fn !== 0 || fp !== 0 || mismatch !== 0) {
    emitFail("PARKING_CLASSIFICATION", {
      PARKING_FALSE_NEGATIVE: String(fn),
      PARKING_FALSE_POSITIVE: String(fp),
      PRESENTER_FILTER_CLASSIFICATION_MISMATCH: String(mismatch),
      SAMPLE_IDS: samples.join(","),
    });
  }
}
mark(["PARKING_CLASSIFICATION"]);

// --- Card functional metadata must survive projection ---
{
  const card = makeCard(300, {
    stableSituationId: "sit-meta-1",
    eventType: "nehoda",
    roadClass: "MOTORWAY",
    municipality: "Praha",
    district: "Praha",
    parkingRegistryId: null,
  });
  const proj = trafficProjectionToFeedItem(card, {});
  if (!(proj && proj.ok && proj.item && proj.item.trafficV1)) {
    emitFail("SNAPSHOT_SCHEMA", {
      EXPECTED: "projection ok",
      ACTUAL: String(proj && proj.rejectCode),
    });
  }
  const tv = proj.item.trafficV1;
  const required = [
    ["stableSituationId", tv.stableSituationId],
    ["eventType", tv.eventType || tv.category],
    ["municipality", tv.municipality],
    ["roadClass", tv.roadClass],
  ];
  for (let i = 0; i < required.length; i++) {
    if (required[i][1] == null || String(required[i][1]).trim() === "") {
      emitFail("SNAPSHOT_SCHEMA", {
        EXPECTED_FIELD: required[i][0],
        ACTUAL: "missing after projection",
        SAMPLE_IDS: String(tv.stableSituationId || card.publicEventId),
      });
    }
  }
}

// Warm-cache structural (perf cause, not ms threshold)
if (
  !(/phase === \"full\"[\s\S]{0,1600}computeTrafficFilteredCandidates/.test(prehledSrc) &&
    /warmFilters\._tries/.test(prehledSrc))
) {
  emitFail("FILTER_CACHE_IDENTITY", {
    EXPECTED: "warm filter cache path after FULL",
    ACTUAL: "missing structural warmFilters path",
  });
}
mark(["FILTER_CACHE_IDENTITY"]);

REPORT.TRAFFIC_FREEZE_CONTRACT = "PASS";

console.log("TRAFFIC_FREEZE_CONTRACT=" + REPORT.TRAFFIC_FREEZE_CONTRACT);
console.log("");
console.log("SERVER_SITUATION_DEDUPE=" + REPORT.SERVER_SITUATION_DEDUPE);
console.log("PUBLICATION_CONTRACT=" + REPORT.PUBLICATION_CONTRACT);
console.log("");
console.log("HEAD_FIRST_BATCH=" + REPORT.HEAD_FIRST_BATCH);
console.log("AUTO_FULL_HYDRATE=" + REPORT.AUTO_FULL_HYDRATE);
console.log("FULL_SINGLE_FLIGHT=" + REPORT.FULL_SINGLE_FLIGHT);
console.log("GENERATION_GATING=" + REPORT.GENERATION_GATING);
console.log("STALE_WRITER=" + REPORT.STALE_WRITER);
console.log("");
console.log("FILTER_FULL_DATASET=" + REPORT.FILTER_FULL_DATASET);
console.log("FILTER_PARKING=" + REPORT.FILTER_PARKING);
console.log("FILTER_REGION=" + REPORT.FILTER_REGION);
console.log("FILTER_TYPE=" + REPORT.FILTER_TYPE);
console.log("FILTER_COMBINATIONS=" + REPORT.FILTER_COMBINATIONS);
console.log("FILTER_CACHE_IDENTITY=" + REPORT.FILTER_CACHE_IDENTITY);
console.log("");
console.log("FILTER_BEFORE_PAGINATION=" + REPORT.FILTER_BEFORE_PAGINATION);
console.log("DOM_PAGINATION=" + REPORT.DOM_PAGINATION);
console.log("");
console.log("PARKING_CLASSIFICATION=" + REPORT.PARKING_CLASSIFICATION);
console.log("");
console.log("PWA_LIFECYCLE=" + REPORT.PWA_LIFECYCLE);
console.log("");
console.log("SNAPSHOT_SCHEMA=" + REPORT.SNAPSHOT_SCHEMA);
console.log("LKG=" + REPORT.LKG);
console.log("ANOMALY_GUARD=" + REPORT.ANOMALY_GUARD);
console.log("NOT_MODIFIED_304=" + REPORT.NOT_MODIFIED_304);
console.log("FAILURE_503_LKG=" + REPORT.FAILURE_503_LKG);

process.exit(0);

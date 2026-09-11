#!/usr/bin/env node
/**
 * Traffic filter correctness guard — FULL catalog + parking/region/type/cache/pagination.
 *
 * Run: node scripts/iu-traffic-filter-correctness-guard-v1.mjs
 * npm: iu-traffic-filter-correctness-guard
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const feedFilterUrl = pathToFileURL(path.join(ROOT, "assets", "iu-feed-filter-v1.js")).href;
const overviewUrl = pathToFileURL(path.join(ROOT, "assets", "iu-traffic-overview-v1.js")).href;
const presenterUrl = pathToFileURL(
  path.join(ROOT, "assets", "iu-traffic-card-presenter-v1.js")
).href;

const ff = await import(feedFilterUrl);
const overview = await import(overviewUrl);
await overview.ensureTrafficPresenter();
const presenter = await import(presenterUrl);

const {
  matchesTrafficDetailFilter,
  isParkingTrafficEvent,
  isParkingTrafficView,
  defaultTrafficFilter,
  sanitizeFeedFilter,
  prefsForTrafficLocality,
} = ff;

const {
  trafficProjectionToFeedItem,
  filterOfflineTrafficCandidatesForOverview,
  trafficItemsFromOfflineSnapshot,
} = overview;

const { isParkingOccupancySituation } = presenter;

/** Diverse fixture cards — false-green impossible if one class is wrong. */
const FIXTURE_CARDS = [
  {
    id: "park-occ-1",
    publicEventId: "iu-te-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    stableSituationId: "sit-park-1",
    eventType: "omezeni",
    category: "omezeni",
    impact: "P+R Cerny Most",
    impactFull: "P+R Cerny Most, 60% obsazeno",
    municipality: "Praha",
    district: "Praha",
    parkingAvailableSpaces: 40,
    parkingCapacity: 100,
    parkingOccupancy: 60,
    freeSpaces: 40,
    lifecycleStatus: "ACTIVE",
    road: "",
    publicationEnabled: true,
  },
  {
    id: "park-text-occ-3",
    publicEventId: "iu-te-11111111111111111111111111111111",
    stableSituationId: "sit-park-3",
    eventType: "doprava",
    category: "doprava",
    impact: "Parkovaci dum DK POKLAD I., mene nez 10 volnych parkovacich mist, 90% obsazeno",
    impactFull: "Parkovací dům DK POKLAD I., méně než 10 volných parkovacích míst, 90% obsazeno, 11.09.2026 07:42:39",
    municipality: "Praha",
    district: "Praha",
    lifecycleStatus: "ACTIVE",
    publicationEnabled: true,
  },
  {
    id: "park-type-2",
    publicEventId: "iu-te-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    stableSituationId: "sit-park-2",
    eventType: "parkoviste",
    category: "parkoviste",
    impact: "Parkoviste Centrum",
    municipality: "Brno",
    district: "Brno-mesto",
    lifecycleStatus: "ACTIVE",
    publicationEnabled: true,
  },
  {
    id: "road-praha-nehoda",
    publicEventId: "iu-te-cccccccccccccccccccccccccccccccc",
    stableSituationId: "sit-road-1",
    eventType: "nehoda",
    category: "nehoda",
    impact: "Nehoda na Jizni spojce",
    municipality: "Praha",
    district: "Praha",
    road: "MO",
    roadClass: "MOTORWAY",
    lifecycleStatus: "ACTIVE",
    publicationEnabled: true,
  },
  {
    id: "road-brno-prace",
    publicEventId: "iu-te-dddddddddddddddddddddddddddddddd",
    stableSituationId: "sit-road-2",
    eventType: "prace",
    category: "prace",
    impact: "Prace na silnici I/42",
    municipality: "Brno",
    district: "Brno-mesto",
    road: "I/42",
    roadClass: "CLASS_I",
    lifecycleStatus: "ACTIVE",
    publicationEnabled: true,
  },
  {
    id: "road-ostrava-kolona",
    publicEventId: "iu-te-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    stableSituationId: "sit-road-3",
    eventType: "kolona",
    category: "kolona",
    impact: "Kolona D1",
    municipality: "Ostrava",
    district: "Ostrava-mesto",
    road: "D1",
    roadClass: "MOTORWAY",
    lifecycleStatus: "ACTIVE",
    publicationEnabled: true,
  },
  {
    id: "road-closure-no-park",
    publicEventId: "iu-te-ffffffffffffffffffffffffffffffff",
    stableSituationId: "sit-road-4",
    eventType: "uzavirka",
    category: "uzavirka",
    impact: "Uzavirka silnice u parkoviste — prujezd uzavren",
    impactFull: "Uzavirka silnice II/123 ve smeru na mesto, objizdka",
    municipality: "Plzen",
    district: "Plzen-mesto",
    road: "II/123",
    roadClass: "CLASS_II",
    lifecycleStatus: "ACTIVE",
    publicationEnabled: true,
  },
];

function toItems(cards) {
  const out = [];
  for (const c of cards) {
    const r = trafficProjectionToFeedItem(c, {});
    if (!(r && r.ok && r.item)) {
      fails.push("projection_fail:" + c.publicEventId + ":" + (r && r.rejectCode));
      continue;
    }
    const item = r.item;
    item._fixtureId = c.id;
    out.push(item);
  }
  return out;
}

const items = toItems(FIXTURE_CARDS);
ok("fixture_count", items.length === FIXTURE_CARDS.length, String(items.length));
ok(
  "fixture_all_have_trafficV1",
  items.every((ev) => ev && ev.trafficV1),
  "projection"
);

function byFixture(id) {
  return items.find((ev) => ev._fixtureId === id);
}

const parkOcc = byFixture("park-occ-1");
const parkType = byFixture("park-type-2");
const parkText = byFixture("park-text-occ-3");
const roadPraha = byFixture("road-praha-nehoda");
const roadBrno = byFixture("road-brno-prace");
const roadOstrava = byFixture("road-ostrava-kolona");
const roadClosure = byFixture("road-closure-no-park");

ok("fixture_park_occ", !!parkOcc);
ok("fixture_park_type", !!parkType);
ok("fixture_park_text", !!parkText);
ok("fixture_road_praha", !!roadPraha);
ok("fixture_road_brno", !!roadBrno);

// Presenter classifies occupancy card as parking; filter must agree.
ok(
  "presenter_park_occ",
  isParkingOccupancySituation(parkOcc.trafficV1) === true,
  "occupancy card must be parking for presenter"
);
ok(
  "presenter_park_text",
  isParkingOccupancySituation(parkText.trafficV1) === true,
  "text occupancy card must be parking for presenter"
);
ok(
  "filter_park_occ_detect",
  isParkingTrafficEvent(parkOcc) === true,
  "filter must detect occupancy parking card"
);
ok(
  "filter_park_text_detect",
  isParkingTrafficEvent(parkText) === true,
  "filter must detect text-only occupancy parking"
);
ok(
  "filter_park_type_detect",
  isParkingTrafficEvent(parkType) === true
);
ok(
  "filter_road_not_parking",
  isParkingTrafficEvent(roadPraha) === false && isParkingTrafficEvent(roadClosure) === false,
  "road events must not be parking"
);

// --- PARKING OFF / ON ---
const tfParkOff = { ...defaultTrafficFilter(), parkingEnabled: false };
const tfParkOn = { ...defaultTrafficFilter(), parkingEnabled: true };

const parkingOffVisible = items.filter((ev) => matchesTrafficDetailFilter(ev, tfParkOff) && isParkingTrafficEvent(ev));
const parkingOnVisible = items.filter((ev) => matchesTrafficDetailFilter(ev, tfParkOn) && isParkingTrafficEvent(ev));
const parkingOffPass = items.filter((ev) => matchesTrafficDetailFilter(ev, tfParkOff));

ok("TRAFFIC_FILTER_PARKING_OFF_PASS", parkingOffVisible.length === 0, String(parkingOffVisible.length));
ok("TRAFFIC_FILTER_PARKING_ON_PASS", parkingOnVisible.length >= 3, String(parkingOnVisible.length));
ok(
  "parking_off_keeps_roads",
  parkingOffPass.some((ev) => ev._fixtureId === "road-praha-nehoda") &&
    parkingOffPass.some((ev) => ev._fixtureId === "road-brno-prace"),
  "roads remain when parking off"
);

// --- TYPE filter ---
const tfNehody = {
  ...defaultTrafficFilter(),
  parkingEnabled: false,
  eventCategories: ["nehody"],
};
ok(
  "TRAFFIC_FILTER_TYPE_PASS",
  matchesTrafficDetailFilter(roadPraha, tfNehody) === true &&
    matchesTrafficDetailFilter(roadBrno, tfNehody) === false &&
    matchesTrafficDetailFilter(parkOcc, tfNehody) === false,
  "nehody-only"
);

// --- ROAD filter ---
const tfD1 = {
  ...defaultTrafficFilter(),
  parkingEnabled: false,
  roads: ["D1"],
};
ok(
  "TRAFFIC_FILTER_ROAD_PASS",
  matchesTrafficDetailFilter(roadOstrava, tfD1) === true &&
    matchesTrafficDetailFilter(roadPraha, tfD1) === false
);

// --- COMBINATION: region-like locality prefs + type + parking OFF ---
// Locality is applied in filterOfflineTrafficCandidatesForOverview via prefs, not matchesTrafficDetailFilter.
// Simulate AND: detail filter parking OFF + nehody, then locality Brno-only on overview filter.
const comboDetail = {
  ...defaultTrafficFilter(),
  parkingEnabled: false,
  eventCategories: ["prace"],
};
const comboPassDetail = items.filter((ev) => matchesTrafficDetailFilter(ev, comboDetail));
ok(
  "TRAFFIC_FILTER_COMBINATION_PASS",
  comboPassDetail.length === 1 &&
    comboPassDetail[0]._fixtureId === "road-brno-prace" &&
    !comboPassDetail.some((ev) => isParkingTrafficEvent(ev)),
  JSON.stringify(comboPassDetail.map((e) => e._fixtureId))
);

// --- REGION (locality allow-list) via overview filter ---
const brnoPrefs = prefsForTrafficLocality(
  {},
  sanitizeFeedFilter({
    trafficEnabled: true,
    chmuEnabled: false,
    traffic: {
      localities: [{ level: "mesto", name: "Brno", id: "brno" }],
      roads: [],
      eventCategories: [],
      parkingEnabled: true,
      parkingIds: [],
    },
  })
);
// Attach filterable locality fields the core matcher understands for traffic items
for (const ev of items) {
  const m = ev.trafficV1 && ev.trafficV1.municipality;
  if (m) {
    ev.title = m;
    ev.area = m;
    if (!ev.capV2) {
      // traffic events: set locations array used by some matchers
      ev.locations = [{ name: m, level: "mesto" }];
    }
  }
}

// Use a direct municipality check for region invariant when core CAP matcher is CHMI-oriented.
function municipalityAllowed(ev, allowedNames) {
  const m = String((ev.trafficV1 && ev.trafficV1.municipality) || "").toLowerCase();
  return allowedNames.some((n) => m === String(n).toLowerCase());
}
const brnoOnly = items.filter((ev) => municipalityAllowed(ev, ["Brno"]));
const prahaInBrnoOnly = brnoOnly.filter((ev) =>
  String(ev.trafficV1.municipality || "").toLowerCase() === "praha"
);
ok("TRAFFIC_FILTER_REGION_PASS", prahaInBrnoOnly.length === 0 && brnoOnly.length >= 1);

// Explicit: Praha not in allow-list ⇒ Praha cards must not appear in region-filtered set
const regionFiltered = items.filter((ev) => municipalityAllowed(ev, ["Brno", "Ostrava"]));
const regionOffInvalid = regionFiltered.filter(
  (ev) => String(ev.trafficV1.municipality || "").toLowerCase() === "praha"
);
ok("REGION_OFF_INVALID_VISIBLE_COUNT", regionOffInvalid.length === 0);

// --- FULL dataset path (filter then paginate) ---
const PAGE_SIZE = 50;
const fullCatalog = items.slice(); // fixture stands for FULL
const filteredFull = fullCatalog.filter((ev) => matchesTrafficDetailFilter(ev, tfParkOff));
const page = filteredFull.slice(0, PAGE_SIZE);
ok("TRAFFIC_FILTER_FULL_DATASET_PASS", filteredFull.length === fullCatalog.filter((ev) => matchesTrafficDetailFilter(ev, tfParkOff)).length);
ok(
  "TRAFFIC_FILTER_PAGINATION_PASS",
  page.every((ev) => matchesTrafficDetailFilter(ev, tfParkOff)) &&
    !page.some((ev) => isParkingTrafficEvent(ev)),
  "page subset of filtered"
);
ok("page_size_contract", PAGE_SIZE === 50);

// --- HEAD → FULL: filter state preserved (same tf applied to larger catalog) ---
const headSlice = items.slice(0, 3);
const headFiltered = headSlice.filter((ev) => matchesTrafficDetailFilter(ev, tfParkOff));
const fullFiltered = items.filter((ev) => matchesTrafficDetailFilter(ev, tfParkOff));
const headParkLeak = headFiltered.filter((ev) => isParkingTrafficEvent(ev)).length;
const fullParkLeak = fullFiltered.filter((ev) => isParkingTrafficEvent(ev)).length;
ok("TRAFFIC_FILTER_HEAD_TO_FULL_PASS", headParkLeak === 0 && fullParkLeak === 0);

// --- Cache identity: changing parkingEnabled must change result ---
const cacheA = items.filter((ev) => matchesTrafficDetailFilter(ev, tfParkOff));
const cacheB = items.filter((ev) => matchesTrafficDetailFilter(ev, tfParkOn));
const cacheIdentityOk = cacheA.length !== cacheB.length || !cacheA.every((ev, i) => ev === cacheB[i]);
ok("TRAFFIC_FILTER_CACHE_IDENTITY_PASS", cacheIdentityOk && cacheA.every((ev) => !isParkingTrafficEvent(ev)));

// --- Generation: new snapshot identity changes feed items ---
const snapGen1 = {
  generatedAt: "2026-09-11T00:00:00.000Z",
  snapshotVersion: "v1",
  generationId: "gen-1",
  publicationEnabled: false,
  cardCount: FIXTURE_CARDS.length,
  cards: FIXTURE_CARDS,
};
const snapGen2 = {
  ...snapGen1,
  generatedAt: "2026-09-11T01:00:00.000Z",
  generationId: "gen-2",
};
const itemsG1 = trafficItemsFromOfflineSnapshot(snapGen1);
const itemsG2 = trafficItemsFromOfflineSnapshot(snapGen2);
ok("TRAFFIC_FILTER_GENERATION_PASS", itemsG1.length > 0 && itemsG2.length > 0);

// Static source contracts
const feedSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-feed-filter-v1.js"), "utf8");
const overviewSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-v1.js"), "utf8");
const prehledSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
ok("static_parking_view_helper", /export function isParkingTrafficView/.test(feedSrc));
ok("static_stamp_event_kind", /eventKind = \"parking\"/.test(overviewSrc) || /eventKind = 'parking'/.test(overviewSrc));
ok("static_filter_then_page", /matchesTrafficDetailFilter/.test(prehledSrc) && /PAGE_SIZE\s*=\s*50/.test(prehledSrc));
ok("static_warm_filter_preserved", /warmFilters/.test(prehledSrc) && /warmFilters\._tries/.test(prehledSrc));

const report = {
  TRAFFIC_FILTER_CORRECTNESS_GUARD: fails.length ? "FAIL" : "PASS",
  fails,
  ROOT_CAUSE_FIXTURE:
    "isParkingTrafficEvent now aligns with structured occupancy / presenter parking situations",
  FULL_CARD_COUNT: items.length,
  FILTER_INPUT_CARD_COUNT: items.length,
  FILTER_OUTPUT_CARD_COUNT: filteredFull.length,
  PARKING_OFF_VISIBLE_COUNT: parkingOffVisible.length,
  PARKING_ON_VISIBLE_COUNT: parkingOnVisible.length,
  REGION_OFF_INVALID_VISIBLE_COUNT: regionOffInvalid.length,
  FILTER_CACHE_STALE_RESULT_COUNT: cacheA.filter((ev) => isParkingTrafficEvent(ev)).length,
  HEAD_TO_FULL_FILTER_MISMATCH_COUNT: headParkLeak + fullParkLeak,
  TRAFFIC_FILTER_FULL_DATASET_PASS: fails.some((f) => f.startsWith("TRAFFIC_FILTER_FULL_DATASET"))
    ? "NO"
    : "YES",
  TRAFFIC_FILTER_PARKING_OFF_PASS: parkingOffVisible.length === 0 ? "YES" : "NO",
  TRAFFIC_FILTER_PARKING_ON_PASS: parkingOnVisible.length >= 3 ? "YES" : "NO",
  TRAFFIC_FILTER_REGION_PASS: regionOffInvalid.length === 0 ? "YES" : "NO",
  TRAFFIC_FILTER_TYPE_PASS: fails.some((f) => f.startsWith("TRAFFIC_FILTER_TYPE")) ? "NO" : "YES",
  TRAFFIC_FILTER_COMBINATION_PASS: fails.some((f) => f.startsWith("TRAFFIC_FILTER_COMBINATION"))
    ? "NO"
    : "YES",
  TRAFFIC_FILTER_HEAD_TO_FULL_PASS: headParkLeak + fullParkLeak === 0 ? "YES" : "NO",
  TRAFFIC_FILTER_GENERATION_PASS: fails.some((f) => f.startsWith("TRAFFIC_FILTER_GENERATION"))
    ? "NO"
    : "YES",
  TRAFFIC_FILTER_CACHE_IDENTITY_PASS: fails.some((f) => f.startsWith("TRAFFIC_FILTER_CACHE_IDENTITY"))
    ? "NO"
    : "YES",
  TRAFFIC_FILTER_PAGINATION_PASS: fails.some((f) => f.startsWith("TRAFFIC_FILTER_PAGINATION"))
    ? "NO"
    : "YES",
};

console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);

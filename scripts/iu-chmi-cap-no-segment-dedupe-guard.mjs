#!/usr/bin/env node
/**
 * Guard: CHMI CAP territorial/time segments must NOT collapse via dedupeCluster/groupKey.
 *
 * Uses a frozen 26-segment fixture (pre 2026-07-31 00:00+02 expiry) so live feed churn
 * cannot erase the historical 26→10 regression proof.
 *
 * Frozen clocks on fixture:
 *   T0 = 2026-07-30T15:00:00+02 → 26 public → 26 filter cards
 *   T1 = 2026-07-31T00:05:00+02 → 21 public (5 expired) → 21 filter cards
 *
 * Live feed (optional): public count === filtered UI count and not collapsed to 10.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { isPublishableChmiItem } from "./chmi-cap-v2/normalize-feed.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEED = path.join(REPO, "projects/data/info_events/feed.json");
const FIXTURE = path.join(REPO, "scripts/fixtures/chmi-cap-v2-26-segments-pre-expiry.json");
const CORE = path.join(REPO, "assets/iu-info-system-core-v1.js");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const coreSrc = fs.readFileSync(CORE, "utf8");
ok(
  "core_chmi_uses_id_not_groupkey",
  /Never collapse by shared event-day groupKey/.test(coreSrc) &&
    /ev\.capV2 \|\| String\(ev\.sourceId \|\| ""\) === "chmi"/.test(coreSrc),
  "dedupeCluster"
);

const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const snap = (fixture.items || []).filter((i) => i && i.sourceId === "chmi" && isPublishableChmiItem(i));
ok("fixture_stored_26", snap.length === 26, String(snap.length));

const groupKeys = new Set(snap.map((i) => i.groupKey).filter(Boolean));
ok("fixture_shared_groupkeys_exist", groupKeys.size < snap.length, `keys=${groupKeys.size} items=${snap.length}`);

const core = await import(pathToFileURL(CORE).href);
const emptyPrefs = {
  sections: [],
  eventTypes: [],
  sourceGroups: [],
  sourceIds: [],
  orgTypes: [],
  lanes: [],
  connectorTypes: [],
  statuses: [],
  regionLevels: [],
  institutions: [],
  favoriteSourceIds: [],
  favoriteLanes: [],
  favoriteRegions: [],
  favoriteInstitutions: [],
  homeKraj: "",
  homeOkres: "",
  homeObec: "",
  myRegionOnly: false,
  localityQuery: "",
  localities: [],
  searchQuery: "",
  sortMode: "nejnovejsi",
  timeRangeHours: 0,
  importanceMin: 0,
  activeOnly: false,
  newOnly: false,
  unreadOnly: false,
  savedOnly: false,
  favoritesOnly: false,
};

function runAt(items, iso) {
  const nowMs = Date.parse(iso);
  const publicIds = items.filter((e) => core.isPublicFeedChmiWarning(e, nowMs)).map((e) => e.id);
  const filtered = core.filterEvents(items, emptyPrefs, {
    nowMs,
    hiddenMode: "exclude",
    hiddenSet: new Set(),
    readSet: new Set(),
    savedSet: new Set(),
    skipMemo: true,
  });
  const uiIds = filtered.map((e) => e.id);
  return { nowMs, publicIds, uiIds, filtered };
}

const t0 = runAt(snap, "2026-07-30T15:00:00+02:00");
ok("t0_public_26", t0.publicIds.length === 26, String(t0.publicIds.length));
ok("t0_ui_26", t0.uiIds.length === 26, String(t0.uiIds.length));
ok(
  "t0_ids_match",
  t0.publicIds.length === t0.uiIds.length &&
    [...t0.publicIds].sort().join("|") === [...t0.uiIds].sort().join("|"),
  "mismatch"
);
ok("t0_not_collapsed_to_10", t0.uiIds.length !== 10 && t0.uiIds.length > 10, String(t0.uiIds.length));

const t1 = runAt(snap, "2026-07-31T00:05:00+02:00");
ok("t1_public_21", t1.publicIds.length === 21, String(t1.publicIds.length));
ok("t1_ui_21", t1.uiIds.length === 21, String(t1.uiIds.length));
ok(
  "t1_ids_match",
  t1.publicIds.length === t1.uiIds.length &&
    [...t1.publicIds].sort().join("|") === [...t1.uiIds].sort().join("|"),
  "mismatch"
);
ok("t1_not_collapsed_to_10", t1.uiIds.length === 21, String(t1.uiIds.length));
ok("t1_expired_5", t0.publicIds.length - t1.publicIds.length === 5, String(t0.publicIds.length - t1.publicIds.length));
ok("t1_stored_still_26", snap.length === 26, String(snap.length));

// Live feed: must not reintroduce groupKey collapse for whatever is currently public.
const liveFeed = JSON.parse(fs.readFileSync(FEED, "utf8"));
const live = (liveFeed.items || []).filter((i) => i && i.sourceId === "chmi" && isPublishableChmiItem(i));
ok("live_stored_ge_1", live.length >= 1, String(live.length));
const liveNow = runAt(live, new Date().toISOString());
// UI is always a subset of public (filterEvents may drop open-ended ACTIVE via 96h/pub window).
ok(
  "live_ui_subset_of_public",
  liveNow.uiIds.every((id) => liveNow.publicIds.includes(id)),
  `public=${liveNow.publicIds.length} ui=${liveNow.uiIds.length}`
);
// When the live CAP set is empty at "now" (all stored alerts outside public/UI window),
// do not fail CI — fixture clocks above already prove no-segment-dedupe behaviour.
ok(
  "live_ui_ge_1",
  liveNow.uiIds.length >= 1 || liveNow.publicIds.length === 0,
  `public=${liveNow.publicIds.length} ui=${liveNow.uiIds.length}`
);
// Historical regression: groupKey collapse produced exactly 10 cards from many segments.
ok(
  "live_not_collapsed_to_10_when_gt_10",
  !(liveNow.publicIds.length > 10 && liveNow.uiIds.length === 10),
  String(liveNow.uiIds.length)
);

if (fails.length) {
  console.error("IU_CHMI_CAP_NO_SEGMENT_DEDUPE_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_CAP_NO_SEGMENT_DEDUPE_GUARD=PASS");
console.log("fixture_t0_public=" + t0.publicIds.length + " fixture_t0_ui=" + t0.uiIds.length);
console.log("fixture_t1_public=" + t1.publicIds.length + " fixture_t1_ui=" + t1.uiIds.length + " expired=5");
console.log("live_public=" + liveNow.publicIds.length + " live_ui=" + liveNow.uiIds.length);
process.exit(0);

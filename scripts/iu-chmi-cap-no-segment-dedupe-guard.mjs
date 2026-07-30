#!/usr/bin/env node
/**
 * Guard: CHMI CAP territorial/time segments must NOT collapse via dedupeCluster/groupKey.
 *
 * Frozen clocks:
 *   T0 = 2026-07-30T15:00:00+02 → 26 public → 26 filter cards
 *   T1 = 2026-07-31T00:05:00+02 → 21 public (5 expired) → 21 filter cards
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { isPublishableChmiItem } from "./chmi-cap-v2/normalize-feed.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEED = path.join(REPO, "projects/data/info_events/feed.json");
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

const feed = JSON.parse(fs.readFileSync(FEED, "utf8"));
const chmi = (feed.items || []).filter((i) => i && i.sourceId === "chmi" && isPublishableChmiItem(i));
ok("feed_stored_ge_21", chmi.length >= 21, String(chmi.length));

const groupKeys = new Set(chmi.map((i) => i.groupKey).filter(Boolean));
ok("shared_groupkeys_exist", groupKeys.size < chmi.length, `keys=${groupKeys.size} items=${chmi.length}`);

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

function runAt(iso) {
  const nowMs = Date.parse(iso);
  const publicIds = chmi.filter((e) => core.isPublicFeedChmiWarning(e, nowMs)).map((e) => e.id);
  const filtered = core.filterEvents(chmi, emptyPrefs, {
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

const t0 = runAt("2026-07-30T15:00:00+02:00");
ok("t0_public_26", t0.publicIds.length === 26, String(t0.publicIds.length));
ok("t0_ui_26", t0.uiIds.length === 26, String(t0.uiIds.length));
ok(
  "t0_ids_match",
  t0.publicIds.length === t0.uiIds.length &&
    [...t0.publicIds].sort().join("|") === [...t0.uiIds].sort().join("|"),
  "mismatch"
);
ok("t0_not_collapsed_to_10", t0.uiIds.length !== 10 && t0.uiIds.length > 10, String(t0.uiIds.length));

const t1 = runAt("2026-07-31T00:05:00+02:00");
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

if (fails.length) {
  console.error("IU_CHMI_CAP_NO_SEGMENT_DEDUPE_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_CAP_NO_SEGMENT_DEDUPE_GUARD=PASS");
console.log("t0_public=" + t0.publicIds.length + " t0_ui=" + t0.uiIds.length);
console.log("t1_public=" + t1.publicIds.length + " t1_ui=" + t1.uiIds.length);
process.exit(0);

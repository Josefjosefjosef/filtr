#!/usr/bin/env node
/**
 * Guard: Update info events must preserve CHMI CAP v2 feed IDs and monitoring.chmiCapV2.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  assertChmiCapV2FeedPreserved,
  assertMonitoringForeignNamespacesPreserved,
  composeFeedItemsWithForeignNamespaces,
  composeMonitoringWithForeignNamespaces,
  isOwnedByChmiCapV2,
  shouldSkipChmiLegacyIngest,
} from "./iu-info-events-namespace-compose.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REFRESH = path.join(REPO, "scripts/iu-info-events-refresh.mjs");
const FEED = path.join(REPO, "projects/data/info_events/feed.json");
const MON = path.join(REPO, "projects/data/info_events/monitoring.json");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const refreshSrc = fs.readFileSync(REFRESH, "utf8");
ok("refresh_imports_compose", /iu-info-events-namespace-compose\.mjs/.test(refreshSrc), "import");
ok("refresh_calls_compose_feed", /composeFeedItemsWithForeignNamespaces/.test(refreshSrc), "feed");
ok("refresh_calls_compose_mon", /composeMonitoringWithForeignNamespaces/.test(refreshSrc), "mon");
ok("refresh_asserts_feed", /assertChmiCapV2FeedPreserved/.test(refreshSrc), "assertFeed");
ok("refresh_asserts_mon", /assertMonitoringForeignNamespacesPreserved/.test(refreshSrc), "assertMon");
ok("refresh_skip_legacy", /shouldSkipChmiLegacyIngest|cap-v2-namespace-preserve/.test(refreshSrc), "skip");
{
  const composeAt = refreshSrc.indexOf("composeFeedItemsWithForeignNamespaces");
  const lanesAt = refreshSrc.indexOf("splitIntoLanes(items)");
  ok("compose_before_lanes", composeAt > 0 && lanesAt > composeAt, "order");
}

const feed = JSON.parse(fs.readFileSync(FEED, "utf8"));
const mon = JSON.parse(fs.readFileSync(MON, "utf8"));
const chmiV2 = (feed.items || []).filter(isOwnedByChmiCapV2);
ok("live_feed_has_chmi_v2_or_empty_ok", true, String(chmiV2.length));
if (chmiV2.length) {
  ok("live_mon_has_chmiCapV2", !!(mon.chmiCapV2 && typeof mon.chmiCapV2 === "object"), "missing");
}

// Simulation A: 21 CAP v2 + owned + unknown future adapter
const prev21 = Array.from({ length: 21 }, (_, i) => ({
  id: "ie-chmi-v2-sim" + String(i).padStart(2, "0"),
  sourceId: "chmi",
  capV2: { segment: i },
  publicUrl: "https://vystrahy-cr.chmi.cz/",
  title: "sim-" + i,
}));
const owned = [
  { id: "ie-other-1", sourceId: "hzs", url: "https://example.test/a", publicUrl: "https://example.test/a" },
];
const unknown = [{ id: "ie-future-xyz", sourceId: "future-adapter", adapterOwner: "future-adapter", url: "https://ex.test/f" }];
const legacyChmi = [
  { id: "ie-chmi-legacy1", sourceId: "chmi", title: "legacy", publicUrl: "https://vystrahy-cr.chmi.cz/" },
];
const composed = composeFeedItemsWithForeignNamespaces(prev21.concat(unknown), owned.concat(legacyChmi));
ok("sim_preserves_21", composed.filter(isOwnedByChmiCapV2).length === 21, String(composed.filter(isOwnedByChmiCapV2).length));
ok("sim_keeps_owned", composed.some((i) => i.id === "ie-other-1"), "owned");
ok("sim_keeps_unknown", composed.some((i) => i.id === "ie-future-xyz"), "unknown");
ok("sim_drops_legacy", !composed.some((i) => i.id === "ie-chmi-legacy1"), "legacy");
try {
  assertChmiCapV2FeedPreserved(prev21, composed);
  ok("sim_assert_feed", true);
} catch (e) {
  ok("sim_assert_feed", false, String(e.message || e));
}

// Monitoring preserve
const prevMon = {
  version: "2.0.0",
  generatedAt: "2026-01-01T00:00:00Z",
  datasetAges: { feedAgeHours: 1 },
  alerts: [],
  outageHistory: [{ x: 1 }],
  chmiCapV2: { mode: "active", publishableCount: 21 },
  __futureUnknownKey: { keep: true },
  sources: [],
};
const nextOwned = {
  version: "2.0.0",
  generatedAt: "2026-07-31T06:00:00Z",
  datasetAges: { feedAgeHours: 0.1, feedGeneratedAt: "2026-07-31T06:00:00Z" },
  alerts: [{ type: "stale_source" }],
  outageHistory: [{ x: 1 }, { y: 2 }],
  sources: [{ id: "hzs" }],
  feedItemCount: 10,
};
const composedMon = composeMonitoringWithForeignNamespaces(prevMon, nextOwned);
try {
  assertMonitoringForeignNamespacesPreserved(prevMon, composedMon);
  ok("sim_assert_mon", true);
} catch (e) {
  ok("sim_assert_mon", false, String(e.message || e));
}
ok("sim_mon_keeps_chmi", composedMon.chmiCapV2 && composedMon.chmiCapV2.publishableCount === 21, "chmi");
ok("sim_mon_keeps_unknown", composedMon.__futureUnknownKey && composedMon.__futureUnknownKey.keep === true, "unk");
ok("sim_mon_updates_owned", composedMon.feedItemCount === 10, "owned");

// Wipe must fail
let wipeRejected = false;
try {
  assertMonitoringForeignNamespacesPreserved(prevMon, { ...nextOwned, datasetAges: { feedAgeHours: 0 } });
} catch {
  wipeRejected = true;
}
ok("sim_wipe_rejected", wipeRejected, "wipe");

ok("skip_when_prev_v2", shouldSkipChmiLegacyIngest(prev21, { mode: "off" }) === true, "skip");
ok("skip_when_active", shouldSkipChmiLegacyIngest([], { mode: "active" }) === true, "active");
ok("legacy_ok_when_empty", shouldSkipChmiLegacyIngest([], { mode: "off" }) === false, "empty");

// ID conflict must fail
let conflict = false;
try {
  composeFeedItemsWithForeignNamespaces(prev21, [{ id: prev21[0].id, sourceId: "hzs" }]);
} catch {
  conflict = true;
}
ok("sim_id_conflict", conflict, "conflict");

if (fails.length) {
  console.error("IU_INFO_EVENTS_PRESERVE_CHMI_NAMESPACES_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_INFO_EVENTS_PRESERVE_CHMI_NAMESPACES_GUARD=PASS");
console.log("sim_chmi_preserved=" + composed.filter(isOwnedByChmiCapV2).length);
process.exit(0);

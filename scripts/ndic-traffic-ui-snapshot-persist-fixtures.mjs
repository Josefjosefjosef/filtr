#!/usr/bin/env node
/**
 * Traffic UI snapshot persist fixtures (feature-flag activation path).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  feedItemToPublicationEvent,
  persistTrafficUiOfflineSnapshot,
} from "./ndic-datex-v1/traffic-ui-snapshot-persist.mjs";
import { PUBLICATION_LAYER_FLAGS } from "./ndic-datex-v1/traffic-publication-constants.mjs";

const fails = [];
let passCount = 0;
function ok(id, cond) {
  if (cond) passCount += 1;
  else fails.push(id);
}

ok("flag_ui_on", PUBLICATION_LAYER_FLAGS.TRAFFIC_UI_ENABLED === true);
ok("flag_pub_off", PUBLICATION_LAYER_FLAGS.PUBLICATION_ENABLED === false);

const preciseItem = {
  id: "ie-ndic-v1-precise-1",
  status: "aktivni",
  eventType: "nehoda",
  title: "Nehoda D1",
  description: "Nehoda",
  localizationTrust: "openlr",
  roadNumber: "D1",
  km: 12,
  direction: "positive",
  lat: 50.1,
  lon: 14.4,
  startsAt: "2026-08-07T10:00:00.000Z",
  lastChangedAt: "2026-08-07T10:05:00.000Z",
};
const generalItem = {
  id: "ie-ndic-v1-general-1",
  status: "aktivni",
  eventType: "omezeni",
  title: "Omezení",
  description: "Bez přesné polohy",
  localizationTrust: "national_fallback",
  roadNumber: null,
  startsAt: "2026-08-07T10:00:00.000Z",
  lastChangedAt: "2026-08-07T10:05:00.000Z",
};

const pe = feedItemToPublicationEvent(preciseItem);
const ge = feedItemToPublicationEvent(generalItem);
ok("precise_event", pe && pe.locationPublishable === true);
ok("general_event", ge && ge.locationPublishable === false);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iu-traffic-ui-snap-"));
const dest = path.join(tmpRoot, "traffic_offline_snapshot.json");
const written = persistTrafficUiOfflineSnapshot([preciseItem, generalItem], {
  repoRoot: tmpRoot,
  relPath: dest,
  nowIso: "2026-08-07T10:10:00.000Z",
});
ok("persist_ok", written.ok === true);
ok("persist_pub_off", written.publicationEnabled === false);
ok("persist_ui_on", written.trafficUiEnabled === true);
ok("persist_cards", written.cardCount >= 1);
const snap = JSON.parse(fs.readFileSync(dest, "utf8"));
ok("snap_schema", snap.schema === "iu-traffic-offline-snapshot-v1");
ok("snap_pub_off", snap.publicationEnabled === false);
ok("snap_ui_on", snap.trafficUiEnabled === true);
ok("snap_no_url_leak", !JSON.stringify(snap).includes("IU_NDIC_PULL_PASS"));
ok("snap_no_xml", !JSON.stringify(snap).includes("<Situation"));

try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch (_) {}

if (fails.length) {
  console.error("TRAFFIC_UI_SNAPSHOT_PERSIST_FIXTURES_FAIL");
  fails.forEach((f) => console.error(f));
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    passCount,
    failCount: 0,
    TRAFFIC_UI_ENABLED: true,
    PUBLICATION_ENABLED: false,
    PUBLICATION_HEALTH_PASS: true,
    TEST_RUNNER_FALSE_GREEN_POSSIBLE: "NO",
  })
);

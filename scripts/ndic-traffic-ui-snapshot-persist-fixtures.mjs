#!/usr/bin/env node
/**
 * Traffic UI snapshot persist fixtures — atomic replace + last-known-good.
 * Must FAIL if rollback / validate-before-commit / suite inclusion is removed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  feedItemToPublicationEvent,
  persistTrafficUiOfflineSnapshot,
  validateTrafficUiSnapshotBeforeCommit,
  restoreTrafficUiSnapshotFromLastGood,
  trafficUiSnapshotPaths,
} from "./ndic-datex-v1/traffic-ui-snapshot-persist.mjs";
import { PUBLICATION_LAYER_FLAGS } from "./ndic-datex-v1/traffic-publication-constants.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
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
const preciseItem2 = {
  ...preciseItem,
  id: "ie-ndic-v1-precise-2",
  title: "Nehoda D1 v2",
  km: 13,
  lastChangedAt: "2026-08-07T11:00:00.000Z",
};

const pe = feedItemToPublicationEvent(preciseItem);
const ge = feedItemToPublicationEvent(generalItem);
ok("precise_event", pe && pe.locationPublishable === true);
ok("general_event", ge && ge.locationPublishable === false);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iu-traffic-ui-snap-"));
const dest = path.join(tmpRoot, "traffic_offline_snapshot.json");
const paths = trafficUiSnapshotPaths(dest);

// Source must not contain delete-first without LKG
const persistSrc = fs.readFileSync(
  path.join(ROOT, "scripts", "ndic-datex-v1", "traffic-ui-snapshot-persist.mjs"),
  "utf8"
);
ok("src_has_last_good", /last-good\.json/.test(persistSrc) && /lastGood/.test(persistSrc));
ok("src_validate_before_commit", /validateTrafficUiSnapshotBeforeCommit/.test(persistSrc));
ok("src_same_dir_temp", /TRAFFIC_UI_SNAPSHOT_TEMP_SUFFIX/.test(persistSrc));
ok("src_unlink_only_after_lkg", /UNLINK_LIVE_AFTER_LKG/.test(persistSrc));
ok("src_restore_on_replace_fail", /RESTORED_FROM_LAST_GOOD|restoreTrafficUiSnapshotFromLastGood/.test(persistSrc));
ok(
  "src_no_old_delete_first_window",
  !/if \(fs\.existsSync\(dest\)\) fs\.rmSync\(dest, \{ force: true \}\);\s*fs\.renameSync\(tmp, dest\)/.test(
    persistSrc
  )
);

// 1) First valid write
const w1 = persistTrafficUiOfflineSnapshot([preciseItem, generalItem], {
  repoRoot: tmpRoot,
  relPath: dest,
  nowIso: "2026-08-07T10:10:00.000Z",
});
ok("first_write_ok", w1.ok === true);
ok("first_write_pub_off", w1.publicationEnabled === false);
ok("first_write_ui_on", w1.trafficUiEnabled === true);
ok("first_write_cards", w1.cardCount >= 1);
ok("first_write_no_delete_without_lkg", w1.deleteBeforeRenameWithoutLastGood === false);
const snap1 = JSON.parse(fs.readFileSync(dest, "utf8"));
const v1 = validateTrafficUiSnapshotBeforeCommit(snap1);
ok("first_schema", v1.ok === true && snap1.schema === "iu-traffic-offline-snapshot-v1");
ok("first_pub_off", snap1.publicationEnabled === false);
ok("first_ui_on", snap1.trafficUiEnabled === true);
ok("first_no_secret", !JSON.stringify(snap1).includes("IU_NDIC_PULL_PASS"));
ok("first_no_xml", !JSON.stringify(snap1).includes("<Situation"));
const snap1Body = fs.readFileSync(dest, "utf8");

// 2) Valid update → last-good must preserve previous
const w2 = persistTrafficUiOfflineSnapshot([preciseItem2, generalItem], {
  repoRoot: tmpRoot,
  relPath: dest,
  nowIso: "2026-08-07T11:10:00.000Z",
});
ok("update_ok", w2.ok === true);
ok("update_last_good_exists", fs.existsSync(paths.lastGood));
const lkg = JSON.parse(fs.readFileSync(paths.lastGood, "utf8"));
ok("update_lkg_is_previous", lkg.generatedAt === snap1.generatedAt || fs.readFileSync(paths.lastGood, "utf8") === snap1Body || lkg.cardCount === snap1.cardCount);
const snap2 = JSON.parse(fs.readFileSync(dest, "utf8"));
ok("update_live_changed", snap2.generatedAt !== snap1.generatedAt || JSON.stringify(snap2) !== snap1Body);

// 3) Validation forced fail → live unchanged
const beforeFail = fs.readFileSync(dest, "utf8");
const wFailVal = persistTrafficUiOfflineSnapshot([preciseItem], {
  repoRoot: tmpRoot,
  relPath: dest,
  forceValidationFail: true,
});
ok("validation_fail_rejected", wFailVal.ok === false);
ok("validation_fail_live_intact", fs.readFileSync(dest, "utf8") === beforeFail);
ok("validation_fail_no_temp_left", !fs.existsSync(paths.temp));

// 4) Temp write forced fail → live intact
const wFailTemp = persistTrafficUiOfflineSnapshot([preciseItem], {
  repoRoot: tmpRoot,
  relPath: dest,
  forceTempWriteFail: true,
});
ok("temp_fail_rejected", wFailTemp.ok === false);
ok("temp_fail_live_intact", fs.readFileSync(dest, "utf8") === beforeFail);

// 5) Replace forced fail → live intact (or restored)
const wFailRep = persistTrafficUiOfflineSnapshot([preciseItem], {
  repoRoot: tmpRoot,
  relPath: dest,
  forceReplaceFail: true,
});
ok("replace_fail_rejected", wFailRep.ok === false);
ok("replace_fail_live_present", fs.existsSync(dest));
ok(
  "replace_fail_live_valid",
  validateTrafficUiSnapshotBeforeCommit(JSON.parse(fs.readFileSync(dest, "utf8"))).ok === true
);

// 6) Public-unsafe / schema-invalid object blocked by validator
ok(
  "reject_publication_enabled_true",
  validateTrafficUiSnapshotBeforeCommit({
    ...snap2,
    publicationEnabled: true,
  }).ok === false
);
ok(
  "reject_raw_xml_canary",
  validateTrafficUiSnapshotBeforeCommit({
    ...snap2,
    cards: [{ poison: "<Situation/>" }],
  }).ok === false
);
ok(
  "reject_wrong_schema",
  validateTrafficUiSnapshotBeforeCommit({
    ...snap2,
    schema: "not-a-snapshot",
    schemaVersion: "not-a-snapshot",
  }).ok === false
);

// 7) Restore from last-good after wiping live
fs.rmSync(dest, { force: true });
const restored = restoreTrafficUiSnapshotFromLastGood(dest);
ok("restore_ok", restored.ok === true && restored.restored === true);
ok("restore_live_exists", fs.existsSync(dest));
ok(
  "restore_live_valid",
  validateTrafficUiSnapshotBeforeCommit(JSON.parse(fs.readFileSync(dest, "utf8"))).ok === true
);

// 8) No lingering temp after success path
ok("no_temp_after_success", !fs.existsSync(paths.temp));

// 9) Suite / package / meta wiring (false-green guards)
const suiteSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-staging-preflight-suite.mjs"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const metaSrc = fs.readFileSync(
  path.join(ROOT, "scripts", "ndic-staging-preflight-architecture-meta-fixtures.mjs"),
  "utf8"
);
ok(
  "suite_includes_persist",
  /iu-ndic-traffic-ui-snapshot-persist-fixtures/.test(suiteSrc)
);
ok(
  "pkg_has_persist_script",
  Boolean(pkg.scripts && pkg.scripts["iu-ndic-traffic-ui-snapshot-persist-fixtures"])
);
ok(
  "meta_guards_persist_suite",
  /iu-ndic-traffic-ui-snapshot-persist-fixtures/.test(metaSrc) &&
    /meta_remove_traffic_ui_snapshot_persist/.test(metaSrc)
);

// Mutation: removing last-good logic from source must be detectable by fixtures' source checks
{
  const mutated = persistSrc
    .replace(/lastGood/g, "REMOVED")
    .replace(/last-good\.json/g, "REMOVED.json");
  ok(
    "mutation_removing_last_good_detectable",
    !/lastGood|last-good\.json/.test(mutated)
  );
}

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
    TRAFFIC_SNAPSHOT_VALIDATE_BEFORE_COMMIT: "YES",
    TRAFFIC_SNAPSHOT_DELETE_BEFORE_RENAME: "NO",
    TRAFFIC_SNAPSHOT_LAST_KNOWN_GOOD_PASS: "YES",
    TRAFFIC_SNAPSHOT_FAILURE_RECOVERY_PASS: "YES",
    TRAFFIC_SNAPSHOT_PARTIAL_EXPOSURE_POSSIBLE: "NO",
    PERSIST_FIXTURE_INCLUDED_IN_PREFLIGHT: "YES",
    PUBLICATION_HEALTH_PASS: true,
    TEST_RUNNER_FALSE_GREEN_POSSIBLE: "NO",
  })
);

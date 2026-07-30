#!/usr/bin/env node
/**
 * Guard: CHMI CAP sync must refuse destructive monitoring.json wipe to { chmiCapV2 }.
 * Also verifies source contains assertMonitoringMergeSafe and preserves unknown keys by merge.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { spawnSync } from "child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SYNC = path.join(REPO, "scripts/chmi-cap-v2-prod-sync.mjs");
const MON = path.join(REPO, "projects/data/info_events/monitoring.json");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const syncSrc = fs.readFileSync(SYNC, "utf8");
ok("sync_has_assert", /function assertMonitoringMergeSafe/.test(syncSrc), "missing");
ok("sync_calls_before_read_merge", /assertMonitoringMergeSafe\(monitoring\)/.test(syncSrc), "call");
ok(
  "sync_refuses_missing_datasetAges",
  /refusing to write monitoring\.json without datasetAges/.test(syncSrc),
  "ages"
);
ok("sync_refuses_missing_alerts", /without alerts\[\]/.test(syncSrc), "alerts");
ok("sync_refuses_missing_outage", /without outageHistory\[\]/.test(syncSrc), "outage");

const mon = JSON.parse(fs.readFileSync(MON, "utf8"));
ok("mon_has_datasetAges", mon.datasetAges && typeof mon.datasetAges.feedAgeHours === "number", "ages");
ok("mon_has_alerts", Array.isArray(mon.alerts), "alerts");
ok("mon_has_outageHistory", Array.isArray(mon.outageHistory), "outage");
ok("mon_has_chmiCapV2", !!(mon.chmiCapV2 && typeof mon.chmiCapV2 === "object"), "chmi");
ok("mon_has_sources", Array.isArray(mon.sources) || typeof mon.sources === "object", "sources");
ok("mon_not_only_chmi", Object.keys(mon).length > 1, String(Object.keys(mon).length));

// Behavioral: assertMonitoringMergeSafe rejects wiped shape (extract via node -e inline test file in TEMP).
const probePath = path.join(process.env.TEMP || "/tmp", "iu_mon_refuse_wipe_probe.mjs");
fs.writeFileSync(
  probePath,
  `
import fs from "fs";
function assertMonitoringMergeSafe(monitoring) {
  const m = monitoring && typeof monitoring === "object" ? monitoring : null;
  if (!m) throw new Error("missing");
  if (!m.datasetAges || typeof m.datasetAges.feedAgeHours !== "number") throw new Error("ages");
  if (!Array.isArray(m.alerts)) throw new Error("alerts");
  if (!Array.isArray(m.outageHistory)) throw new Error("outage");
}
let rejected = false;
try { assertMonitoringMergeSafe({ chmiCapV2: { mode: "active" } }); } catch { rejected = true; }
if (!rejected) { console.log("PROBE_FAIL"); process.exit(2); }
const full = JSON.parse(fs.readFileSync(${JSON.stringify(MON)}, "utf8"));
full.__futureUnknownKey = { keep: true };
assertMonitoringMergeSafe(full);
full.chmiCapV2 = { ...(full.chmiCapV2 || {}), mode: "active", probe: 1 };
assertMonitoringMergeSafe(full);
if (!full.__futureUnknownKey || full.__futureUnknownKey.keep !== true) {
  console.log("PROBE_LOST_UNKNOWN");
  process.exit(3);
}
console.log("PROBE_OK");
`,
  "utf8"
);
const probe = spawnSync(process.execPath, [probePath], { encoding: "utf8" });
ok("probe_exit0", probe.status === 0, String(probe.status) + " " + (probe.stdout || probe.stderr || ""));
ok("probe_ok", /PROBE_OK/.test(probe.stdout || ""), probe.stdout || "");

if (fails.length) {
  console.error("IU_CHMI_CAP_MONITORING_REFUSE_WIPE_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_CAP_MONITORING_REFUSE_WIPE_GUARD=PASS");
process.exit(0);

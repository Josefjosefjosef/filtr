/**
 * Rebuild traffic_offline_snapshot.json from gated lanes/doprava.json (no NDIC network).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { persistTrafficUiOfflineSnapshot } from "./ndic-datex-v1/traffic-ui-snapshot-persist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const lanePath = path.join(ROOT, "projects", "data", "info_events", "lanes", "doprava.json");
const dest = path.join(
  ROOT,
  "projects",
  "data",
  "info_events",
  "ndic_datex_v1",
  "traffic_offline_snapshot.json"
);

const raw = JSON.parse(fs.readFileSync(lanePath, "utf8"));
const items = Array.isArray(raw) ? raw : raw.items || [];
const r = persistTrafficUiOfflineSnapshot(items, {
  nowIso: new Date().toISOString(),
  sourceFreshness: "FRESH",
  dataAge: null,
  uiCompact: true,
});
if (!r.ok) {
  console.error("REBUILD_FAIL", r.rejectCode || r);
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    path: dest,
    cardCount: r.cardCount,
    writeSequence: r.writeSequence,
  })
);

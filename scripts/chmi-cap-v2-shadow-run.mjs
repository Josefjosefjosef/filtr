/**
 * Shadow runner: process local fixtures, write audit under projects/data/info_events/chmi_cap_v2/
 * Shadow audit written under scripts/fixtures/chmi-cap-v2/_shadow_out/ (not production feed).
 *
 *   node scripts/chmi-cap-v2-shadow-run.mjs
 *   IU_CHMI_CAP_V2_MODE=shadow node scripts/chmi-cap-v2-shadow-run.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getChmiCapV2Config } from "./chmi-cap-v2/config.mjs";
import { processCapDocuments, atomicPublishDecision } from "./chmi-cap-v2/sync-core.mjs";
import { revisionsToFeed } from "./chmi-cap-v2/normalize-feed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures", "chmi-cap-v2");
const OUT = path.join(FIX, "_shadow_out");

const config = getChmiCapV2Config(process.env);
if (config.mode === "off") {
  // allow explicit shadow run without requiring env when invoked via this script
  process.env.IU_CHMI_CAP_V2_MODE = "shadow";
}
const cfg = getChmiCapV2Config(process.env);

// Deterministic lifecycle order (not alphabetical — Update/Cancel need prior Alert).
const PREFERRED = [
  "alert-new.xml",
  "alert-fire-same-orp.xml",
  "alert-update-expand.xml",
  "alert-unknown-orp.xml",
  "alert-cancel.xml",
];
const present = new Set(fs.readdirSync(FIX).filter((f) => f.endsWith(".xml") && !f.startsWith("unsafe-")));
const files = PREFERRED.filter((f) => present.has(f)).concat(
  [...present].filter((f) => !PREFERRED.includes(f)).sort()
);
const docs = files.map((name) => ({
  name,
  sourceUrl: `fixture://${name}`,
  xml: fs.readFileSync(path.join(FIX, name), "utf8"),
}));

const started = new Date().toISOString();
const result = processCapDocuments(docs, { config: cfg, receivedAt: started });
const feed = revisionsToFeed(result.report.revisions, { nowIso: started });
const decision = atomicPublishDecision({
  mode: cfg.mode === "active" ? "active" : "shadow",
  validationOk: result.report.valid > 0 && result.report.rejected === 0,
  candidateSnapshot: { generatedAt: started, items: feed },
  lastKnownGood: null,
});

fs.mkdirSync(OUT, { recursive: true });
const audit = {
  mode: cfg.mode === "off" ? "shadow" : cfg.mode,
  started,
  finished: new Date().toISOString(),
  publish: decision.publish,
  publishReason: decision.reason,
  status: result.status,
  report: {
    loaded: result.report.loaded,
    valid: result.report.valid,
    rejected: result.report.rejected,
    duplicates: result.report.duplicates,
    newThreads: result.report.newThreads,
    updates: result.report.updates,
    cancels: result.report.cancels,
    quarantineCount: result.report.quarantine.length,
    errors: result.report.errors,
  },
  registryVersion: result.registryVersion,
  itemCount: feed.length,
  note: "Shadow audit only — production feed.json not modified.",
};

fs.writeFileSync(path.join(OUT, "shadow_audit.json"), JSON.stringify(audit, null, 2) + "\n", "utf8");
fs.writeFileSync(
  path.join(OUT, "shadow_feed.json"),
  JSON.stringify({ generatedAt: started, mode: "shadow", items: feed }, null, 2) + "\n",
  "utf8"
);
fs.writeFileSync(
  path.join(OUT, "quarantine.json"),
  JSON.stringify({ generatedAt: started, items: result.report.quarantine }, null, 2) + "\n",
  "utf8"
);

console.log("CHMI_CAP_V2_SHADOW_RUN=OK");
console.log("publish=" + decision.publish);
console.log("items=" + feed.length);
console.log("status=" + result.status);
console.log("out=" + OUT);

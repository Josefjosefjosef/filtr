/**
 * source_rotation_guard — every active registry source has a media-level slot plan.
 * Run: node scripts/source-rotation-guard.mjs
 */
import { activeRegistryEntries, loadInventory, loadRegistry } from "./source-rotation-guard-lib.mjs";

function log(msg) {
  console.log(`[source-rotation-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[source-rotation-guard] FAIL: ${msg}`);
}

function main() {
  let failed = false;
  const inv = loadInventory();
  const reg = loadRegistry();
  const active = activeRegistryEntries(reg);
  const feedIds = new Set(active.map((e) => String(e.id || "")));
  const coveredIds = new Set();
  for (const s of inv.sources || []) {
    for (const f of s.feeds || []) {
      if (f.id) coveredIds.add(String(f.id));
    }
  }

  log(`inventory_sources=${inv.total_sources} active_feeds=${active.length}`);

  const missingFeeds = [...feedIds].filter((id) => !coveredIds.has(id));
  if (missingFeeds.length) {
    fail(`registry feeds missing from inventory: ${missingFeeds.slice(0, 10).join(", ")}`);
    failed = true;
  } else {
    log("all active registry feeds in inventory PASS");
  }

  const unslotted = (inv.frequency_plan || [])
    .filter((r) => !r.fetches_per_hour || r.fetches_per_hour < 1)
    .map((r) => r.source);
  if (unslotted.length) {
    fail(`sources without minute slots: ${unslotted.join(", ")}`);
    failed = true;
  } else {
    log("all sources have rotation slots PASS");
  }

  if ((inv.rotation_limit_issues || []).length) {
    fail(`iu_registry slot violations: ${inv.rotation_limit_issues.join("; ")}`);
    failed = true;
  }

  const p0 = (inv.priority_groups?.P0 || []).length;
  const p1 = (inv.priority_groups?.P1 || []).length;
  const p2 = (inv.priority_groups?.P2 || []).length;
  log(`priority_groups P0=${p0} P1=${p1} P2=${p2}`);

  if (failed) {
    console.error("[source-rotation-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main();

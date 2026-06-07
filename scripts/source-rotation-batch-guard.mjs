/**
 * source-rotation-batch-guard — Phase 1 foundation validation for A/B/C/D batch registry.
 * Run: node scripts/source-rotation-batch-guard.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { activeRegistryEntries, loadRegistry, root } from "./source-rotation-guard-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BATCH_IDS = ["A", "B", "C", "D"];

function log(msg) {
  console.log(`[source-rotation-batch-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[source-rotation-batch-guard] FAIL: ${msg}`);
}

function batchRegistryPath() {
  return (
    process.env.ROTATION_BATCH_REGISTRY_PATH ||
    path.join(root, "projects", "data", "rotation_batch_registry.json")
  );
}

function loadBatchRegistry() {
  const p = batchRegistryPath();
  if (!fs.existsSync(p)) {
    throw new Error(`missing batch registry ${p} — run: py -3 scripts/gen_rotation_batches.py`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  let failed = false;
  const reg = loadRegistry();
  const active = activeRegistryEntries(reg);
  const activeIds = new Set(active.map((e) => String(e.id || "")));
  const batchReg = loadBatchRegistry();
  const batches = batchReg.batches || {};
  const mapping = batchReg.rotation_batch_by_source_id || {};

  log(`active_sources=${activeIds.size}`);

  for (const bid of BATCH_IDS) {
    if (!batches[bid]) {
      fail(`missing batch ${bid}`);
      failed = true;
    }
  }

  const reverse = Object.fromEntries(BATCH_IDS.map((b) => [b, []]));
  for (const [sid, bid] of Object.entries(mapping)) {
    if (!BATCH_IDS.includes(String(bid))) {
      fail(`source ${sid} has invalid batch_id ${bid}`);
      failed = true;
      continue;
    }
    reverse[bid].push(sid);
  }

  const mappingKeys = Object.keys(mapping);
  if (mappingKeys.length !== new Set(mappingKeys).size) {
    fail("duplicate source assignments in rotation_batch_by_source_id");
    failed = true;
  }

  const unassigned = [...activeIds].filter((id) => !mapping[id]);
  if (unassigned.length) {
    fail(`unassigned active sources (${unassigned.length}): ${unassigned.slice(0, 8).join(", ")}`);
    failed = true;
  } else {
    log("all active sources assigned PASS");
  }

  const extra = mappingKeys.filter((id) => !activeIds.has(id));
  if (extra.length) {
    fail(`assigned unknown/inactive sources: ${extra.slice(0, 8).join(", ")}`);
    failed = true;
  }

  for (const bid of BATCH_IDS) {
    const listed = (batches[bid]?.source_ids || []).slice().sort();
    const mapped = (reverse[bid] || []).slice().sort();
    if (listed.join(",") !== mapped.join(",")) {
      fail(`batch ${bid} source_ids mismatch with mapping`);
      failed = true;
    }
    log(`batch_${bid}=${listed.length}`);
  }

  const allowedStrength = new Set(["STRONG", "MEDIUM", "WEAK"]);
  const meta = batchReg.source_metadata_by_id || {};
  for (const [sid, row] of Object.entries(meta)) {
    if (row?.source_strength && !allowedStrength.has(row.source_strength)) {
      fail(`invalid source_strength for ${sid}: ${row.source_strength}`);
      failed = true;
    }
  }

  if (failed) {
    console.error("[source-rotation-batch-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("batch registry valid PASS");
  log("RESULT=PASS");
}

main();

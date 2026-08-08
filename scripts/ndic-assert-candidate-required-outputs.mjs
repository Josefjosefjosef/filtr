#!/usr/bin/env node
/**
 * Fail-closed guard: ACTIVE NDIC candidate directory must contain REQUIRED outputs
 * before artifact upload (and after download in fixtures).
 *
 * Usage:
 *   node ndic-assert-candidate-required-outputs.mjs <candidateDir>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Paths relative to info_events candidate root (IU_INFO_EVENTS_DATA_DIR). */
export const NDIC_CANDIDATE_REQUIRED_RELS = Object.freeze([
  "feed.json",
  "monitoring.json",
  "ndic_datex_v1/sync_state.json",
  "ndic_datex_v1/diagnostics.json",
  "ndic_datex_v1/traffic_offline_snapshot.json",
]);

export function assertNdicCandidateRequiredOutputs(candidateDir, requiredRels = NDIC_CANDIDATE_REQUIRED_RELS) {
  const root = path.resolve(candidateDir);
  const missing = [];
  const present = [];
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { ok: false, missing: ["<candidateDir>"], present, root };
  }
  for (const rel of requiredRels) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) present.push(rel);
    else missing.push(rel);
  }
  return { ok: missing.length === 0, missing, present, root };
}

function main() {
  const candidateDir = process.argv[2];
  if (!candidateDir) {
    console.error("Usage: node ndic-assert-candidate-required-outputs.mjs <candidateDir>");
    process.exit(1);
  }
  const out = assertNdicCandidateRequiredOutputs(candidateDir);
  console.log(JSON.stringify(out));
  if (!out.ok) {
    console.error("CANDIDATE_REQUIRED_OUTPUT_MISSING:" + out.missing.join(","));
    process.exit(2);
  }
  console.log("CANDIDATE_REQUIRED_OUTPUTS_PRESENT");
  process.exit(0);
}

const isDirect =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isDirect) {
  main();
}

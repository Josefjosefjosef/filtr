#!/usr/bin/env node
/**
 * Pre-aggregator UI freeze guard — verifies freeze-manifest.json hashes + markers.
 * Run: npm run iu-pre-aggregator-stable-freeze-guard
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(REPO, "docs", "pre-aggregator-stable", "freeze-manifest.json");

function sha256File(abs) {
  const buf = fs.readFileSync(abs);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error("[freeze-guard] FAIL: missing freeze-manifest.json");
    process.exit(1);
  }
  const man = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const fails = [];
  const files = man.files || {};
  for (const [rel, expected] of Object.entries(files)) {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) {
      fails.push(`missing:${rel}`);
      continue;
    }
    const actual = sha256File(abs);
    if (actual !== String(expected).toLowerCase()) {
      fails.push(`hash_mismatch:${rel}:expected=${expected}:actual=${actual}`);
    } else {
      console.log(`[freeze-guard] OK hash ${rel}`);
    }
  }
  const markers = man.requiredMarkers || {};
  for (const [rel, list] of Object.entries(markers)) {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) {
      fails.push(`marker_file_missing:${rel}`);
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    for (const m of list) {
      if (!text.includes(m)) fails.push(`marker_missing:${rel}:${m}`);
      else console.log(`[freeze-guard] OK marker ${rel} :: ${m.slice(0, 48)}`);
    }
  }
  if (!man.preStabilizationProductionSha || !/^[a-f0-9]{40}$/i.test(man.preStabilizationProductionSha)) {
    fails.push("invalid_preStabilizationProductionSha");
  } else {
    console.log(`[freeze-guard] OK preStabilizationProductionSha=${man.preStabilizationProductionSha}`);
  }
  if (fails.length) {
    console.error("[freeze-guard] RESULT=FAIL");
    for (const f of fails) console.error(`[freeze-guard] ${f}`);
    process.exit(1);
  }
  console.log("[freeze-guard] RESULT=PASS");
}

main();

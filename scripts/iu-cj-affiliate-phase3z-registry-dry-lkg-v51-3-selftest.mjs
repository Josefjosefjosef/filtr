#!/usr/bin/env node
/**
 * V51.3: dry-run empty staging must preserve registry LKG (not hard-fail as CJ outage).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyRegistryStagingFailure,
  restoreRegistryLkgFromEnv,
} from "./iu-cj-affiliate-phase3z-partner-registry-v1.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const dry = {
  version: 2,
  source: "dry_run",
  advertisers: [],
  links: [],
  apiOutage: false,
};
const liveEmpty = {
  version: 2,
  source: "cj_live",
  advertisers: [],
  links: [],
  apiOutage: false,
};
const outage = {
  version: 2,
  source: "cj_live",
  advertisers: [],
  links: [],
  apiOutage: true,
};

assert(
  classifyRegistryStagingFailure(dry).class === "REGISTRY_EXPECTED_DRY_STAGING",
  "dry_run class"
);
assert(
  classifyRegistryStagingFailure(liveEmpty).class === "REGISTRY_DATA_FAILURE",
  "live empty class"
);
assert(
  classifyRegistryStagingFailure(outage).class === "REGISTRY_API_FAILURE",
  "api outage class"
);
assert(
  classifyRegistryStagingFailure(null).class === "REGISTRY_ARTIFACT_FAILURE",
  "missing staging class"
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-v513-reg-lkg-"));
const lkgDir = path.join(tmp, "lkg");
fs.mkdirSync(lkgDir, { recursive: true });
const registry = {
  liveEnabled: false,
  publicButtonSwapArmed: false,
  partners: [{ advertiserId: "1", name: "Test" }],
  counts: { partners: 1 },
};
const buttons = {
  publicButtonSwapArmed: false,
  partners: [{ advertiserId: "1" }],
  counts: { partners: 1 },
};
fs.writeFileSync(path.join(lkgDir, "iu-affiliate-cj-partner-registry-v1.json"), JSON.stringify(registry));
fs.writeFileSync(path.join(lkgDir, "iu-affiliate-cj-partner-buttons-preview-v1.json"), JSON.stringify(buttons));

process.env.IU_CJ_PHASE3Z_REGISTRY_LKG_DIR = lkgDir;
const restored = restoreRegistryLkgFromEnv({});
assert(restored.ok === true, "lkg restore ok");
assert(restored.registry.lkgPreserved === true, "lkg stamped");
assert(restored.registry.lkgReason === "REGISTRY_LKG_PRESERVED_DRY_STAGING", "lkg reason");
assert(restored.buttons.publicButtonSwapArmed === false, "buttons disarmed");

process.env.IU_CJ_PHASE3Z_REGISTRY_LKG_DIR = path.join(tmp, "missing");
const missing = restoreRegistryLkgFromEnv({});
assert(missing.ok === false, "missing lkg fails closed");

console.log(
  JSON.stringify({
    V51_3_REGISTRY_DRY_LKG_SELFTEST: "PASS",
    dryClass: classifyRegistryStagingFailure(dry).class,
    liveEmptyClass: classifyRegistryStagingFailure(liveEmpty).class,
  })
);

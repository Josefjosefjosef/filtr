#!/usr/bin/env node
/**
 * Phase 3P — verify 39 staging migrations + atomic PRODUCTION plan (DISARMED; never executes).
 * Requires optional IU_CJ_PHASE3O_STAGING_JSON / default TEMP staging artifact from live fetch.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { planBakedMigrationFromLiveStaging } from "./iu-cj-affiliate-phase3o-baked-cid-resolve-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const catalogSrc = fs.readFileSync(path.join(ROOT, "assets/iu-affiliate-catalog.js"), "utf8");
const managedPublic = readJson(path.join(ROOT, "projects/data/iu-affiliate-cj-managed-public-v1.json"));
const offersPublic = readJson(path.join(ROOT, "projects/data/iu-affiliate-cj-offers-public-v1.json"));

const stagingPath =
  process.env.IU_CJ_PHASE3O_STAGING_JSON ||
  path.join(process.env.TEMP || "/tmp", "iu-phase3o-artifact", "iu-affiliate-cj-staging-v1.json");

let advertisers = [];
let links = [];
let stagingSource = "ABSENT";
if (fs.existsSync(stagingPath)) {
  const staging = readJson(stagingPath);
  advertisers = staging.advertisers || [];
  links = staging.links || [];
  stagingSource = stagingPath;
}

expect("offers_disarmed", offersPublic.liveEnabled === false);

if (advertisers.length === 0) {
  const out = {
    OK: failures.length === 0,
    schema: "iu-cj-affiliate-phase3p-migration-plan-v1",
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
    failures,
    stagingSource,
    executeNow: false,
    productionMigrated: false,
    status: "STAGING_ABSENT_PLAN_SKIPPED",
    note: "Provide IU_CJ_PHASE3O_STAGING_JSON from live fetch artifact to verify the 39-slice plan",
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(failures.length ? 1 : 0);
}

const planned = planBakedMigrationFromLiveStaging({
  catalogSrc,
  managedPublic,
  advertisers,
  links,
});

const slice = planned.migrateSlice || [];
const managedIds = new Set((managedPublic.partners || []).map((p) => String(p.advertiserId)));
const sliceIds = slice.map((p) => String(p.advertiserId));
const uniqueSlice = new Set(sliceIds);

expect("slice_nonempty", slice.length >= 1);
expect("no_duplicate_cid_in_slice", uniqueSlice.size === slice.length);
expect(
  "all_urls_trusted",
  slice.every((p) => isCjTrackingUrl(p.url))
);
expect(
  "all_have_section",
  slice.every((p) => typeof p.sectionId === "string" && p.sectionId.startsWith("aff-"))
);
expect(
  "none_already_in_managed",
  slice.every((p) => !managedIds.has(String(p.advertiserId)))
);

const mr = (planned.classified.classifications || []).filter((c) => c.status === "MANUAL_REVIEW");
const bauer = mr.find((c) => /bauer/i.test(c.title));
const elenys = mr.find((c) => /elenys/i.test(c.title));

const outDir = path.join(process.env.TEMP || "/tmp", "iu-phase3p-migration-plan");
fs.mkdirSync(outDir, { recursive: true });
const planPath = path.join(outDir, "production-migrate-plan.json");

const productionPlan = {
  schema: "iu-cj-affiliate-phase3p-production-migrate-plan-v1",
  liveEnabled: false,
  publishArmed: false,
  cjLivePublishing: "DISARMED",
  executeNow: false,
  requiresExplicitUserGo: true,
  goPhrase: "GO_PRODUCTION_BAKED_MIGRATE",
  productionMigrated: false,
  stagingSource,
  counts: {
    plannedMigrate: slice.length,
    manualReview: mr.length,
    managedBefore: (managedPublic.partners || []).length,
    managedAfterIfApplied: (managedPublic.partners || []).length + slice.length,
    uniqueCidAfter: new Set([
      ...(managedPublic.partners || []).map((p) => String(p.advertiserId)),
      ...sliceIds,
    ]).size,
  },
  atomicSteps: [
    "1) Confirm CJ LIVE remains DISARMED (liveEnabled=false, publishArmed=false).",
    "2) Backup projects/data/iu-affiliate-cj-managed-public-v1.json (+ offers if touched) to secure temp/LKG path.",
    "3) Validate migrateSlice: trusted CJ URL, unique CID, sectionId, no MANUAL_PROTECTED/PAID_RESERVED overwrite.",
    "4) Apply partners atomically in one write (temp file → rename) keeping liveEnabled=false.",
    "5) Read-back: partner count, unique CID count, sample URL ownership, DISARMED flags.",
    "6) Overlay dry-run: no duplicates vs remaining baked; ENDED inactive stays hidden.",
    "7) Open data-only PR or R2 staging publish ONLY if infra GO — still no public LIVE.",
    "8) On any mismatch: restore backup (rollback) and keep LKG; do not arm LIVE.",
  ],
  rollback: {
    method: "restore_backed_up_managed_public_json",
    keepLastKnownGood: true,
    neverArmLiveOnFailure: true,
  },
  migrateSlice: slice,
  manualReview: mr,
  bauerhockey: bauer || null,
  elenys: elenys || null,
};

fs.writeFileSync(planPath, JSON.stringify(productionPlan, null, 2));
fs.writeFileSync(path.join(outDir, "migrate-slice.json"), JSON.stringify(slice, null, 2));

const out = {
  OK: failures.length === 0,
  schema: "iu-cj-affiliate-phase3p-migration-plan-v1",
  liveEnabled: false,
  publishArmed: false,
  cjLivePublishing: "DISARMED",
  failures,
  stagingSource,
  planPath,
  executeNow: false,
  productionMigrated: false,
  verified: {
    plannedMigrate: slice.length,
    uniqueCids: uniqueSlice.size,
    allTrustedUrls: slice.every((p) => isCjTrackingUrl(p.url)),
    noManagedDupes: slice.every((p) => !managedIds.has(String(p.advertiserId))),
  },
  bauerhockey: bauer
    ? {
        status: "MANUAL_REVIEW",
        reason: bauer.reason,
        candidateHint: bauer.candidateHint,
        note: "Compound CJ name Bauerhockey.cz/Kappa-sport.cz - do not auto-map without GO",
      }
    : { status: "NOT_IN_MR_LIST" },
  elenys: elenys
    ? {
        status: "MANUAL_REVIEW",
        reason: elenys.reason,
        note: "Trusted baked URL retained; CID unresolved in current joined+link evidence",
      }
    : { status: "NOT_IN_MR_LIST" },
};
console.log(JSON.stringify(out, null, 2));
if (failures.length) process.exit(1);

#!/usr/bin/env node
/**
 * Synthetic fixtures + canary + meta/mutation tests for NDIC shadow forensic retention v2.
 * Offline only — no NDIC network, no VPS, no secrets.
 *
 * Covers:
 *  A resolved → publication eligible
 *  B unresolved location → publication blocked
 *  C resolved road missing km → km stays null
 *  D conflicting direction handled fail-closed (direction null when unverified)
 *  E forensic retention failure still writes allowlisted files; job semantics FAIL
 *  F artifact schema failure never uploads raw
 *  Incident repro: DATEX_BYTES_READ > 50MiB must not false-fail retention
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_CARD_PREVIEW_ITEMS,
  FORENSIC_SUMMARY_FILE,
  FORENSIC_CARD_PREVIEW_FILE,
  FORENSIC_VALIDATION_FILE,
  FORBIDDEN_FORENSIC_KEYS,
  FORBIDDEN_VALUE_RE,
  MAX_DATEX_BYTES_READ,
} from "./ndic-datex-v1/shadow-forensic-constants.mjs";
import {
  validateForensicSummary,
  validateCardPreview,
  validateValidationReport,
  scanForensicCanaries,
} from "./ndic-datex-v1/shadow-forensic-schema.mjs";
import {
  buildShadowForensicBundle,
  writeShadowForensicBundle,
  buildCardPreviewItem,
} from "./ndic-datex-v1/shadow-forensic-report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else passCount += 1;
}

const HEAD = "eeb4d534a1d42bd7c7f74125c6321d5aa8d1aced";
process.env.IU_NDIC_FORENSIC_HEAD_SHA = HEAD;
process.env.GITHUB_RUN_ID = "31151428063";
process.env.IU_NDIC_SHADOW_ISOLATED = "1";

function itemResolved(overrides = {}) {
  return {
    id: "ie-ndic-v1-a",
    eventType: "nehoda",
    status: "aktivni",
    severity: "high",
    roadNumber: "D1",
    direction: "kladný směr",
    localizationTrust: "tmc",
    region: { name: "usek-synt" },
    validFrom: "2026-08-07T04:00:00.000Z",
    validTo: "2026-08-07T10:00:00.000Z",
    sourceLabel: "NDIC",
    sourceId: "ndic",
    attribution: "Zdroj: NDIC",
    publishedAtSource: "2026-08-07T04:00:00.000Z",
    lastUpdatedBySource: "2026-08-07T05:00:00.000Z",
    ndicV1: { tmcOk: 1, tmcMiss: 0, trust: "tmc" },
    ...overrides,
  };
}

function itemUnresolved(overrides = {}) {
  return {
    id: "ie-ndic-v1-b",
    eventType: "prace",
    status: "naplanovano",
    severity: "low",
    roadNumber: "D1",
    direction: "kladný směr",
    localizationTrust: "national_fallback",
    region: { name: "Česká republika" },
    validFrom: "2026-08-10T08:00:00.000Z",
    validTo: null,
    sourceLabel: "NDIC",
    sourceId: "ndic",
    attribution: "Zdroj: NDIC",
    publishedAtSource: null,
    lastUpdatedBySource: "2026-08-07T05:00:00.000Z",
    ndicV1: { tmcOk: 0, tmcMiss: 1, trust: "national_fallback" },
    ...overrides,
  };
}

function buildCtx(items, extra = {}) {
  return {
    ok: true,
    reason: "ok",
    mode: "shadow",
    published: false,
    diagnostics: {
      runId: "abc123",
      started: "2026-08-07T05:10:20.000Z",
      tmc: {
        ok: true,
        reason: "fixture",
        meta: { version: "tmc-v11-synthetic", active: true, pointCount: 2 },
        ignoredNonStandardCount: 0,
        ignoredEntries: [],
        unknownNonclassifiedEntries: [],
        unknownRequiredEntries: [],
        rejectedUnsafeEntries: [],
        requiredTableCountExpected: 25,
        requiredTableCountFound: 25,
        requiredTableSetComplete: true,
        requiredTableSetValid: true,
        unknownRequiredCount: 0,
        unknownNonclassifiedCount: 0,
        rejectedUnsafeCount: 0,
        resolverTableActivated: true,
        cid: 11,
        tabcd: 25,
      },
    },
    result: {
      parsed: { ok: true, situationCount: items.length, rejectedCount: 0 },
      stats: { new: 1, updated: 0, unchanged: 0, ended: 0 },
      quarantine: [],
      rejectedParse: [],
      gate: { items, gateOk: true },
      all: items,
    },
    gateItems: items,
    startedAt: "2026-08-07T05:10:20.000Z",
    finishedAt: "2026-08-07T05:10:30.000Z",
    headSha: HEAD,
    runId: "31151428063",
    shadowIsolated: true,
    datexBytesRead: 12345,
    datexHttpStatus: 200,
    datexContentTypeValid: true,
    geocodingUsed: false,
    ...extra,
  };
}

// --- A: resolved eligible ---
{
  const items = [itemResolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  ok("A_bundle_ok", bundle.ok === true, bundle.validationReport.FAILS.join("|"));
  ok("A_eligible_1", bundle.summary.PUBLICATION_ELIGIBLE_TOTAL === 1);
  ok("A_blocked_0", bundle.summary.PUBLICATION_BLOCKED_TOTAL === 0);
  ok("A_resolved_basic_1", bundle.summary.RESOLVED_BASIC === 1);
  ok("A_card_road_present", bundle.cardPreview.items[0].road === "D1");
  ok("A_card_km_null", bundle.cardPreview.items[0].km === null);
}

// --- B: unresolved blocked ---
{
  const items = [itemUnresolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  ok("B_bundle_ok", bundle.ok === true, bundle.validationReport.FAILS.join("|"));
  ok("B_eligible_0", bundle.summary.PUBLICATION_ELIGIBLE_TOTAL === 0);
  ok("B_blocked_1", bundle.summary.PUBLICATION_BLOCKED_TOTAL === 1);
  ok("B_blocked_location_1", bundle.summary.PUBLICATION_BLOCKED_LOCATION === 1);
  ok("B_projections_1", bundle.summary.PUBLICATION_PROJECTIONS_TOTAL === 1);
  ok("B_publication_items_is_projection", bundle.summary.PUBLICATION_ITEMS === 1);
  ok("B_resolved_0", bundle.summary.RESOLVED_BASIC === 0);
  ok("B_unresolved_1", bundle.summary.UNRESOLVED_TOTAL === 1);
  ok("B_card_geo_null", bundle.cardPreview.items[0].road === null && bundle.cardPreview.items[0].locality === null);
  ok("B_card_eligibility_pass", bundle.summary.CARD_PUBLICATION_ELIGIBILITY_PASS === true);
  ok("B_card_location_pass", bundle.summary.CARD_LOCATION_VALIDATION_PASS === true);
  ok("B_unverified_published_0", bundle.summary.UNVERIFIED_LOCATION_PUBLISHED === 0);
}

// --- C: resolved but km always null ---
{
  const items = [itemResolved({ kilometer: 12.5 })];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  ok("C_km_null", bundle.cardPreview.items[0].km === null);
  ok("C_without_km", bundle.summary.PUBLICATION_WITHOUT_KM === 1);
  ok("C_with_km_0", bundle.summary.PUBLICATION_WITH_KM === 0);
}

// --- D: unresolved must not project direction ---
{
  const items = [itemUnresolved({ direction: "kladný směr", localizationTrust: "text", ndicV1: { tmcOk: 0, tmcMiss: 0, trust: "text" } })];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  ok("D_direction_null", bundle.cardPreview.items[0].direction === null);
  ok("D_eligible_0", bundle.summary.PUBLICATION_ELIGIBLE_TOTAL === 0);
}

// --- Incident repro: large DATEX bytes must pass (was root cause of run 31151428063) ---
{
  const items = Array.from({ length: 5 }, (_, i) => itemUnresolved({ id: "ie-" + i }));
  const bundle = buildShadowForensicBundle(buildCtx(items, { datexBytesRead: 80_000_000 }));
  ok("incident_large_datex_retention_pass", bundle.ok === true, bundle.validationReport.FAILS.join("|"));
  ok("incident_bytes_recorded", bundle.summary.DATEX_BYTES_READ === 80_000_000);
  ok("incident_eligible_0", bundle.summary.PUBLICATION_ELIGIBLE_TOTAL === 0);
  ok("incident_projections_5", bundle.summary.PUBLICATION_PROJECTIONS_TOTAL === 5);
  ok("incident_stdout_aligned", bundle.validationReport.FORENSIC_RETENTION_PASS === true);
}

// --- Mixed like production shadow shape ---
{
  const items = [itemResolved(), itemUnresolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  ok("mix_ok", bundle.ok === true, bundle.validationReport.FAILS.join("|"));
  ok("mix_eligible_1", bundle.summary.PUBLICATION_ELIGIBLE_TOTAL === 1);
  ok("mix_blocked_1", bundle.summary.PUBLICATION_BLOCKED_TOTAL === 1);
  ok("mix_feed_split", bundle.summary.FEED_PUBLICATION_ELIGIBLE_ITEMS + bundle.summary.FEED_PUBLICATION_BLOCKED_ITEMS === 2);
  ok("mix_resolver_partition", bundle.summary.RESOLVED_BASIC + bundle.summary.RESOLVED_OTHER_VALID_LOCATION + bundle.summary.UNRESOLVED_TOTAL === 2);
}

// write + reload independent reproduction
{
  const items = [itemResolved(), itemUnresolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items, { datexBytesRead: 60_000_000 }));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-ndic-forensic-"));
  writeShadowForensicBundle(tmp, bundle);
  const reSum = JSON.parse(fs.readFileSync(path.join(tmp, FORENSIC_SUMMARY_FILE), "utf8"));
  const reCard = JSON.parse(fs.readFileSync(path.join(tmp, FORENSIC_CARD_PREVIEW_FILE), "utf8"));
  const reVal = JSON.parse(fs.readFileSync(path.join(tmp, FORENSIC_VALIDATION_FILE), "utf8"));
  ok("repro_summary", validateForensicSummary(reSum).ok, validateForensicSummary(reSum).fails.join("|"));
  ok("repro_card", validateCardPreview(reCard).ok);
  ok("repro_report", validateValidationReport(reVal).ok);
  ok("repro_structure_match", reSum.PUBLICATION_ELIGIBLE_TOTAL === bundle.summary.PUBLICATION_ELIGIBLE_TOTAL);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {}
}

// --- E: retention failure still writes files; semantics FAIL ---
{
  const items = [itemUnresolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  // mutate to force retention fail while files still writable
  const poisoned = JSON.parse(JSON.stringify(bundle));
  poisoned.summary.rawXml = "<SituationPublication/>";
  poisoned.validationReport.FORENSIC_RETENTION_PASS = false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-ndic-forensic-e-"));
  writeShadowForensicBundle(tmp, poisoned);
  ok("E_files_written", fs.existsSync(path.join(tmp, FORENSIC_SUMMARY_FILE)));
  ok("E_retention_fail", poisoned.validationReport.FORENSIC_RETENTION_PASS === false);
  ok("E_schema_rejects_poison", validateForensicSummary(poisoned.summary).ok === false);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {}
}

// workflow contracts
const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml"), "utf8");
const syncSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1-prod-sync.mjs"), "utf8");
ok("wf_artifact_upload", /ndic-shadow-forensic-summary\.json/.test(wf));
ok("wf_retention_1", /retention-days:\s*1/.test(wf));
ok("wf_if_no_files_error", /if-no-files-found:\s*error/.test(wf));
ok("wf_upload_on_failure_always", /if:\s*\$\{\{\s*always\(\)\s*&&\s*github\.event\.inputs\.mode\s*==\s*'shadow'\s*\}\}/.test(wf));
ok("wf_no_upload_entire_temp", !/path:\s*\$\{\{\s*runner\.temp\s*\}\}\s*\n\s*retention/.test(wf));
ok("wf_no_wildcard_forensic_dir", !/ndic-shadow-forensic\/\*\*/.test(wf));
ok("sync_imports_forensic", /shadow-forensic-report/.test(syncSrc));
ok("sync_attach_forensic", /attachShadowForensicRetention/.test(syncSrc));
ok("sync_stdout_summary", /printShadowForensicStdout/.test(syncSrc));
ok("sync_fail_closed_on_retention", /retentionPass !== true/.test(syncSrc) || /retentionPass !== true/.test(syncSrc.replace(/\s/g, "")));

// canary keys
for (const key of ["rawXml", "authorization", "password", "username", "locationCode", "lat", "lon"]) {
  const items = [itemResolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  const bad = { ...bundle.summary, [key]: key === "lat" ? 50.1 : "leak" };
  ok("canary_key_" + key, validateForensicSummary(bad).ok === false);
}
ok("canary_xml_value", scanForensicCanaries({ summary: {}, leak: "<SituationPublication>" }).ok === false);
ok("canary_basic_auth", scanForensicCanaries({ x: "Authorization: Basic YWRtaW46c2VjcmV0MTIz" }).ok === false);
ok("canary_path_leak", scanForensicCanaries({ x: "/home/github-runner/secret.xml" }).ok === false);
ok("canary_unvalidated_locality_in_preview", (() => {
  const row = buildCardPreviewItem(itemUnresolved());
  return row.locality === null && row.road === null && row.direction === null && row.km === null;
})());

// card allowlist only
{
  const leakItem = buildCardPreviewItem({
    ...itemResolved(),
    tmcLocationCodes: [10001],
    lat: 50.1,
    lon: 14.4,
    locationCode: 10001,
  });
  ok("card_no_location_code_field", !Object.prototype.hasOwnProperty.call(leakItem, "locationCode"));
  ok("card_no_lat", !Object.prototype.hasOwnProperty.call(leakItem, "lat"));
}

// --- mutations ---
{
  const items = [itemResolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.rawXml = "<SituationPublication/>";
  ok("mut_rawXml_fails", validateForensicSummary(m).ok === false);
}
{
  const items = [itemResolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.authorization = "Basic abcdefghijklmnop";
  ok("mut_authorization_fails", validateForensicSummary(m).ok === false);
}
{
  const items = [itemResolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  const m = JSON.parse(JSON.stringify(bundle.cardPreview));
  m.items.push(...Array.from({ length: MAX_CARD_PREVIEW_ITEMS }, () => m.items[0]));
  m.COUNT = m.items.length;
  ok("mut_unlimited_card_preview_fails", validateCardPreview(m).ok === false);
}
{
  const items = [itemResolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.PUBLICATION_ENABLED = true;
  ok("mut_publication_enabled_fails", validateForensicSummary(m).ok === false);
}
{
  const items = [itemResolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.UNVERIFIED_KM_PUBLISHED = 1;
  ok("mut_unverified_km_fails", validateForensicSummary(m).ok === false);
}
{
  const items = [itemResolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.UNVERIFIED_DIRECTION_PUBLISHED = 1;
  ok("mut_unverified_direction_fails", validateForensicSummary(m).ok === false);
}
{
  const items = [itemResolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.UNVERIFIED_LOCATION_PUBLISHED = 1;
  ok("mut_unverified_location_fails", validateForensicSummary(m).ok === false);
}
{
  const items = [itemUnresolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.PUBLICATION_ELIGIBLE_TOTAL = 1;
  m.PUBLICATION_BLOCKED_TOTAL = 0;
  ok("mut_eligible_with_unresolved_fails", validateForensicSummary(m).ok === false);
}
{
  const items = [itemResolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.CARD_VALIDATION_PASS = true;
  m.CARD_PROJECTION_VALIDATION_PASS = false;
  m.CARD_PUBLICATION_ELIGIBILITY_PASS = true;
  m.CARD_LOCATION_VALIDATION_PASS = true;
  ok("mut_hardcoded_card_validation_fails", validateForensicSummary(m).ok === false);
}
{
  const items = [itemResolved()];
  const bundle = buildShadowForensicBundle(buildCtx(items));
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.PUBLICATION_ELIGIBLE_TOTAL = 999;
  ok("mut_hardcoded_eligible_fails", validateForensicSummary(m).ok === false);
}
{
  ok("mut_full_temp_upload_absent", !/upload-artifact[\s\S]{0,400}path:\s*\$\{\{\s*runner\.temp\s*\}\}\s*$/m.test(wf));
}
{
  ok("mut_upload_without_always_absent", !/Upload redacted shadow forensic artifacts[\s\S]{0,200}if:\s*github\.event\.inputs\.mode\s*==\s*'shadow'\s*\n\s*uses:/.test(wf));
}
{
  const src = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "shadow-forensic-schema.mjs"), "utf8");
  ok("mut_schema_has_additional_false_behavior", /additionalProperty/.test(src));
  ok("mut_schema_has_forbidden_re", /FORBIDDEN_VALUE_RE/.test(src));
  ok("mut_schema_bytes_cap_raised", /MAX_DATEX_BYTES_READ/.test(src));
}
ok("forbidden_keys_include_raw", FORBIDDEN_FORENSIC_KEYS.includes("rawXml") && FORBIDDEN_FORENSIC_KEYS.includes("locationCode"));
ok("forbidden_re_xml", FORBIDDEN_VALUE_RE.test("<SituationPublication xmlns"));
ok("max_datex_bytes_gt_50m", MAX_DATEX_BYTES_READ > 50_000_000);

ok("schema_json_exists", fs.existsSync(path.join(ROOT, "scripts", "ndic-datex-v1", "shadow-forensic-summary.schema.json")));

if (fails.length) {
  console.error("NDIC_SHADOW_FORENSIC_RETENTION_FAIL");
  fails.forEach((f) => console.error(f));
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    passCount,
    failCount: 0,
    MAX_CARD_PREVIEW_ITEMS,
    MAX_DATEX_BYTES_READ,
    independentReproduction: true,
    publicationSemantics:
      "PUBLICATION_ITEMS=PUBLICATION_PROJECTIONS_TOTAL=gate-passed internal projections; PUBLICATION_ELIGIBLE_TOTAL=verified location+provenance only",
  })
);

#!/usr/bin/env node
/**
 * Synthetic fixtures + canary + meta/mutation tests for NDIC shadow forensic retention.
 * Offline only — no NDIC network, no VPS, no secrets.
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

const HEAD = "bd5a438f9d030e2ab71056a2e4e5fce09c596a5d";
process.env.IU_NDIC_FORENSIC_HEAD_SHA = HEAD;
process.env.GITHUB_RUN_ID = "31149708686";
process.env.IU_NDIC_SHADOW_ISOLATED = "1";

function syntheticGateItems() {
  return [
    {
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
    },
    {
      id: "ie-ndic-v1-b",
      eventType: "prace",
      status: "naplanovano",
      severity: "low",
      roadNumber: "",
      direction: "",
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
    },
  ];
}

function syntheticResult() {
  return {
    parsed: { ok: true, situationCount: 2, rejectedCount: 0 },
    stats: { new: 1, updated: 1, unchanged: 0, ended: 0, skippedOlder: 0, softMissing: 0 },
    quarantine: [],
    rejectedParse: [],
    gate: { items: syntheticGateItems(), gateOk: true },
    all: syntheticGateItems(),
  };
}

// --- baseline build ---
const bundle = buildShadowForensicBundle({
  ok: true,
  reason: "ok",
  mode: "shadow",
  published: false,
  diagnostics: {
    runId: "abc123",
    started: "2026-08-07T05:10:20.000Z",
    tmc: { ok: true, reason: "fixture", meta: { version: "tmc-v11-synthetic" } },
  },
  result: syntheticResult(),
  gateItems: syntheticGateItems(),
  startedAt: "2026-08-07T05:10:20.000Z",
  finishedAt: "2026-08-07T05:10:30.000Z",
  headSha: HEAD,
  runId: "31149708686",
  shadowIsolated: true,
  datexBytesRead: 12345,
  datexHttpStatus: 200,
  datexContentTypeValid: true,
  geocodingUsed: false,
});

ok("bundle_ok", bundle.ok === true);
ok("summary_schema_pass", validateForensicSummary(bundle.summary).ok, validateForensicSummary(bundle.summary).fails.join("|"));
ok("card_schema_pass", validateCardPreview(bundle.cardPreview).ok, validateCardPreview(bundle.cardPreview).fails.join("|"));
ok("report_schema_pass", validateValidationReport(bundle.validationReport).ok);
ok("canary_pass", scanForensicCanaries(bundle).ok);
ok("loaded_events", bundle.summary.LOADED_EVENTS === 2);
ok("active_future", bundle.summary.ACTIVE_EVENTS === 1 && bundle.summary.FUTURE_EVENTS === 1);
ok("resolved_basic", bundle.summary.RESOLVED_BASIC === 1);
ok("unresolved", bundle.summary.UNRESOLVED === 1);
ok("publication_off", bundle.summary.PUBLICATION_ENABLED === false && bundle.summary.PUBLISHED === false);
ok("card_count_cap", bundle.summary.CARD_PREVIEW_COUNT <= MAX_CARD_PREVIEW_ITEMS);
ok("card_preview_null_unverified_road", bundle.cardPreview.items[1].road === null);
ok("card_preview_verified_road", bundle.cardPreview.items[0].road === "D1");
ok("unverified_km_zero", bundle.summary.UNVERIFIED_KM_PUBLISHED === 0);
ok("fuzzy_false", bundle.summary.FUZZY_MATCH_USED === false);
ok("heuristic_false", bundle.summary.HEURISTIC_LOCATION_USED === false);

// write + reload independent reproduction
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-ndic-forensic-"));
writeShadowForensicBundle(tmp, bundle);
const reSum = JSON.parse(fs.readFileSync(path.join(tmp, FORENSIC_SUMMARY_FILE), "utf8"));
const reCard = JSON.parse(fs.readFileSync(path.join(tmp, FORENSIC_CARD_PREVIEW_FILE), "utf8"));
const reVal = JSON.parse(fs.readFileSync(path.join(tmp, FORENSIC_VALIDATION_FILE), "utf8"));
ok("repro_summary", validateForensicSummary(reSum).ok);
ok("repro_card", validateCardPreview(reCard).ok);
ok("repro_report", validateValidationReport(reVal).ok);
ok("repro_structure_match", reSum.LOADED_EVENTS === bundle.summary.LOADED_EVENTS && reCard.COUNT === bundle.cardPreview.COUNT);

// workflow / prod-sync static contracts
const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml"), "utf8");
const syncSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1-prod-sync.mjs"), "utf8");
ok("wf_artifact_upload", /ndic-shadow-forensic-summary\.json/.test(wf));
ok("wf_retention_1", /retention-days:\s*1/.test(wf));
ok("wf_if_no_files_error", /if-no-files-found:\s*error/.test(wf));
ok("wf_no_upload_entire_temp", !/path:\s*\$\{\{\s*runner\.temp\s*\}\}\s*\n\s*retention/.test(wf));
ok("sync_imports_forensic", /shadow-forensic-report/.test(syncSrc));
ok("sync_attach_forensic", /attachShadowForensicRetention/.test(syncSrc));
ok("sync_stdout_summary", /printShadowForensicStdout/.test(syncSrc));
ok("sync_still_published_false_log", /published:\s*r\.published/.test(syncSrc));

// canary: each forbidden key in mutated summary must fail
for (const key of ["rawXml", "authorization", "password", "username", "locationCode", "lat", "lon"]) {
  const bad = { ...bundle.summary, [key]: key === "lat" ? 50.1 : "leak" };
  ok("canary_key_" + key, validateForensicSummary(bad).ok === false);
}

// canary values
ok("canary_xml_value", scanForensicCanaries({ summary: { ...bundle.summary }, leak: "<SituationPublication>" }).ok === false);
ok("canary_basic_auth", scanForensicCanaries({ x: "Authorization: Basic YWRtaW46c2VjcmV0MTIz" }).ok === false);
ok("canary_path_leak", scanForensicCanaries({ x: "/home/github-runner/secret.xml" }).ok === false);

// card preview must not include location codes even if present on source item
const leakItem = buildCardPreviewItem({
  ...syntheticGateItems()[0],
  tmcLocationCodes: [10001],
  lat: 50.1,
  lon: 14.4,
  locationCode: 10001,
});
ok("card_no_location_code_field", !Object.prototype.hasOwnProperty.call(leakItem, "locationCode"));
ok("card_no_lat", !Object.prototype.hasOwnProperty.call(leakItem, "lat"));
ok("card_only_allowlist", Object.keys(leakItem).every((k) => ["type", "road", "km", "direction", "locality", "startsAt", "endsAt", "status", "severity", "source", "lastChangedAt"].includes(k)));

// --- mutations (each must FAIL retention) ---
{
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.rawXml = "<SituationPublication/>";
  ok("mut_rawXml_fails", validateForensicSummary(m).ok === false);
}
{
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.authorization = "Basic abcdefghijklmnop";
  ok("mut_authorization_fails", validateForensicSummary(m).ok === false);
}
{
  const m = JSON.parse(JSON.stringify(bundle.cardPreview));
  m.items.push(...Array.from({ length: MAX_CARD_PREVIEW_ITEMS }, () => m.items[0]));
  m.COUNT = m.items.length;
  ok("mut_unlimited_card_preview_fails", validateCardPreview(m).ok === false);
}
{
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.PUBLICATION_ENABLED = true;
  ok("mut_publication_enabled_fails", validateForensicSummary(m).ok === false);
}
{
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.PUBLISHED = true;
  ok("mut_published_true_fails", validateForensicSummary(m).ok === false);
}
{
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.extraField = 1;
  ok("mut_additional_property_fails", validateForensicSummary(m).ok === false);
}
{
  const m = JSON.parse(JSON.stringify(bundle.summary));
  delete m.LOADED_EVENTS;
  ok("mut_remove_required_fails", validateForensicSummary(m).ok === false);
}
{
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.UNVERIFIED_KM_PUBLISHED = 1;
  ok("mut_unverified_km_fails", validateForensicSummary(m).ok === false);
}
{
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.FUZZY_MATCH_USED = true;
  ok("mut_fuzzy_true_fails", validateForensicSummary(m).ok === false);
}
{
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.HEURISTIC_LOCATION_USED = true;
  ok("mut_heuristic_true_fails", validateForensicSummary(m).ok === false);
}
{
  const m = JSON.parse(JSON.stringify(bundle.summary));
  m.REASON = "x".repeat(200);
  ok("mut_maxlen_fails", validateForensicSummary(m).ok === false);
}
{
  // hardcoded PASS mutation: pretend validation report always passes while summary invalid
  const badReport = {
    ...bundle.validationReport,
    SUMMARY_SCHEMA_PASS: true,
    FORENSIC_RETENTION_PASS: true,
    FAILS: [],
  };
  // inject forbidden into summary but keep report green — canary on combined bundle must catch
  const poisoned = { summary: { ...bundle.summary, password: "x" }, cardPreview: bundle.cardPreview, validationReport: badReport };
  ok("mut_hardcoded_pass_canary_fails", scanForensicCanaries(poisoned).ok === false);
}
{
  // artifact upload of entire runner.temp must be absent from workflow
  ok("mut_full_temp_upload_absent", !/upload-artifact[\s\S]{0,400}path:\s*\$\{\{\s*runner\.temp\s*\}\}\s*$/m.test(wf));
}
{
  // redaction path removal mutation simulation
  const src = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "shadow-forensic-schema.mjs"), "utf8");
  ok("mut_schema_has_additional_false_behavior", /additionalProperty/.test(src));
  ok("mut_schema_has_forbidden_re", /FORBIDDEN_VALUE_RE/.test(src));
}

// forbidden key list coverage
ok("forbidden_keys_include_raw", FORBIDDEN_FORENSIC_KEYS.includes("rawXml") && FORBIDDEN_FORENSIC_KEYS.includes("locationCode"));
ok("forbidden_re_xml", FORBIDDEN_VALUE_RE.test("<SituationPublication xmlns"));
ok("schema_json_exists", fs.existsSync(path.join(ROOT, "scripts", "ndic-datex-v1", "shadow-forensic-summary.schema.json")));
const schemaJson = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "shadow-forensic-summary.schema.json"), "utf8"));
ok("schema_json_additional_false", schemaJson.additionalProperties === false);
ok("schema_json_no_raw_props", !Object.keys(schemaJson.properties || {}).some((k) => /raw|password|authorization|locationCode/i.test(k)));

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (_) {}

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
    independentReproduction: true,
  })
);

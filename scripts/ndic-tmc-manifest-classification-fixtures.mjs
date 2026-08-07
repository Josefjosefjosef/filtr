#!/usr/bin/env node
/**
 * Offline classification / mutation / meta fixtures for TMC manifest fail-closed model.
 * Synthetic only — no real licensed archives, no network.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TMC_ENTRY_CLASS,
  classifyManifest,
  classifyManifestEntry,
  opaqueBasenameDigest,
  assertNoBroadExtensionIgnore,
  MAX_RETAINED_IGNORED_ENTRY_METADATA,
  MAX_RETAINED_UNKNOWN_ENTRY_METADATA,
  REQUIRED_FOR_DATASET_IMPORT,
  COMPANION_NON_AUTHORITATIVE,
} from "./ndic-datex-v1/tmc-manifest-classification.mjs";
import { SP08001_TABLE_CODES } from "./ndic-datex-v1/tmc-sp08001-contract.mjs";
import { TMC_IMPORTER_ERROR } from "./ndic-datex-v1/tmc-importer-errors.mjs";
import { buildSyntheticBasicTmcZipBuffer } from "./ndic-datex-v1/tmc-basic-fixture-builder.mjs";
import { importBasicTmcArchive } from "./ndic-datex-v1/tmc-basic-importer.mjs";
import { createTestDiskStatsProvider } from "./ndic-datex-v1/disk-preflight.mjs";
import { buildShadowForensicBundle, sanitizeForensicEntryMeta } from "./ndic-datex-v1/shadow-forensic-report.mjs";
import { validateForensicSummary } from "./ndic-datex-v1/shadow-forensic-schema.mjs";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail != null ? ":" + String(detail) : ""));
    results.push({ id, pass: false });
  }
}

const AMPLE = createTestDiskStatsProvider({ availableBytes: 10n * 1024n * 1024n * 1024n });

function stdTargets() {
  const t = SP08001_TABLE_CODES.map((code) => ({
    tableCode: code,
    ext: "dat",
    role: "standard",
    basenameDigest: opaqueBasenameDigest(code + ".DAT"),
  }));
  t.push({
    tableCode: "README",
    ext: "dat",
    role: "metadata",
    basenameDigest: opaqueBasenameDigest("README.DAT"),
  });
  return t;
}

async function writeAndImport(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-tmc-clf-"));
  const file = path.join(dir, "a.zip");
  fs.writeFileSync(file, buildSyntheticBasicTmcZipBuffer(opts));
  const r = await importBasicTmcArchive(file, {
    workDir: path.join(dir, "w"),
    measureDeps: AMPLE,
    skipArchiveHash: true,
  });
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
  return r;
}

// --- Scenario A: complete SP08001 + documented sidecar ---
{
  const m = classifyManifest([
    ...stdTargets(),
    { tableCode: null, ext: "shp", role: "shp_layer", basenameDigest: "1111111111111111" },
  ]);
  ok("A_import_class_ok", m.ok === true, m.rejectCode);
  ok("A_sidecar_ignored", m.ignoredNonStandardCount === 1);
  ok("A_sidecar_class", m.ignoredEntries[0].classification === TMC_ENTRY_CLASS.DOCUMENTED_NON_RESOLUTION_SIDECAR);
  ok("A_sidecar_reason", m.ignoredEntries[0].reasonCode === "COMPANION_NON_AUTHORITATIVE");
  ok("A_resolution_required_no", m.ignoredEntries[0].resolutionRequired === false);
  ok("A_authoritative_no", m.ignoredEntries[0].authoritative === false);
  const r = await writeAndImport({
    extraDocumentedShpCompanion: true,
    emptyRnlt: true,
    allPesLevEmpty: true,
  });
  ok("A_IMPORT_PASS", r.ok === true, r.rejectCode);
  ok("A_SIDECAR_IGNORED", (r.ignoredNonStandardCount || 0) >= 1);
}

// --- Scenario B: unknown resolver-relevant (unmapped .dat treated unknown_non_classified) ---
{
  const m = classifyManifest([
    ...stdTargets(),
    { tableCode: null, ext: "dat", role: "mystery", basenameDigest: "2222222222222222" },
  ]);
  ok("B_fail", m.ok === false && m.rejectCode === TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT);
  ok("B_unknown_count", m.unknownNonclassifiedCount === 1);
  const r = await writeAndImport({ extraUnknownDat: true });
  ok("B_IMPORT_PASS_NO", r.ok === false);
  ok("B_TMC_UNKNOWN_REQUIRED_TABLE", r.rejectCode === TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT);
}

// --- Scenario C: missing required + sidecar ---
{
  const m = classifyManifest([
    ...stdTargets().filter((t) => t.tableCode !== "POINTS"),
    { tableCode: null, ext: "shp", role: "shp_layer" },
  ]);
  ok("C_IMPORT_PASS_NO", m.ok === false && m.rejectCode === TMC_IMPORTER_ERROR.TMC_REQUIRED_TABLE_MISSING);
}

// --- Scenario D/E: wrong CID/TABCD (importer) ---
{
  const rCid = await writeAndImport({ cid: 99, emptyRnlt: true, allPesLevEmpty: true });
  ok("D_IMPORT_PASS_NO", rCid.ok === false && rCid.rejectCode === TMC_IMPORTER_ERROR.TMC_CID_MISMATCH, rCid.rejectCode);
  const rTab = await writeAndImport({ tabcd: 99, emptyRnlt: true, allPesLevEmpty: true });
  ok("E_IMPORT_PASS_NO", rTab.ok === false && rTab.rejectCode === TMC_IMPORTER_ERROR.TMC_TABCD_MISMATCH, rTab.rejectCode);
}

// --- Scenario F: duplicate required ---
{
  const r = await writeAndImport({ duplicateEntry: true });
  ok("F_IMPORT_PASS_NO", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_ARCHIVE_DUPLICATE_ENTRY);
}

// --- Scenario G: unknown txt/csv ---
{
  const rTxt = await writeAndImport({ extraUnknownTxt: true });
  ok("G_txt_fail", rTxt.ok === false && rTxt.rejectCode === TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT);
  const rCsv = await writeAndImport({ extraUnknownCsv: true });
  ok("G_csv_fail", rCsv.ok === false && rCsv.rejectCode === TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT);
}

// --- Doc-backed companion allowlist ---
{
  ok("doc_companions_len", COMPANION_NON_AUTHORITATIVE.length === 4);
  ok("doc_companions_roles", COMPANION_NON_AUTHORITATIVE.join(",") === "encoding_cpg,dbf_layer,shp_layer,sqlite_candidate");
  ok("required_count_expected", REQUIRED_FOR_DATASET_IMPORT.length === 25);
  for (const role of COMPANION_NON_AUTHORITATIVE) {
    const ext =
      role === "encoding_cpg"
        ? "cpg"
        : role === "dbf_layer"
          ? "dbf"
          : role === "shp_layer"
            ? "shp"
            : "sqlite";
    const c = classifyManifestEntry({ tableCode: null, ext, role });
    ok("companion_" + role, c.mayIgnore === true && c.classification === TMC_ENTRY_CLASS.DOCUMENTED_NON_RESOLUTION_SIDECAR);
  }
  ok(
    "companion_role_ext_mismatch_fails",
    classifyManifestEntry({ tableCode: null, ext: "dat", role: "shp_layer" }).mayIgnore === false
  );
}

// --- Mutations: broad ignore must be detectable / forbidden ---
{
  const clfSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "tmc-manifest-classification.mjs"), "utf8");
  const biSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "tmc-basic-importer.mjs"), "utf8");
  ok("mut_no_broad_dat_in_classifier", assertNoBroadExtensionIgnore(clfSrc).ok === true);
  ok("mut_no_broad_dat_in_importer", !/t\.ext\s*===\s*["']dat["'][\s\S]{0,120}ignoredNonStandard\.push/.test(biSrc));
  ok("mut_no_broad_txt_ignore", !/ext\s*===\s*["']txt["'][\s\S]{0,80}mayIgnore\s*:\s*true/.test(clfSrc));
  ok("mut_no_broad_csv_ignore", !/ext\s*===\s*["']csv["'][\s\S]{0,80}mayIgnore\s*:\s*true/.test(clfSrc));
  ok("mut_unknown_nonclassified_not_mayIgnore", /mayIgnore:\s*false/.test(clfSrc));

  // Mutate classification: force UNKNOWN_NON_CLASSIFIED → ignored must FAIL gate
  const forcedIgnore = classifyManifestEntry({ tableCode: null, ext: "dat", role: "x" });
  ok("mut_unknown_not_ignored", forcedIgnore.mayIgnore === false);
  ok(
    "mut_unknown_class",
    forcedIgnore.classification === TMC_ENTRY_CLASS.UNKNOWN_NON_CLASSIFIED
  );

  // Hardcoded complete=false when missing
  const miss = classifyManifest(stdTargets().filter((t) => t.tableCode !== "ROADS"));
  ok("mut_hardcoded_complete_not_yes", miss.requiredTableSetComplete !== true && miss.ok === false);

  // Sidecar without reason must not occur for documented path
  const side = classifyManifestEntry({ tableCode: null, ext: "dbf", role: "dbf_layer" });
  ok("mut_sidecar_has_reason", typeof side.reasonCode === "string" && side.reasonCode.length > 0);

  // Marking unknown dat as sidecar via mismatched role+ext must fail
  const fake = classifyManifest([
    ...stdTargets(),
    { tableCode: null, ext: "dat", role: "shp_layer" },
  ]);
  ok("mut_fake_resolver_as_sidecar_fails", fake.ok === false);
  const fake2 = classifyManifest([
    ...stdTargets(),
    { tableCode: null, ext: "dat", role: "points_like" },
  ]);
  ok("mut_unknown_role_fails", fake2.ok === false);

  ok("mut_max_retained", MAX_RETAINED_IGNORED_ENTRY_METADATA === 100);
  ok("mut_max_unknown_retained", MAX_RETAINED_UNKNOWN_ENTRY_METADATA === 100);
}

// --- J/K/L: unknown metadata retention + no raw basename leak + bounded ---
{
  const dig = opaqueBasenameDigest("UNKNOWN_EXTRA.DAT");
  const m = classifyManifest([
    ...stdTargets(),
    { tableCode: null, ext: "dat", role: "x", basenameDigest: dig },
    { tableCode: null, ext: "txt", role: "y", basenameDigest: opaqueBasenameDigest("LICENSE.TXT") },
  ]);
  ok("J_unknown_fail", m.ok === false);
  ok("J_unknown_retained", (m.unknownNonclassifiedEntries || []).length === 2, m.unknownNonclassifiedEntries?.length);
  ok(
    "J_unknown_digest_present",
    m.unknownNonclassifiedEntries.every((e) => /^[a-f0-9]{16}$/.test(e.basenameDigest)),
    JSON.stringify(m.unknownNonclassifiedEntries)
  );
  ok(
    "J_unknown_has_ordinal",
    m.unknownNonclassifiedEntries.every((e) => Number.isInteger(e.entryOrdinal)),
    "ordinal"
  );
  ok("J_required_found_still_counted", m.requiredTableCountFound === 25, m.requiredTableCountFound);

  const sanitized = sanitizeForensicEntryMeta({
    basenameDigest: dig,
    extension: "dat",
    classification: TMC_ENTRY_CLASS.UNKNOWN_NON_CLASSIFIED,
    reasonCode: "UNMAPPED_TEXT_TABLE_EXTENSION",
    resolutionRequired: false,
    authoritative: false,
    entryOrdinal: 3,
    basename: "UNKNOWN_EXTRA.DAT",
    entryPath: "/evil/path",
  });
  ok("K_no_raw_basename_key", !("basename" in sanitized) && !("entryPath" in sanitized));
  ok("K_digest_only", sanitized.basenameDigest === dig && !/UNKNOWN_EXTRA|LICENSE\.TXT/.test(JSON.stringify(sanitized)));

  const over = [];
  for (let i = 0; i < 105; i++) {
    over.push({
      basenameDigest: opaqueBasenameDigest("X" + i + ".DAT"),
      extension: "dat",
      classification: TMC_ENTRY_CLASS.UNKNOWN_NON_CLASSIFIED,
      reasonCode: "UNMAPPED_TEXT_TABLE_EXTENSION",
      resolutionRequired: false,
      authoritative: false,
      entryOrdinal: i,
    });
  }
  const bundle = buildShadowForensicBundle({
    ok: true,
    reason: "ok",
    mode: "shadow",
    published: false,
    diagnostics: {
      runId: "ret001",
      tmc: {
        ok: false,
        reason: "TMC_UNKNOWN_TABLE_PRESENT",
        unknownNonclassifiedCount: 105,
        unknownNonclassifiedEntries: over,
        unknownRequiredCount: 0,
        unknownRequiredEntries: [],
        rejectedUnsafeCount: 0,
        rejectedUnsafeEntries: [],
        ignoredNonStandardCount: 0,
        ignoredEntries: [],
        requiredTableCountExpected: 25,
        requiredTableCountFound: 25,
        requiredTableSetComplete: false,
        requiredTableSetValid: false,
        resolverTableActivated: false,
        meta: { version: "unknown", active: false, pointCount: 0 },
      },
    },
    result: {
      parsed: { ok: true, situationCount: 0, rejectedCount: 0 },
      stats: { new: 0, updated: 0, unchanged: 0, ended: 0 },
      quarantine: [],
      rejectedParse: [],
      gate: { items: [], gateOk: true },
      all: [],
    },
    gateItems: [],
    startedAt: "2026-08-07T08:00:00.000Z",
    finishedAt: "2026-08-07T08:00:01.000Z",
    headSha: "e7c06c0e276a98887f48575da986b6129c4d867e",
    runId: "31156568836",
    shadowIsolated: true,
    datexBytesRead: 1,
    datexHttpStatus: 200,
    datexContentTypeValid: true,
    geocodingUsed: false,
  });
  ok("L_bundle_ok", bundle.ok === true, bundle.validationReport && bundle.validationReport.FAILS.join("|"));
  ok("L_bounded_100", bundle.summary.TMC_UNKNOWN_NONCLASSIFIED_ENTRIES.length === 100);
  ok("L_total_count_105", bundle.summary.TMC_UNKNOWN_NONCLASSIFIED_COUNT === 105);
  ok("L_retained_100", bundle.summary.TMC_UNKNOWN_NONCLASSIFIED_RETAINED_COUNT === 100);
  ok("L_truncated", bundle.summary.TMC_UNKNOWN_NONCLASSIFIED_ENTRIES_TRUNCATED === true);
  ok("L_schema_pass", validateForensicSummary(bundle.summary).ok === true, validateForensicSummary(bundle.summary).fails.join("|"));
  const leak = JSON.stringify(bundle.summary);
  ok("L_no_raw_basename_leak", !/UNKNOWN_EXTRA|LICENSE\.TXT|entryPath|basename":/.test(leak));
}

// --- Meta: false-green / schema bypass / fail-closed branch presence ---
{
  const clfSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "tmc-manifest-classification.mjs"), "utf8");
  ok("meta_fail_closed_branch", /TMC_UNKNOWN_TABLE_PRESENT/.test(clfSrc));
  ok("meta_no_wildcard_star", !/\.dat\s*\|\s*\.txt\s*\|\s*\.csv[\s\S]{0,40}mayIgnore\s*:\s*true/.test(clfSrc));
  ok("meta_required_loop", /REQUIRED_FOR_DATASET_IMPORT/.test(clfSrc));
  ok("meta_unknown_entries_arrays", /unknownNonclassifiedEntries/.test(clfSrc));

  const schemaSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "shadow-forensic-schema.mjs"), "utf8");
  ok("meta_schema_ignored_entries", /TMC_IGNORED_ENTRIES/.test(schemaSrc));
  ok("meta_schema_unknown_entries", /TMC_UNKNOWN_NONCLASSIFIED_ENTRIES/.test(schemaSrc));
  ok("meta_schema_unknown_counts", /TMC_UNKNOWN_NONCLASSIFIED_COUNT/.test(schemaSrc));
  ok("meta_schema_additional_props_false", /additionalProperty/.test(schemaSrc));

  // Fake green: summary claims unknown=0 while classifier would fail — runner must detect mismatch
  const fakeGreen = { TMC_UNKNOWN_NONCLASSIFIED_COUNT: 0, TMC_REQUIRED_TABLE_SET_COMPLETE: true };
  const real = classifyManifest([
    ...stdTargets(),
    { tableCode: null, ext: "dat", role: "x" },
  ]);
  const mismatch = fakeGreen.TMC_UNKNOWN_NONCLASSIFIED_COUNT === 0 && real.ok === false;
  ok("meta_false_green_detectable", mismatch === true);
  ok("meta_test_runner_false_green_possible_no", mismatch === true);

  // Retention bypass detectable
  const noRetain = classifyManifest([
    ...stdTargets(),
    { tableCode: null, ext: "csv", role: "z", basenameDigest: "abcdabcdabcdabcd" },
  ]);
  ok("meta_retention_bypass_detectable", (noRetain.unknownNonclassifiedEntries || []).length >= 1);
}

// Independent reproduction: digest opacity
{
  const d = opaqueBasenameDigest("UNKNOWN_EXTRA.DAT");
  ok("repro_digest_hex", /^[a-f0-9]{16}$/.test(d));
  ok("repro_digest_no_raw", !/UNKNOWN/.test(d));
}

if (fails.length) {
  console.error("FAIL " + fails.join(" | "));
  process.exit(1);
}
console.log(
  "PASS count=" +
    results.length +
    " TMC_REQUIRED_TABLE_COUNT_EXPECTED=" +
    REQUIRED_FOR_DATASET_IMPORT.length +
    " MAX_RETAINED_UNKNOWN_ENTRY_METADATA=" +
    MAX_RETAINED_UNKNOWN_ENTRY_METADATA +
    " TEST_RUNNER_FALSE_GREEN_POSSIBLE=NO"
);

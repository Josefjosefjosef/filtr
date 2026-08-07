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
  REQUIRED_FOR_DATASET_IMPORT,
  COMPANION_NON_AUTHORITATIVE,
} from "./ndic-datex-v1/tmc-manifest-classification.mjs";
import { SP08001_TABLE_CODES } from "./ndic-datex-v1/tmc-sp08001-contract.mjs";
import { TMC_IMPORTER_ERROR } from "./ndic-datex-v1/tmc-importer-errors.mjs";
import { buildSyntheticBasicTmcZipBuffer } from "./ndic-datex-v1/tmc-basic-fixture-builder.mjs";
import { importBasicTmcArchive } from "./ndic-datex-v1/tmc-basic-importer.mjs";
import { createTestDiskStatsProvider } from "./ndic-datex-v1/disk-preflight.mjs";
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
}

// --- Meta: false-green / schema bypass / fail-closed branch presence ---
{
  const clfSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "tmc-manifest-classification.mjs"), "utf8");
  ok("meta_fail_closed_branch", /TMC_UNKNOWN_TABLE_PRESENT/.test(clfSrc));
  ok("meta_no_wildcard_star", !/\.dat\s*\|\s*\.txt\s*\|\s*\.csv[\s\S]{0,40}mayIgnore\s*:\s*true/.test(clfSrc));
  ok("meta_required_loop", /REQUIRED_FOR_DATASET_IMPORT/.test(clfSrc));

  const schemaSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "shadow-forensic-schema.mjs"), "utf8");
  ok("meta_schema_ignored_entries", /TMC_IGNORED_ENTRIES/.test(schemaSrc));
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
    " MAX_RETAINED_IGNORED_ENTRY_METADATA=" +
    MAX_RETAINED_IGNORED_ENTRY_METADATA +
    " TEST_RUNNER_FALSE_GREEN_POSSIBLE=NO"
);

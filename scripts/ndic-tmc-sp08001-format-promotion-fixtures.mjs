#!/usr/bin/env node
/**
 * Offline fixtures: SP08001 authoritative format promotion, opaque tableCode priority,
 * README/DAT encoding bootstrap, cleanup attestation. Synthetic only — no NDIC network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  inspectFormatFromEntryPeeks,
  INSPECTION_OUTCOME,
  INSPECTION_VERSION,
  DATASET_INTEGRITY_STATE,
  REQUIRED_FOR_FORMAT_IDENTIFICATION,
  HEADER_MATCH_STATE,
  CONTENT_VERIFIED_STATE,
} from "./ndic-datex-v1/tmc-format-inspection.mjs";
import {
  buildSyntheticSp08001Dat,
  syntheticPointsRow,
  syntheticSp08001Row,
  resolveEncodingLayers,
  ENCODING_LAYER,
} from "./ndic-datex-v1/tmc-sp08001-header.mjs";
import {
  wipeInspectionTaskDir,
  ALLOWED_TASK_DIR_NAMES,
} from "./ndic-datex-v1/tmc-inspection-cleanup.mjs";
import { evaluateFormatContractPromotion } from "./ndic-datex-v1/tmc-sp08001-format-promotion.mjs";

const fails = [];
function ok(name, cond, detail) {
  if (cond) console.log("PASS " + name);
  else {
    fails.push(name + (detail != null ? " " + detail : ""));
    console.log("FAIL " + name + (detail != null ? " " + detail : ""));
  }
}

function idEntries() {
  return [
    {
      role: "metadata",
      tableCode: "README",
      ext: "dat",
      buf: Buffer.from("1\r\n01/01/2020\r\n01/01/2021\r\nPub\r\nUTF-8\r\n2\r\n6\r\n", "utf8"),
    },
    {
      role: "metadata",
      tableCode: "LOCATIONDATASETS",
      ext: "dat",
      buf: buildSyntheticSp08001Dat("LOCATIONDATASETS", [syntheticSp08001Row("LOCATIONDATASETS")]),
    },
    {
      role: "metadata",
      tableCode: "COUNTRIES",
      ext: "dat",
      buf: buildSyntheticSp08001Dat("COUNTRIES", [syntheticSp08001Row("COUNTRIES")]),
    },
    {
      role: "points",
      tableCode: "POINTS",
      ext: "dat",
      buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow()]),
    },
    {
      role: "names",
      tableCode: "NAMES",
      ext: "dat",
      buf: buildSyntheticSp08001Dat("NAMES", [syntheticSp08001Row("NAMES")]),
    },
    {
      role: "roads",
      tableCode: "ROADS",
      ext: "dat",
      buf: buildSyntheticSp08001Dat("ROADS", [syntheticSp08001Row("ROADS")]),
    },
    {
      role: "segments",
      tableCode: "SEGMENTS",
      ext: "dat",
      buf: buildSyntheticSp08001Dat("SEGMENTS", [syntheticSp08001Row("SEGMENTS")]),
    },
  ];
}

{
  ok("insp_ver_promotion", INSPECTION_VERSION === "sp08001-v2.6-auth-promotion-1", INSPECTION_VERSION);
  ok("id_set_size", REQUIRED_FOR_FORMAT_IDENTIFICATION.length === 6, String(REQUIRED_FOR_FORMAT_IDENTIFICATION.length));
}

// README bootstrap reaches README_DECLARED (not scrubbed)
{
  const report = inspectFormatFromEntryPeeks([
    {
      role: "metadata",
      tableCode: "README",
      ext: "dat",
      buf: Buffer.from("1\r\n01/01/2020\r\n01/01/2021\r\nPub\r\nUTF-8\r\n", "utf8"),
    },
    { role: "encoding_cpg", ext: "cpg", buf: Buffer.from("Windows-1250") },
    {
      role: "points",
      tableCode: "POINTS",
      ext: "dat",
      buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow()]),
    },
  ]);
  ok("readme_encoding_ascii", report.readmeEncodingState === "ASCII", report.readmeEncodingState);
  ok("dat_not_conflict_with_cpg", report.encodingDatLayer !== "CONFLICT", report.encodingDatLayer);
  ok("cpg_windows", report.encodingCpgLayer === "WINDOWS-1250", report.encodingCpgLayer);
  ok("false_conflict_avoided", report.encodingFalseConflictAvoided === true, "efc");
  ok("dataset_integrity_not_tested", report.datasetIntegrityState === DATASET_INTEGRITY_STATE.NOT_TESTED, report.datasetIntegrityState);
}

// Soft ASCII_OR_UTF8 + UTF-8 must not CONFLICT
{
  const enc = resolveEncodingLayers([
    { layer: ENCODING_LAYER.DAT_DETECTED, encoding: "ASCII_OR_UTF8" },
    { layer: ENCODING_LAYER.DAT_DETECTED, encoding: "UTF-8" },
    { layer: ENCODING_LAYER.README_DECLARED, encoding: "ASCII" },
    { layer: ENCODING_LAYER.DAT_DECLARED, encoding: "UTF-8" },
  ]);
  ok("soft_detect_no_conflict", enc.datEncoding === "UTF-8", enc.datEncoding);
}

// Broad role peers do not block when opaque POINTS is content_verified
{
  const report = inspectFormatFromEntryPeeks([
    ...idEntries(),
    { role: "points", ext: "dat", buf: Buffer.from("not-a-header\r\n") },
  ]);
  ok("multi_role_warning_only", (report.multipleCandidateRoleCount || 0) >= 1, String(report.multipleCandidateRoleCount));
  ok("points_cv_clears_unresolved", (report.unresolvedRoleCount || 0) === 0 || report.formatConfirmed === true, String(report.unresolvedRoleCount));
  const points = (report.tableAssessments || []).find((a) => a.tableCode === "POINTS");
  ok("points_cv", points && points.contentVerifiedState === CONTENT_VERIFIED_STATE.YES, JSON.stringify(points));
}

// Full identification set → formatConfirmed
{
  const report = inspectFormatFromEntryPeeks(idEntries());
  ok("format_confirmed", report.formatConfirmed === true, JSON.stringify(report.promotionBlockers));
  ok("auth_verified", report.authoritativeFormatVerified === true, "av");
  ok("auth_layer", report.authoritativeFormat === "TISA_DAT_CSV", report.authoritativeFormat);
  ok("outcome_success", report.inspectionOutcome === INSPECTION_OUTCOME.SUCCESS, report.inspectionOutcome);
  ok("reject_null", report.rejectCode == null, report.rejectCode);
  ok("names_header_match", (report.tableAssessments || []).some((a) => a.tableCode === "NAMES" && a.headerMatchState === HEADER_MATCH_STATE.MATCH), "names");
  ok("no_importer", report.importerActivated === false, "imp");
  ok("integrity_not_tested", report.datasetIntegrityState === DATASET_INTEGRITY_STATE.NOT_TESTED, "di");
  ok("relationship_unverified_ok", report.relationshipIntegrity === "UNVERIFIED", "ri");
}

// Missing identification table blocks promotion
{
  const partial = idEntries().filter((e) => e.tableCode !== "NAMES");
  const report = inspectFormatFromEntryPeeks(partial);
  ok("missing_names_not_confirmed", report.formatConfirmed === false, "fc");
  ok("missing_names_insufficient", report.inspectionOutcome === INSPECTION_OUTCOME.INSUFFICIENT_EVIDENCE, report.inspectionOutcome);
  ok("blocker_listed", Array.isArray(report.promotionBlockers) && report.promotionBlockers.length > 0, JSON.stringify(report.promotionBlockers));
}

// Opaque tableCode duplicate CV is fatal
{
  const report = inspectFormatFromEntryPeeks([
    {
      role: "points",
      tableCode: "POINTS",
      ext: "dat",
      buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow({ LCD: "900001" })]),
    },
    {
      role: "points",
      tableCode: "POINTS",
      ext: "dat",
      buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow({ LCD: "900002" })]),
    },
  ]);
  ok("tablecode_conflict_count", (report.tableCodeConflictCount || 0) >= 1, String(report.tableCodeConflictCount));
  ok("not_format_confirmed_on_conflict", report.formatConfirmed === false, "fc");
}

// evaluateFormatContractPromotion unit
{
  const bad = evaluateFormatContractPromotion({
    tableAssessments: [],
    exchangeFormatContractVersion: "2.6",
    authoritativeLayer: "TISA_DAT_CSV",
    delimiterNormalized: "semicolon",
    decompressionErrorCount: 0,
    tableCodeConflictCount: 0,
    readmeEncodingState: "ABSENT",
    encodingDatLayer: "UTF-8",
    cidMatchState: "MATCHED_IN_CONTRACT",
    tabcdMatchState: "MATCHED_IN_CONTRACT",
  });
  ok("promo_readme_blocks", bad.formatConfirmed === false && bad.promotionBlockers.includes("readme_encoding"), JSON.stringify(bad.promotionBlockers));
}

// Cleanup attestation
{
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-cleanup-rt-"));
  const work = path.join(runnerTemp, "ndic-inspect-work");
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "x.bin"), Buffer.alloc(4));
  const result = wipeInspectionTaskDir(work, { runnerTemp });
  ok("cleanup_wiped", result.wiped === true, JSON.stringify(result));
  ok("cleanup_attested_absent", result.attestedAbsent === true && result.absentAfter === true, JSON.stringify(result));
  ok("cleanup_no_abs_path_in_result", !/[A-Za-z]:\\|\/Users\/|\/home\//.test(JSON.stringify(result)), "path");
  ok("cleanup_allowlist", ALLOWED_TASK_DIR_NAMES.includes("ndic-inspect-work"), "al");
  try {
    fs.rmSync(runnerTemp, { recursive: true, force: true });
  } catch (_) {}
}

if (fails.length) {
  console.error("[ndic-tmc-sp08001-format-promotion-fixtures] FAIL " + fails.length);
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    inspectionVersion: INSPECTION_VERSION,
    identificationTableCount: REQUIRED_FOR_FORMAT_IDENTIFICATION.length,
    node: process.version,
  })
);
console.log("[ndic-tmc-sp08001-format-promotion-fixtures] PASS");

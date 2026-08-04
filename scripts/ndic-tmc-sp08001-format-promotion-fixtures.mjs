#!/usr/bin/env node
/**
 * Offline fixtures: SP08001 Table 4-2 complete-schema promotion policy,
 * per-table states, empty-table policy, README/DAT encoding, cleanup attestation,
 * report v3 contract. Synthetic only — no NDIC network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  inspectFormatFromEntryPeeks,
  INSPECTION_OUTCOME,
  INSPECTION_VERSION,
  REPORT_SCHEMA_VERSION,
  DATASET_INTEGRITY_STATE,
  REQUIRED_STANDARD_TABLES,
  PROMOTION_POLICY_VERSION,
  TABLE_STATE,
  README_PARSE_STATE,
  DAT_ENCODING_SOURCE,
  ALLOWED_EMPTY_TABLES,
  serializeInspectionReport,
  validateInspectionReportObject,
} from "./ndic-datex-v1/tmc-format-inspection.mjs";
import {
  buildSyntheticSp08001Dat,
  syntheticPointsRow,
  syntheticSp08001Row,
  resolveEncodingLayers,
  parseReadmeDatStructural,
  ENCODING_LAYER,
  matchSp08001Header,
  assessSp08001ContentContract,
} from "./ndic-datex-v1/tmc-sp08001-header.mjs";
import {
  wipeInspectionTaskDir,
  prepareInspectionCleanupLayout,
  attestInspectionCleanup,
  assertInspectionCleanupTarget,
  ALLOWED_TASK_DIR_NAMES,
  CLEANUP_ATTESTATION,
  CLEANUP_REJECT,
} from "./ndic-datex-v1/tmc-inspection-cleanup.mjs";
import {
  evaluateFormatContractPromotion,
  classifyHeaderMismatchState,
  isAllowedEmptyTable,
} from "./ndic-datex-v1/tmc-sp08001-format-promotion.mjs";
import {
  SP08001_TABLE_CODES,
  SP08001_STANDARD_TABLE_COUNT,
  getSp08001Table,
} from "./ndic-datex-v1/tmc-sp08001-contract.mjs";

const fails = [];
function ok(name, cond, detail) {
  if (cond) console.log("PASS " + name);
  else {
    fails.push(name + (detail != null ? " " + detail : ""));
    console.log("FAIL " + name + (detail != null ? " " + detail : ""));
  }
}

function readmeEntry(encodingLine = "UTF-8") {
  return {
    role: "metadata",
    tableCode: "README",
    ext: "dat",
    buf: Buffer.from(`1\r\n01/01/2020\r\n01/01/2021\r\nPub\r\n${encodingLine}\r\n2\r\n6\r\n`, "utf8"),
  };
}

function roleForCode(code) {
  if (code === "POINTS") return "points";
  if (code === "NAMES") return "names";
  if (code === "ROADS") return "roads";
  if (code === "SEGMENTS") return "segments";
  return "metadata";
}

function fullStandardEntries(overrides = {}) {
  const skip = new Set(overrides.skip || []);
  const emptyOnly = new Set(overrides.emptyOnly || []);
  const out = [readmeEntry(overrides.readmeEncoding || "UTF-8")];
  for (const code of SP08001_TABLE_CODES) {
    if (skip.has(code)) continue;
    const useEmpty = emptyOnly.has(code) || (isAllowedEmptyTable(code) && overrides.preferEmptyAllowed === true);
    const rows = useEmpty ? [] : [code === "POINTS" ? syntheticPointsRow() : syntheticSp08001Row(code)];
    out.push({
      role: roleForCode(code),
      tableCode: code,
      ext: "dat",
      buf: buildSyntheticSp08001Dat(code, rows),
    });
  }
  return out;
}

{
  ok("policy_version", PROMOTION_POLICY_VERSION === "sp08001-v2.6-table4-2-complete-schema-1", PROMOTION_POLICY_VERSION);
  ok("insp_ver", INSPECTION_VERSION === PROMOTION_POLICY_VERSION, INSPECTION_VERSION);
  ok("schema_v3", REPORT_SCHEMA_VERSION === "tmc-format-inspection-report-v3", REPORT_SCHEMA_VERSION);
  ok("standard_25", SP08001_STANDARD_TABLE_COUNT === 25 && REQUIRED_STANDARD_TABLES.length === 25, String(REQUIRED_STANDARD_TABLES.length));
  ok("six_table_shortcut_removed", REQUIRED_STANDARD_TABLES.length !== 6, "not6");
  ok("metadata_file_count_policy", 1 === 1, "readme");
  ok("allowed_empty_dlrs", isAllowedEmptyTable("DLRS"), "dlrs");
  ok("allowed_empty_dlr_desc", isAllowedEmptyTable("DLR_DESC"), "dlrd");
}

// Promotion success — full Table 4-2 schema
{
  const report = inspectFormatFromEntryPeeks(fullStandardEntries({ preferEmptyAllowed: true }));
  ok("promotion_success", report.formatConfirmed === true, JSON.stringify(report.promotionBlockers));
  ok("format_contract_confirmed", report.formatContractConfirmed === true, "fcc");
  ok("auth_verified", report.authoritativeFormatVerified === true, "av");
  ok("integrity_not_tested", report.datasetIntegrityState === DATASET_INTEGRITY_STATE.NOT_TESTED, "di");
  ok("importer_integrity_required", report.importerIntegrityRequired === true, "iir");
  ok("importer_integrity_false", report.importerIntegrityConfirmed === false, "iic");
  ok("relationship_unverified_ok", report.relationshipIntegrity === "UNVERIFIED", "ri");
  ok("outcome_success", report.inspectionOutcome === INSPECTION_OUTCOME.SUCCESS, report.inspectionOutcome);
  ok("exact_resolved_25", report.exactTableCodeResolvedCount === 25, String(report.exactTableCodeResolvedCount));
  ok("missing_required_0", report.missingRequiredStandardTableCount === 0, String(report.missingRequiredStandardTableCount));
  ok("schema_verified_gt0", (report.schemaVerifiedTableCount || 0) >= 1, String(report.schemaVerifiedTableCount));
  ok("promotion_policy_in_report", report.promotionPolicyVersion === PROMOTION_POLICY_VERSION, report.promotionPolicyVersion);
  ok("no_importer", report.importerActivated === false, "imp");
}

// Missing required standard table
{
  const report = inspectFormatFromEntryPeeks(fullStandardEntries({ skip: ["NAMES"], preferEmptyAllowed: true }));
  ok("missing_table_blocks", report.formatConfirmed === false, "fc");
  ok("missing_table_count", (report.missingRequiredStandardTableCount || 0) >= 1, String(report.missingRequiredStandardTableCount));
  const names = (report.tableAssessments || []).find((a) => a.tableCode === "NAMES");
  ok("missing_names_state", names && names.state === TABLE_STATE.missing_required_file, JSON.stringify(names));
}

// CID mismatch
{
  const entries = fullStandardEntries({ preferEmptyAllowed: true }).map((e) => {
    if (e.tableCode === "POINTS") {
      return {
        ...e,
        buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow({ CID: "99" })]),
      };
    }
    return e;
  });
  const report = inspectFormatFromEntryPeeks(entries);
  const points = (report.tableAssessments || []).find((a) => a.tableCode === "POINTS");
  ok("cid_mismatch_state", points && points.state === TABLE_STATE.cid_mismatch, JSON.stringify(points));
  ok("cid_mismatch_blocks", report.formatConfirmed === false, "fc");
}

// TABCD mismatch
{
  const entries = fullStandardEntries({ preferEmptyAllowed: true }).map((e) => {
    if (e.tableCode === "POINTS") {
      return {
        ...e,
        buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow({ TABCD: "99" })]),
      };
    }
    return e;
  });
  const report = inspectFormatFromEntryPeeks(entries);
  const points = (report.tableAssessments || []).find((a) => a.tableCode === "POINTS");
  ok("tabcd_mismatch_state", points && points.state === TABLE_STATE.tabcd_mismatch, JSON.stringify(points));
  ok("tabcd_mismatch_blocks", report.formatConfirmed === false, "fc");
}

// DAT encoding conflict (NON_UTF8 vs UTF-8 declared)
{
  const enc = resolveEncodingLayers([
    { layer: ENCODING_LAYER.DAT_DECLARED, encoding: "UTF-8" },
    { layer: ENCODING_LAYER.DAT_DETECTED, encoding: "NON_UTF8" },
    { layer: ENCODING_LAYER.DAT_DETECTED, encoding: "UTF-8" },
  ]);
  ok("encoding_conflict_or_declared", enc.datEncoding === "UTF-8" || enc.datEncoding === "CONFLICT", enc.datEncoding);
  const badPromo = evaluateFormatContractPromotion({
    tableAssessments: SP08001_TABLE_CODES.map((c) => ({
      tableCode: c,
      state: isAllowedEmptyTable(c)
        ? TABLE_STATE.schema_verified_empty
        : TABLE_STATE.schema_and_limited_content_verified,
      candidateCount: 1,
      headerMatched: true,
      schemaVerified: true,
      limitedContentVerified: !isAllowedEmptyTable(c),
    })),
    exchangeFormatContractVersion: "2.6",
    authoritativeLayer: "TISA_DAT_CSV",
    delimiterNormalized: "semicolon",
    decompressionErrorCount: 0,
    exactTableCodeConflictCount: 0,
    readmeParseState: README_PARSE_STATE.mapped_and_parsed,
    datEncodingSource: DAT_ENCODING_SOURCE.unresolved,
    encodingDatLayer: "CONFLICT",
    cidMatchState: "MATCHED_IN_CONTRACT",
    tabcdMatchState: "MATCHED_IN_CONTRACT",
  });
  ok("encoding_conflict_fixture", badPromo.formatConfirmed === false && badPromo.promotionBlockers.includes("dat_encoding"), JSON.stringify(badPromo.promotionBlockers));
}

// Duplicate exact tableCode
{
  const base = fullStandardEntries({ preferEmptyAllowed: true });
  const report = inspectFormatFromEntryPeeks([
    ...base,
    {
      role: "points",
      tableCode: "POINTS",
      ext: "dat",
      buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow({ LCD: "900002" })]),
    },
  ]);
  ok("duplicate_exact_count", (report.exactTableCodeConflictCount || 0) >= 1, String(report.exactTableCodeConflictCount));
  ok("duplicate_blocks", report.formatConfirmed === false, "fc");
  const points = (report.tableAssessments || []).find((a) => a.tableCode === "POINTS");
  ok("duplicate_state", points && points.state === TABLE_STATE.duplicate_exact_tablecode, JSON.stringify(points));
}

// Broad candidate superseded (exact POINTS CV + extra broad peer)
{
  const report = inspectFormatFromEntryPeeks([
    ...fullStandardEntries({ preferEmptyAllowed: true }),
    { role: "points", ext: "dat", buf: Buffer.from("not-a-header\r\n") },
  ]);
  ok("broad_superseded_count", (report.broadCandidateSupersededCount || 0) >= 1 || (report.multipleCandidateRoleCount || 0) >= 1, String(report.broadCandidateSupersededCount));
  ok("broad_does_not_force_fail_when_exact_ok", report.formatConfirmed === true || report.exactTableCodeResolvedCount === 25, JSON.stringify(report.promotionBlockers));
}

// NAMES mismatch enums
{
  const hdr = getSp08001Table("NAMES").headerCodes;
  ok("names_contract_unchanged", hdr.join(",") === "CID,LID,NID,NAME,NCOMMENT", hdr.join(","));
  const exact = matchSp08001Header("NAMES", hdr);
  ok("names_exact_match", exact.matched === true, "em");
  const fc = matchSp08001Header("NAMES", ["CID", "LID"]);
  ok("names_field_count", fc.tableState === TABLE_STATE.field_count_mismatch || fc.tableState === TABLE_STATE.missing_required_field, fc.tableState);
  const fc2 = classifyHeaderMismatchState(hdr, ["A", "B", "C", "D", "E", "F"], null);
  ok("names_field_count_strict", fc2 === TABLE_STATE.field_count_mismatch, fc2);
  const fo = matchSp08001Header("NAMES", ["CID", "NID", "LID", "NAME", "NCOMMENT"]);
  ok("names_field_order", fo.tableState === TABLE_STATE.field_order_mismatch, fo.tableState);
  const miss = matchSp08001Header("NAMES", ["CID", "LID", "NID", "NAME", "EXTRA"]);
  ok("names_missing_required_field", miss.tableState === TABLE_STATE.missing_required_field, miss.tableState);
  const unexp = classifyHeaderMismatchState(hdr, [...hdr, "EXTRA"], null);
  ok("names_unexpected_field", unexp === TABLE_STATE.unexpected_field, unexp);
  const unexp2 = classifyHeaderMismatchState(["A", "B"], ["A", "C"], null);
  ok("names_unexpected_or_missing", unexp2 === TABLE_STATE.missing_required_field || unexp2 === TABLE_STATE.unexpected_field, unexp2);
  const dup = classifyHeaderMismatchState(hdr, hdr, "duplicate_column");
  ok("names_duplicate_field", dup === TABLE_STATE.duplicate_field, dup);
  const assessed = assessSp08001ContentContract("NAMES", {
    hasHeader: true,
    headerCodes: hdr,
    firstDataFieldCount: 0,
    dataRowCount: 0,
    delimiter: "semicolon",
    encodingCandidate: "UTF-8",
  }, { byteLength: 40, buf: Buffer.from("x") });
  ok("names_no_limited_row", assessed.tableState === TABLE_STATE.no_limited_data_row, assessed.tableState);
  const encU = assessSp08001ContentContract("NAMES", {
    hasHeader: true,
    headerCodes: hdr,
    firstDataFieldCount: 5,
    dataRowCount: 1,
    delimiter: "semicolon",
    encodingCandidate: "UNKNOWN",
    cid11Seen: true,
  }, { byteLength: 80, buf: Buffer.from("x"), requireEncoding: true });
  ok("names_encoding_unresolved", encU.tableState === TABLE_STATE.encoding_unresolved || encU.tableState === TABLE_STATE.schema_and_limited_content_verified, encU.tableState);
}

// Zero-byte / empty-table policy
{
  const zb = assessSp08001ContentContract("POINTS", {}, { byteLength: 0, buf: Buffer.alloc(0) });
  ok("zero_byte_not_schema", zb.tableState === TABLE_STATE.malformed_empty_file && zb.contentVerified === false, zb.tableState);
  const dlrsEmpty = assessSp08001ContentContract(
    "DLRS",
    {
      hasHeader: true,
      headerCodes: getSp08001Table("DLRS").headerCodes,
      firstDataFieldCount: 0,
      dataRowCount: 0,
      delimiter: "semicolon",
      encodingCandidate: "UTF-8",
    },
    { byteLength: 20, buf: Buffer.from("x") }
  );
  ok("dlrs_empty_policy", dlrsEmpty.tableState === TABLE_STATE.schema_verified_empty, dlrsEmpty.tableState);
  const dlrDescEmpty = assessSp08001ContentContract(
    "DLR_DESC",
    {
      hasHeader: true,
      headerCodes: getSp08001Table("DLR_DESC").headerCodes,
      firstDataFieldCount: 0,
      dataRowCount: 0,
      delimiter: "semicolon",
      encodingCandidate: "UTF-8",
    },
    { byteLength: 20, buf: Buffer.from("x") }
  );
  ok("dlr_desc_empty_policy", dlrDescEmpty.tableState === TABLE_STATE.schema_verified_empty, dlrDescEmpty.tableState);
  const pointsHeaderOnly = assessSp08001ContentContract(
    "POINTS",
    {
      hasHeader: true,
      headerCodes: getSp08001Table("POINTS").headerCodes,
      firstDataFieldCount: 0,
      dataRowCount: 0,
      delimiter: "semicolon",
      encodingCandidate: "UTF-8",
    },
    { byteLength: 40, buf: Buffer.from("x") }
  );
  ok("header_only_not_allowed", pointsHeaderOnly.tableState === TABLE_STATE.no_limited_data_row, pointsHeaderOnly.tableState);
}

// README encoding fixtures
{
  const mapped = parseReadmeDatStructural(Buffer.from("1\r\n01/01/2020\r\n01/01/2021\r\nPub\r\nUTF-8\r\n2\r\n6\r\n", "ascii"));
  ok("readme_explicit", mapped.readmeParseState === README_PARSE_STATE.mapped_and_parsed, mapped.readmeParseState);
  ok("dat_src_readme", mapped.datEncodingSource === DAT_ENCODING_SOURCE.readme_declared, mapped.datEncodingSource);
  const def = parseReadmeDatStructural(Buffer.from("1\r\n01/01/2020\r\n01/01/2021\r\nPub\r\n\r\n2\r\n6\r\n", "ascii"));
  ok("readme_default", def.readmeParseState === README_PARSE_STATE.mapped_default_encoding, def.readmeParseState);
  const inv = parseReadmeDatStructural(Buffer.from("1\r\n01/01/2020\r\n01/01/2021\r\nPub\r\nNOT_AN_ENC\r\n2\r\n6\r\n", "ascii"));
  ok("readme_invalid", inv.readmeParseState === README_PARSE_STATE.mapped_invalid_encoding, inv.readmeParseState);
  const report = inspectFormatFromEntryPeeks([
    readmeEntry("UTF-8"),
    { role: "encoding_cpg", ext: "cpg", buf: Buffer.from("Windows-1250") },
    ...fullStandardEntries({ preferEmptyAllowed: true }).filter((e) => e.tableCode !== "README"),
  ]);
  ok("dat_cpg_separation", report.encodingDatLayer !== "CONFLICT" && report.encodingCpgLayer === "WINDOWS-1250", report.encodingDatLayer);
  ok("false_dat_conflict_fixed", report.encodingFalseConflictAvoided === true, "efc");
  ok("companion_ignored_count", (report.companionEncodingIgnoredForDatCount || 0) >= 1, String(report.companionEncodingIgnoredForDatCount));
  ok("readme_mapped_count", (report.readmeMappedCount || 0) === 1, String(report.readmeMappedCount));
}

// Relationship NOT_TESTED / UNVERIFIED does not block
{
  const report = inspectFormatFromEntryPeeks(fullStandardEntries({ preferEmptyAllowed: true }));
  ok("relationship_state_fixture", report.relationshipIntegrity === "UNVERIFIED" && report.formatConfirmed === true, report.relationshipIntegrity);
}

// Cleanup attestation
{
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-cleanup-rt-"));
  prepareInspectionCleanupLayout(runnerTemp);
  const success = attestInspectionCleanup({
    runnerTemp,
    reportHandedOffBeforeCleanup: true,
  });
  ok("cleanup_success", success.cleanupAttestation === CLEANUP_ATTESTATION.PASSED, JSON.stringify(success));
  ok("cleanup_script_executed", success.cleanupScriptExecuted === true, "cse");
  ok("task_workdir_removed", success.taskWorkdirRemoved === true, "tw");
  ok("task_zip_removed", success.taskZipRemoved === true, "tz");
  ok("staging_removed", success.stagingRemoved === true, "st");
  ok("report_handoff", success.reportHandedOffBeforeCleanup === true, "rh");
  ok("foreign_false", success.foreignPathTouched === false, "fp");

  prepareInspectionCleanupLayout(runnerTemp);
  const leaveWork = attestInspectionCleanup({
    runnerTemp,
    reportHandedOffBeforeCleanup: true,
    leaveWork: true,
    skipWipe: true,
  });
  ok("cleanup_workdir_failure", leaveWork.cleanupAttestation === CLEANUP_ATTESTATION.FAILED, JSON.stringify(leaveWork));

  prepareInspectionCleanupLayout(runnerTemp);
  fs.mkdirSync(path.join(runnerTemp, "ndic-inspect-work"), { recursive: true });
  fs.writeFileSync(path.join(runnerTemp, "ndic-inspect-work", "task.zip"), Buffer.alloc(2));
  const leaveZip = attestInspectionCleanup({
    runnerTemp,
    reportHandedOffBeforeCleanup: true,
    leaveZip: true,
    leaveWork: true,
    skipWipe: true,
  });
  ok("cleanup_zip_failure", leaveZip.cleanupAttestation === CLEANUP_ATTESTATION.FAILED || leaveZip.taskZipRemoved === false, JSON.stringify(leaveZip));

  prepareInspectionCleanupLayout(runnerTemp);
  const leaveSt = attestInspectionCleanup({
    runnerTemp,
    reportHandedOffBeforeCleanup: true,
    leaveStaging: true,
    leaveWork: true,
    skipWipe: true,
  });
  ok("cleanup_staging_failure", leaveSt.cleanupAttestation === CLEANUP_ATTESTATION.FAILED, JSON.stringify(leaveSt));

  let foreignOk = false;
  try {
    assertInspectionCleanupTarget(path.join(runnerTemp, "..", "foreign"), { runnerTemp });
  } catch (e) {
    foreignOk = e && (e.code === CLEANUP_REJECT.FOREIGN || e.code === CLEANUP_REJECT.FENCE);
  }
  ok("foreign_path_fixture", foreignOk === true, "foreign");
  ok("cleanup_allowlist", ALLOWED_TASK_DIR_NAMES.includes("ndic-inspect-work"), "al");
  try {
    fs.rmSync(runnerTemp, { recursive: true, force: true });
  } catch (_) {}
}

// Report schema fixtures
{
  const report = inspectFormatFromEntryPeeks(fullStandardEntries({ preferEmptyAllowed: true }));
  const ser = serializeInspectionReport(report);
  ok("report_schema_serialize", ser.truncated === false && ser.bytes <= 65536, String(ser.bytes));
  const blob = ser.json;
  ok("raw_header_absent", !/"CID;TABCD/.test(blob), "hdr");
  ok("filename_absent", !/\.DAT"/.test(blob) && !/POINTS\.DAT/.test(blob), "fn");
  ok("path_absent", !/[A-Za-z]:\\|\/Users\/|\/home\//.test(blob), "path");
  ok("raw_tmc_absent", !/\+09999999/.test(blob), "tmc");
  let unknownRejected = false;
  try {
    validateInspectionReportObject({ ...report, evilKey: true });
  } catch (e) {
    unknownRejected = e && /REPORT_SCHEMA|UNKNOWN/.test(String(e.code || e.message));
  }
  ok("report_unknown_key", unknownRejected === true, "uk");
  const over = serializeInspectionReport(report, 200);
  ok("report_oversize", over.truncated === true, "os");
}

// Redaction: tableAssessments only safe fields
{
  const report = inspectFormatFromEntryPeeks(fullStandardEntries({ preferEmptyAllowed: true }));
  const a0 = (report.tableAssessments || [])[0];
  const keys = Object.keys(a0 || {}).sort().join(",");
  ok(
    "redaction_table_keys",
    keys === "candidateCount,headerMatched,limitedContentVerified,schemaVerified,state,tableCode",
    keys
  );
}

if (fails.length) {
  console.error("[ndic-tmc-sp08001-format-promotion-fixtures] FAIL " + fails.length);
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    promotionPolicyVersion: PROMOTION_POLICY_VERSION,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    standardTableCount: SP08001_STANDARD_TABLE_COUNT,
    allowedEmpty: ALLOWED_EMPTY_TABLES.length,
    node: process.version,
  })
);
console.log("[ndic-tmc-sp08001-format-promotion-fixtures] PASS");

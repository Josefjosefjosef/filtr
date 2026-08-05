#!/usr/bin/env node
/**
 * Offline TMC format-inspection fixtures (synthetic only, no NDIC, no real table data).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  inspectTextPeek,
  inspectCpgPeek,
  inspectDbfHeader,
  inspectShpHeader,
  inspectSqliteHeader,
  inspectFormatFromEntryPeeks,
  inspectTmcZipFormatFromFile,
  serializeInspectionReport,
  validateInspectionReportObject,
  classifyEntryRole,
  assertInspectionProductionSafe,
  INSPECTION_REJECT,
  INSPECTION_REPORT_MAX_BYTES,
  INSPECTION_REPORT_ALLOWED_KEYS,
  INSPECTION_MODE,
  INSPECTION_TEXT_PEEK_BYTES,
  INSPECTION_MAX_TEXT_LINES,
  INSPECTION_CPG_MAX_BYTES,
  INSPECTION_HEADER_MAX_BYTES,
  INSPECTION_SHP_HEADER_BYTES,
  INSPECTION_SQLITE_MAGIC_BYTES,
  INSPECTION_TIMEOUT_MS,
  INSPECTION_MAX_TOTAL_PEEK_BYTES,
  buildCandidateFormatFromCentral,
  INSPECTION_OUTCOME,
  REPORT_SAFETY,
  INSPECTION_WARNING,
  assessSingletonContentContract,
  buildStdoutEnvelope,
  STRUCTURAL_ROLE_ALLOWLIST,
} from "./ndic-datex-v1/tmc-format-inspection.mjs";
import {
  containsForbiddenPathLeak,
  categorizePath,
  assertReportPathSafe,
  PATH_CATEGORY,
  redactAbsolutePaths,
} from "./ndic-datex-v1/tmc-path-redaction.mjs";
import { selectAuthoritativeFormat, TMC_FORMAT } from "./ndic-datex-v1/tmc-archive-stream.mjs";
import { buildStoredZip, DEFAULT_ZIP_LIMITS } from "./ndic-datex-v1/tmc-zip.mjs";
import { getNdicDatexV1Config } from "./ndic-datex-v1/config.mjs";
import { assertNdicCzechEgressRunnerOrThrow } from "./ndic-datex-v1/runner-identity.mjs";
import {
  buildSyntheticSp08001Dat,
  syntheticPointsRow,
} from "./ndic-datex-v1/tmc-sp08001-header.mjs";
import {
  assertInspectionCleanupTarget,
  wipeInspectionTaskDir,
  CLEANUP_REJECT,
  ALLOWED_TASK_DIR_NAMES,
} from "./ndic-datex-v1/tmc-inspection-cleanup.mjs";
import { fileURLToPath } from "node:url";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

function dbfHeaderSynthetic(fieldNames) {
  const fields = fieldNames.map((n) => {
    const b = Buffer.alloc(32);
    Buffer.from(String(n).slice(0, 11), "ascii").copy(b, 0);
    b[11] = 0x43; // C
    b[16] = 10;
    return b;
  });
  const headerLen = 32 + fields.length * 32 + 1;
  const buf = Buffer.alloc(headerLen + 8);
  buf[0] = 0x03;
  buf.writeUInt32LE(3, 4);
  buf.writeUInt16LE(headerLen, 8);
  buf.writeUInt16LE(20, 10);
  let off = 32;
  for (const f of fields) {
    f.copy(buf, off);
    off += 32;
  }
  buf[off] = 0x0d;
  return buf;
}

function shpHeaderSynthetic(opts = {}) {
  const buf = Buffer.alloc(100);
  buf.writeInt32BE(9994, 0);
  buf.writeInt32BE(50, 24);
  buf.writeInt32LE(opts.shapeType != null ? opts.shapeType : 1, 32);
  buf.writeDoubleLE(opts.xmin != null ? opts.xmin : 14.0, 36);
  buf.writeDoubleLE(opts.ymin != null ? opts.ymin : 49.0, 44);
  buf.writeDoubleLE(opts.xmax != null ? opts.xmax : 15.0, 52);
  buf.writeDoubleLE(opts.ymax != null ? opts.ymax : 50.0, 60);
  return buf;
}

// --- terminology ---
{
  const d = selectAuthoritativeFormat({
    datFileCount: 2,
    txtFileCount: 1,
    fileExtSummary: { dat: 2, shp: 1, dbf: 1 },
    candidateLayers: { tisaNameHint: 3 },
  });
  ok("term_candidate_tisa", d.candidateFormat === TMC_FORMAT.TISA_DAT_CSV, d.candidateFormat);
  ok("term_auth_unverified", d.authoritativeFormat === "UNVERIFIED", d.authoritativeFormat);
  ok("term_not_verified", d.authoritativeFormatVerified === false, "v");
  ok("term_confidence", d.candidateFormatConfidence === "metadata_only", d.candidateFormatConfidence);
  ok("term_source", d.candidateEvidenceSource === "central_directory", d.candidateEvidenceSource);
}

// --- role classification (no raw names in output) ---
{
  ok("role_points", classifyEntryRole("loc/POINTS.DAT") === "points", classifyEntryRole("loc/POINTS.DAT"));
  ok("role_names", classifyEntryRole("NAMES.DAT") === "names", classifyEntryRole("NAMES.DAT"));
  ok("role_unknown_dat", classifyEntryRole("ZZZ99.DAT") === "unknown_dat", classifyEntryRole("ZZZ99.DAT"));
  ok("role_doc", classifyEntryRole("readme.PDF") === "documentation", classifyEntryRole("readme.PDF"));
}

// --- DAT with header + CID/TABCD ---
{
  const buf = Buffer.from("CID;TABCD;LCD;XCOORD;YCOORD;POSOFF;NEGOFF\r\n11;25;1001;14.4;50.1;1002;1000\r\n", "utf8");
  const peek = inspectTextPeek(buf);
  ok("dat_header", peek.hasHeader === true, "hdr");
  ok("dat_delim_semi", peek.delimiter === "semicolon", peek.delimiter);
  ok("dat_cid11", peek.cid11Seen === true, "cid");
  ok("dat_tabcd25", peek.tabcd25Seen === true, "tab");
  ok("dat_coords", peek.candidateCoordinateColumns === true, "xy");
  ok("dat_offsets", peek.candidateOffsetColumns === true, "off");
  const blob = JSON.stringify(peek);
  ok("dat_no_lcd_value", !/\b1001\b/.test(blob), "lcd");
  ok("dat_no_coord_values", !/14\.4|50\.1/.test(blob), "coords");
}

// --- positional DAT ---
{
  const peek = inspectTextPeek(Buffer.from("11;25;42\n11;25;43\n", "utf8"));
  ok("pos_no_header", peek.hasHeader === false, "hdr");
  ok("pos_positional", peek.positional === true, "pos");
  ok("pos_cid", peek.cid11Seen === true, "cid");
}

// --- delimiters / BOM / encodings ---
{
  ok("delim_comma", inspectTextPeek(Buffer.from("A,B,C\n1,2,3\n")).delimiter === "comma", "c");
  ok("delim_tab", inspectTextPeek(Buffer.from("A\tB\n1\t2\n")).delimiter === "tab", "t");
  ok("delim_pipe", inspectTextPeek(Buffer.from("A|B\n1|2\n")).delimiter === "pipe", "p");
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("CID;TABCD\n11;25\n")]);
  ok("bom_utf8", inspectTextPeek(bom).bom === "utf8", "bom");
  ok("cpg_1250", inspectCpgPeek(Buffer.from("Windows-1250")).encodingNormalized === "WINDOWS-1250", "1250");
  ok("cpg_utf8", inspectCpgPeek(Buffer.from("UTF-8")).encodingNormalized === "UTF-8", "u8");
  ok("cpg_8859", inspectCpgPeek(Buffer.from("ISO-8859-2")).encodingNormalized === "ISO-8859-2", "l2");
  ok("cpg_unknown", inspectCpgPeek(Buffer.from("weird-enc-xyz")).encodingNormalized === "UNKNOWN", "unk");
  const cpgBlob = JSON.stringify(inspectCpgPeek(Buffer.from("weird-enc-xyz")));
  ok("cpg_no_raw", !/weird-enc-xyz/.test(cpgBlob), "raw");
}

// --- inconsistent fields / quoting ---
{
  const peek = inspectTextPeek(Buffer.from('CID;TABCD;NAME\n11;25;"A; B"\n11;25\n', "utf8"));
  ok("quote_double", peek.quoteStyle === "double", peek.quoteStyle);
  ok("inconsistent_fields", peek.consistentFieldCount === false, "cf");
}

// --- wrong CID/TABCD detection presence ---
{
  const peek = inspectTextPeek(Buffer.from("CID;TABCD;LCD\n12;26;1\n", "utf8"));
  ok("wrong_cid_not_11", peek.cid11Seen === false, "cid");
  ok("wrong_tab_not_25", peek.tabcd25Seen === false, "tab");
}

// --- DBF header ---
{
  const dbf = inspectDbfHeader(dbfHeaderSynthetic(["CID", "TABCD", "LCD", "XCOORD"]));
  ok("dbf_valid", dbf.validDbfHeader === true, "v");
  ok("dbf_fields", dbf.fieldCount === 4, String(dbf.fieldCount));
  ok("dbf_roles", dbf.normalizedFieldRoleCounts.cid_field === 1, "roles");
  ok("dbf_no_names", !JSON.stringify(dbf).includes("XCOORD"), "names");
  ok("dbf_bad", inspectDbfHeader(Buffer.alloc(10)).validDbfHeader === false, "bad");
}

// --- SHP header / CZ extent enum ---
{
  const okCz = inspectShpHeader(shpHeaderSynthetic());
  ok("shp_valid", okCz.validHeader === true, "v");
  ok("shp_cz", okCz.boundingBoxCountryCheck === "plausible_czech_extent", okCz.boundingBoxCountryCheck);
  const out = inspectShpHeader(shpHeaderSynthetic({ xmin: -10, ymin: 0, xmax: -5, ymax: 1 }));
  ok("shp_outside", out.boundingBoxCountryCheck === "outside_czech_extent", out.boundingBoxCountryCheck);
  ok("shp_no_bbox_nums", !/"xmin"|14\.0/.test(JSON.stringify(okCz)), "bbox");
  ok("shp_bad", inspectShpHeader(Buffer.alloc(20)).validHeader === false, "bad");
}

// --- SQLite / non-SQLite ---
{
  const magic = Buffer.alloc(32);
  Buffer.from("SQLite format 3\0").copy(magic);
  const s = inspectSqliteHeader(magic, {
    schemaTableNames: ["POINTS", "NAMES"],
    schemaColumnNames: ["LCD", "XCOORD", "NAME"],
  });
  ok("sqlite_ok", s.sqliteVerified === true, "v");
  ok("sqlite_tables", s.tableCount === 2, String(s.tableCount));
  ok("sqlite_no_sql", !/CREATE|SELECT/i.test(JSON.stringify(s)), "sql");
  const bad = inspectSqliteHeader(Buffer.from("NOTSQLITE!!!!!!!!!!!"));
  ok("sqlite_unverified", bad.sqliteVerified === false && bad.dbFormat === "DB_FORMAT_UNVERIFIED", bad.dbFormat);
}

// --- aggregate inspection + authority unverified ---
{
  const report = inspectFormatFromEntryPeeks(
    [
      { role: "points", ext: "dat", buf: Buffer.from("CID;TABCD;LCD;XCOORD;YCOORD\n11;25;1;14;50\n") },
      { role: "names", ext: "dat", buf: Buffer.from("NID;NAME\n1;FakeName\n") },
      { role: "encoding_cpg", ext: "cpg", buf: Buffer.from("UTF-8") },
      { role: "shp_layer", ext: "shp", buf: shpHeaderSynthetic() },
      { role: "dbf_layer", ext: "dbf", buf: dbfHeaderSynthetic(["LCD", "NAME"]) },
      { role: "documentation", ext: "pdf", buf: Buffer.from("%PDF") },
    ],
    { centralMeta: { datFileCount: 2, candidateLayers: { tisaNameHint: 2 } } }
  );
  ok("agg_mode", report.mode === INSPECTION_MODE, report.mode);
  ok("agg_candidate", report.candidateFormat === TMC_FORMAT.TISA_DAT_CSV, report.candidateFormat);
  ok("agg_auth_unverified", report.authoritativeFormat === "UNVERIFIED", report.authoritativeFormat);
  ok("agg_verified_false", report.authoritativeFormatVerified === false, "vf");
  ok("agg_no_importer", report.importerActivated === false, "imp");
  ok("agg_no_resolver", report.resolverActivated === false, "res");
  ok("agg_no_publish", report.publishActivated === false, "pub");
  ok("agg_cid", report.cid11Detected === true, "cid");
  ok("agg_tab", report.tabcd25Detected === true, "tab");
  ok("agg_no_fakename", !/FakeName/.test(JSON.stringify(report)), "name");
  ok("agg_source_insufficient", report.sourceAuthority.identitySourceCandidate.sufficientForImporter === false, "suf");
}

// --- duplicate required role: only content-verified singleton collision is fatal ---
{
  const filenameOnly = inspectFormatFromEntryPeeks([
    { role: "points", ext: "dat", buf: Buffer.from("junk-a\n") },
    { role: "points", ext: "dat", buf: Buffer.from("junk-b\n") },
  ]);
  ok("dup_filename_not_fatal", filenameOnly.rejectCode !== INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE, filenameOnly.rejectCode);
  ok(
    "dup_filename_warning",
    Array.isArray(filenameOnly.warnings) &&
      filenameOnly.warnings.some((w) => w.code === INSPECTION_WARNING.MULTIPLE_ROLE_CANDIDATES),
    "warn"
  );
  ok("dup_filename_outcome", filenameOnly.inspectionOutcome === INSPECTION_OUTCOME.INSUFFICIENT_EVIDENCE, filenameOnly.inspectionOutcome);
  ok("dup_filename_auth", filenameOnly.authoritativeFormatVerified === false, "auth");

  const contentConflict = inspectFormatFromEntryPeeks([
    { role: "points", tableCode: "POINTS", ext: "dat", buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow({ LCD: "900001" })]) },
    { role: "points", tableCode: "POINTS", ext: "dat", buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow({ LCD: "900002" })]) },
  ]);
  ok("dup_content_reject", contentConflict.rejectCode === INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE, contentConflict.rejectCode);
  ok("dup_content_outcome", contentConflict.inspectionOutcome === INSPECTION_OUTCOME.EXPECTED_REJECT, contentConflict.inspectionOutcome);
  ok("dup_content_count", contentConflict.duplicateRequiredRoleCount === 1, String(contentConflict.duplicateRequiredRoleCount));
  ok("dup_no_auto_auth", contentConflict.authoritativeFormat === "UNVERIFIED" && contentConflict.authoritativeFormatVerified === false, "na");
}

// --- report size / truncation ---
{
  const huge = inspectFormatFromEntryPeeks([{ role: "points", ext: "dat", buf: Buffer.from("CID;TABCD\n11;25\n") }]);
  huge.note = "x".repeat(70_000);
  const ser = serializeInspectionReport(huge, INSPECTION_REPORT_MAX_BYTES);
  ok("report_trunc", ser.truncated === true, "tr");
  ok("report_under_cap", ser.bytes <= INSPECTION_REPORT_MAX_BYTES, String(ser.bytes));
  ok("report_trunc_flag", JSON.parse(ser.json).reportTruncated === true, "flag");
}

// --- path redaction ---
{
  ok("path_posix_leak", containsForbiddenPathLeak("/home/runner/work/a") === true, "posix");
  ok("path_win_leak", containsForbiddenPathLeak("C:\\Users\\alice\\Temp\\x") === true, "win");
  ok("path_safe_cat", categorizePath(process.env.TEMP || os.tmpdir()) === PATH_CATEGORY.OS_TMPDIR || categorizePath(process.env.TEMP || os.tmpdir()) === PATH_CATEGORY.UNKNOWN_SANITIZED, "cat");
  const red = redactAbsolutePaths("err at C:\\Users\\alice\\AppData\\x and /home/bob/y");
  ok("path_redacted", !/alice|bob|Users/.test(red) || red.includes(PATH_CATEGORY.UNKNOWN_SANITIZED), red);
  let threw = false;
  try {
    assertReportPathSafe({ p: "C:\\Users\\x\\file.json" });
  } catch (e) {
    threw = e && e.code === "TMC_INSPECTION_PATH_INVALID";
  }
  ok("path_assert_throws", threw, "throw");
  ok("path_assert_ok", assertReportPathSafe({ workDirCategory: "runner_temp" }) === true, "ok");
}

// --- test provider env refuse ---
{
  let blocked = false;
  try {
    assertInspectionProductionSafe({ IU_NDIC_FAKE_TMC_FORMAT: "1" });
  } catch (e) {
    blocked = e && e.code === "REFUSING_TEST_INSPECTION_ENV";
  }
  ok("env_refuse", blocked, "env");
  ok("env_clean_ok", (() => {
    try {
      assertInspectionProductionSafe({});
      return true;
    } catch (_) {
      return false;
    }
  })(), "clean");
}

// --- timeout ---
{
  const report = inspectFormatFromEntryPeeks([{ role: "points", ext: "dat", buf: Buffer.from("a") }], {
    startedAt: Date.now() - 200_000,
    timeoutMs: 1,
  });
  ok("timeout_code", report.rejectCode === INSPECTION_REJECT.TIMEOUT, report.rejectCode);
}

// --- candidate from central ---
{
  const c = buildCandidateFormatFromCentral({ datFileCount: 26, candidateLayers: { tisaNameHint: 49 } });
  ok("central_candidate", c.candidateFormat === TMC_FORMAT.TISA_DAT_CSV, c.candidateFormat);
  ok("central_unverified", c.authoritativeFormatVerified === false, "v");
}

// --- ZIP file peek inspection (synthetic store ZIP; no network) ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-insp-zip-"));
  const zipPath = path.join(dir, "synth.zip");
  fs.writeFileSync(
    zipPath,
    buildStoredZip([
      { name: "POINTS.DAT", data: "CID;TABCD;LCD;XCOORD;YCOORD\r\n11;25;1;14;50\r\n" },
      { name: "NAMES.DAT", data: "CID;TABCD;NID;NAME\r\n11;25;1;FakeName\r\n" },
      { name: "readme.PDF", data: "%PDF-fake" },
      { name: "nested.zip", data: "PK\x03\x04fake" },
    ])
  );
  const report = await inspectTmcZipFormatFromFile(zipPath, { workDir: dir });
  const blob = JSON.stringify(report);
  ok("zip_insp_okish", report.mode === INSPECTION_MODE, report.mode);
  ok("zip_insp_auth_unverified", report.authoritativeFormat === "UNVERIFIED", report.authoritativeFormat);
  ok("zip_insp_verified_false", report.authoritativeFormatVerified === false, "vf");
  ok("zip_insp_cid", report.cid11Detected === true, "cid");
  ok("zip_insp_tab", report.tabcd25Detected === true, "tab");
  ok("zip_insp_evidence", report.candidateEvidenceSource === "content_peek", report.candidateEvidenceSource);
  ok("zip_insp_no_fakename", !/FakeName/.test(blob), "name");
  ok("zip_insp_no_points_basename", !/POINTS\.DAT/.test(blob), "base");
  ok("zip_insp_no_importer", report.importerActivated === false, "imp");
  ok("zip_insp_nested_ignored", (report.ignoredCategoryCounts || {}).nested_archive >= 1, "nested");
  ok("zip_insp_reject_code", report.rejectCode === INSPECTION_REJECT.FORMAT_EVIDENCE_INSUFFICIENT, report.rejectCode);
  ok("zip_insp_tablecode_mapped", (report.tableCodeMappedCount || 0) >= 1, String(report.tableCodeMappedCount));
  ok("cfg_format_mode", getNdicDatexV1Config({ IU_NDIC_DATEX_V1_MODE: "format_inspection" }).formatInspection === true, "cfg");
  let idBlocked = false;
  try {
    assertNdicCzechEgressRunnerOrThrow({
      IU_NDIC_DATEX_V1_MODE: "format_inspection",
      RUNNER_ENVIRONMENT: "github-hosted",
    });
  } catch (e) {
    idBlocked = e && e.code === "REFUSING_GITHUB_HOSTED";
  }
  ok("identity_blocks_format_inspection_hosted", idBlocked, "id");
  let cliBlocked = false;
  try {
    process.argv.push("--fixture");
    assertInspectionProductionSafe({});
  } catch (e) {
    cliBlocked = e && e.code === "REFUSING_TEST_INSPECTION_CLI";
  } finally {
    const idx = process.argv.indexOf("--fixture");
    if (idx >= 0) process.argv.splice(idx, 1);
  }
  ok("cli_refuse_fixture", cliBlocked, "cli");
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

// --- memory bound via many peeks ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-insp-mem-"));
  const zipPath = path.join(dir, "mem.zip");
  const files = [];
  for (let i = 0; i < 40; i++) {
    files.push({ name: "POINTS" + i + ".DAT", data: "CID;TABCD\r\n11;25\r\n" + "x".repeat(3000) });
  }
  fs.writeFileSync(zipPath, buildStoredZip(files));
  const report = await inspectTmcZipFormatFromFile(zipPath, { workDir: dir });
  ok(
    "mem_bound_or_ok",
    report.rejectCode === INSPECTION_REJECT.MEMORY_LIMIT ||
      report.rejectCode === INSPECTION_REJECT.FORMAT_EVIDENCE_INSUFFICIENT ||
      report.peekTotalBytes <= 2 * 1024 * 1024,
    String(report.rejectCode || report.peekTotalBytes)
  );
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

// --- report schema allowlist + leak rejection ---
{
  ok("report_key_count", INSPECTION_REPORT_ALLOWED_KEYS.length >= 20, String(INSPECTION_REPORT_ALLOWED_KEYS.length));
  const good = validateInspectionReportObject({
    ok: true,
    mode: INSPECTION_MODE,
    authoritativeFormat: "UNVERIFIED",
    authoritativeFormatVerified: false,
    importerActivated: false,
    resolverActivated: false,
    publishActivated: false,
    productionWrite: false,
  });
  ok("report_validate_ok", good.mode === INSPECTION_MODE, "v");
  let unk = false;
  try {
    validateInspectionReportObject({ ok: true, mode: INSPECTION_MODE, evilKey: "x" });
  } catch (e) {
    unk = e && e.code === "TMC_INSPECTION_REPORT_UNKNOWN_KEY";
  }
  ok("report_unknown_key", unk, "unk");
  let pathLeak = false;
  try {
    validateInspectionReportObject({
      ok: false,
      mode: INSPECTION_MODE,
      note: "see /home/bob/secret",
      authoritativeFormat: "UNVERIFIED",
      authoritativeFormatVerified: false,
      importerActivated: false,
      resolverActivated: false,
      publishActivated: false,
      productionWrite: false,
    });
  } catch (e) {
    pathLeak = e && e.code === "TMC_INSPECTION_REPORT_PATH_LEAK";
  }
  ok("report_path_leak", pathLeak, "pl");
  let urlLeak = false;
  try {
    validateInspectionReportObject({
      ok: false,
      mode: INSPECTION_MODE,
      note: "https://mobilitydata.rsd.cz/x",
      authoritativeFormat: "UNVERIFIED",
      authoritativeFormatVerified: false,
      importerActivated: false,
      resolverActivated: false,
      publishActivated: false,
      productionWrite: false,
    });
  } catch (e) {
    urlLeak = e && e.code === "TMC_INSPECTION_REPORT_SECRET_LEAK";
  }
  ok("report_url_leak", urlLeak, "url");
  const ser = serializeInspectionReport(good);
  ok("report_reserialize", ser.object && ser.object.productionWrite === false, "rs");
}

// --- cleanup fence ---
{
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-rt-"));
  const work = path.join(runnerTemp, "ndic-inspect-work");
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "body.zip"), "PK");
  ok("cleanup_ok", wipeInspectionTaskDir(work, { runnerTemp }).wiped === true, "wipe");
  ok("cleanup_gone", !fs.existsSync(work), "gone");
  let empty = false;
  try {
    assertInspectionCleanupTarget("", { runnerTemp });
  } catch (e) {
    empty = e && e.code === CLEANUP_REJECT.EMPTY;
  }
  ok("cleanup_empty", empty, "e");
  let root = false;
  try {
    assertInspectionCleanupTarget("/", { runnerTemp });
  } catch (e) {
    root = e && e.code === CLEANUP_REJECT.ROOT;
  }
  ok("cleanup_root", root, "r");
  let rtRoot = false;
  try {
    assertInspectionCleanupTarget(runnerTemp, { runnerTemp });
  } catch (e) {
    rtRoot = e && e.code === CLEANUP_REJECT.RUNNER_TEMP_ROOT;
  }
  ok("cleanup_rt_root", rtRoot, "rt");
  let foreign = false;
  try {
    assertInspectionCleanupTarget(path.join(os.tmpdir(), "other-job"), { runnerTemp });
  } catch (e) {
    foreign = e && (e.code === CLEANUP_REJECT.FOREIGN || e.code === CLEANUP_REJECT.FENCE);
  }
  ok("cleanup_foreign", foreign, "f");
  let home = false;
  try {
    assertInspectionCleanupTarget(path.resolve(runnerTemp), {
      runnerTemp: path.join(runnerTemp, "nested-rt"),
      home: runnerTemp,
    });
  } catch (e) {
    home =
      e &&
      (e.code === CLEANUP_REJECT.HOME ||
        e.code === CLEANUP_REJECT.FOREIGN ||
        e.code === CLEANUP_REJECT.RUNNER_TEMP_ROOT);
  }
  ok("cleanup_home", home, "h");
  ok("cleanup_allow_names", ALLOWED_TASK_DIR_NAMES.includes("ndic-inspect-report"), "names");
  try {
    fs.rmSync(runnerTemp, { recursive: true, force: true });
  } catch (_) {}
}

// --- artifact exact single-file contract (standalone + registered shadow dual-mode) ---
{
  const wfStandalone = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "ndic-datex-v1-tmc-format-inspection.yml"),
    "utf8"
  );
  const wfShadow = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "ndic-datex-v1-shadow-probe.yml"),
    "utf8"
  );
  for (const [label, wf] of [
    ["standalone", wfStandalone],
    ["shadow_dual", wfShadow],
  ]) {
    ok(
      "artifact_exact_path_" + label,
      /path:\s*\$\{\{\s*runner\.temp\s*\}\}[/\\]ndic-inspect-report[/\\]inspection-report\.json/.test(wf),
      "path"
    );
  }
  ok("artifact_no_dir_upload", !/path:\s*\$\{\{\s*runner\.temp\s*\}\}\s*$/m.test(wfStandalone), "dir");
  ok("artifact_missing_error", /if-no-files-found:\s*error/.test(wfStandalone), "err");
  ok("shadow_dual_has_format_inspection_mode", /format_inspection/.test(wfShadow), "mode");
  ok("shadow_dual_inspect_job", /format-inspection:/.test(wfShadow), "job");
  ok("shadow_upload_on_safety", /sanitized_report_ready\s*==\s*'true'/.test(wfShadow), "upload-if");
  ok("shadow_no_cat_report", !/cat\s+"\$REPORT"/.test(wfShadow.split("format-inspection:")[1] || ""), "nocat");
  ok("standalone_no_cat_report", !/cat\s+"\$REPORT"/.test(wfStandalone), "nocat2");
  ok("shadow_preserve_failure", /INSPECTION_STEP_FAILED_PRESERVED/.test(wfShadow), "pres");
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-art-"));
  const reportDir = path.join(staging, "ndic-inspect-report");
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "inspection-report.json"), "{\"ok\":true}");
  fs.writeFileSync(path.join(reportDir, "evil.zip"), "PK\u0003\u0004");
  fs.writeFileSync(path.join(reportDir, "neighbor.txt"), "x");
  const onlyJson = fs
    .readdirSync(reportDir)
    .filter((n) => n === "inspection-report.json");
  ok("artifact_neighbor_excluded_by_exact_name", onlyJson.length === 1 && !onlyJson.includes("evil.zip"), "nbr");
  // Simulate workflow find-delete neighbors
  for (const n of fs.readdirSync(reportDir)) {
    if (n !== "inspection-report.json") fs.unlinkSync(path.join(reportDir, n));
  }
  ok("artifact_after_prune", fs.readdirSync(reportDir).join(",") === "inspection-report.json", "prune");
  try {
    fs.rmSync(staging, { recursive: true, force: true });
  } catch (_) {}
}

// --- role aggregates / multi-candidate / singleton / envelope ---
{
  const multiExt = inspectFormatFromEntryPeeks([
    { role: "points", ext: "dat", buf: Buffer.from("a\n") },
    { role: "points", ext: "txt", buf: Buffer.from("b\n") },
  ]);
  ok("multi_ext_not_fatal", multiExt.rejectCode !== INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE, multiExt.rejectCode);
  ok("multi_ext_warn", multiExt.warnings.some((w) => w.code === INSPECTION_WARNING.MULTIPLE_ROLE_CANDIDATES), "w");
  ok("multi_ext_agg", (multiExt.roleCandidateCounts.points || 0) === 2, "c");
  ok("multi_ext_extcats", multiExt.roleExtensionCategoryCounts.points.dat === 1 && multiExt.roleExtensionCategoryCounts.points.txt === 1, "e");

  const oneVerified = inspectFormatFromEntryPeeks([
    { role: "points", tableCode: "POINTS", ext: "dat", buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow()]) },
    { role: "points", ext: "dat", buf: Buffer.from("hint-only\n") },
  ]);
  ok("one_verified_not_dup", oneVerified.rejectCode !== INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE, oneVerified.rejectCode);
  ok("one_verified_count", (oneVerified.roleContentVerifiedCounts.points || 0) === 1, "cv");
  ok("one_verified_multi_warn", oneVerified.multipleCandidateRoleCount >= 1, "mc");

  const geo = inspectFormatFromEntryPeeks([
    { role: "shp_layer", ext: "shp", buf: shpHeaderSynthetic() },
    { role: "shp_layer", ext: "shx", buf: shpHeaderSynthetic() },
    { role: "dbf_layer", ext: "dbf", buf: dbfHeaderSynthetic(["LCD", "NAME"]) },
    { role: "points", tableCode: "POINTS", ext: "dat", buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow()]) },
  ]);
  ok("geo_no_dup", geo.rejectCode !== INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE, geo.rejectCode);
  ok("geo_auth_unverified", geo.authoritativeFormatVerified === false, "av");

  const namesLang = inspectFormatFromEntryPeeks([
    { role: "names", tableCode: "NAMES", ext: "dat", buf: buildSyntheticSp08001Dat("NAMES", [["11", "1", "1", "SyntheticNameA", "", ""]]) },
    { role: "names", tableCode: "NAMES", ext: "dat", buf: buildSyntheticSp08001Dat("NAMES", [["11", "1", "2", "SyntheticNameB", "", ""]]) },
  ]);
  // Two content-verified NAMES → conflict
  ok("names_conflict_or_warn", namesLang.rejectCode === INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE || namesLang.multipleCandidateRoleCount >= 1, "nl");

  const ser = serializeInspectionReport(multiExt);
  ok("agg_serialize_ok", ser.bytes > 0 && ser.bytes <= INSPECTION_REPORT_MAX_BYTES, String(ser.bytes));
  const parsed = JSON.parse(ser.json);
  ok("agg_no_filename", !/\.dat|\.txt|POINTS|NAMES/i.test(ser.json) || !/basename|fileName|entryName/.test(ser.json), "fn");
  ok("agg_role_enum", Object.keys(parsed.structuralRoleCounts || {}).every((k) => STRUCTURAL_ROLE_ALLOWLIST.includes(k)), "enum");
  ok("agg_outcome", parsed.inspectionOutcome === INSPECTION_OUTCOME.INSUFFICIENT_EVIDENCE, parsed.inspectionOutcome);

  let unkRole = false;
  try {
    validateInspectionReportObject({
      ok: false,
      mode: INSPECTION_MODE,
      structuralRoleCounts: { evil_role: 1 },
      authoritativeFormat: "UNVERIFIED",
      authoritativeFormatVerified: false,
      importerActivated: false,
      resolverActivated: false,
      publishActivated: false,
      productionWrite: false,
    });
  } catch (e) {
    unkRole = e && e.code === "TMC_INSPECTION_REPORT_UNKNOWN_ROLE";
  }
  ok("unknown_role_rejected", unkRole, "ur");

  const env = buildStdoutEnvelope({
    ok: false,
    mode: INSPECTION_MODE,
    inspectionOutcome: INSPECTION_OUTCOME.EXPECTED_REJECT,
    reportSafety: REPORT_SAFETY.PASSED,
    rejectCode: INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE,
    reportBytes: 100,
    reportTruncated: false,
    workDirCategory: "runner_temp",
    authoritativeFormat: "UNVERIFIED",
    authoritativeFormatVerified: false,
    importerActivated: false,
    resolverActivated: false,
    publishActivated: false,
    productionWrite: false,
    sanitized_report_ready: true,
    evilExtra: "nope",
  });
  ok("envelope_no_extra", env.evilExtra === undefined, "ex");
  ok("envelope_ready", env.sanitized_report_ready === true, "rdy");
  ok("envelope_keys_min", Object.keys(env).every((k) => [
    "ok","mode","inspectionOutcome","reportSafety","rejectCode","reportBytes","reportTruncated",
    "workDirCategory","authoritativeFormat","authoritativeFormatVerified","formatConfirmed",
    "datasetIntegrityState","importerActivated",
    "resolverActivated","publishActivated","productionWrite","sanitized_report_ready",
  ].includes(k)), "keys");

  const assessed = assessSingletonContentContract(
    "points",
    inspectTextPeek(buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow()])),
    { tableCode: "POINTS" }
  );
  ok("singleton_contract", assessed.contentVerified === true && assessed.headerContractMatch === true, "sc");

  // expected reject + safe serialize (artifact pathway)
  const conflict = inspectFormatFromEntryPeeks([
    { role: "points", tableCode: "POINTS", ext: "dat", buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow({ LCD: "900001" })]) },
    { role: "points", tableCode: "POINTS", ext: "dat", buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow({ LCD: "900002" })]) },
  ]);
  const conflictSer = serializeInspectionReport(conflict);
  ok("expected_reject_serializes", conflictSer.object.rejectCode === INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE, "ers");
  ok("expected_reject_under_cap", conflictSer.bytes <= INSPECTION_REPORT_MAX_BYTES, "cap");

  // schema failure path: unknown key must not serialize
  let schemaFail = false;
  try {
    validateInspectionReportObject({ ok: true, mode: INSPECTION_MODE, notAllowed: 1 });
  } catch (e) {
    schemaFail = e && e.code === "TMC_INSPECTION_REPORT_UNKNOWN_KEY";
  }
  ok("schema_fail_no_upload_path", schemaFail, "sf");
}

// --- implemented limit constants (documented for gate) ---
{
  ok("lim_dat_peek", INSPECTION_TEXT_PEEK_BYTES === 4096, String(INSPECTION_TEXT_PEEK_BYTES));
  ok("lim_lines", INSPECTION_MAX_TEXT_LINES === 8, String(INSPECTION_MAX_TEXT_LINES));
  ok("lim_cpg", INSPECTION_CPG_MAX_BYTES === 64, String(INSPECTION_CPG_MAX_BYTES));
  ok("lim_hdr", INSPECTION_HEADER_MAX_BYTES === 1024, String(INSPECTION_HEADER_MAX_BYTES));
  ok("lim_shp", INSPECTION_SHP_HEADER_BYTES === 100, String(INSPECTION_SHP_HEADER_BYTES));
  ok("lim_sqlite", INSPECTION_SQLITE_MAGIC_BYTES === 16, String(INSPECTION_SQLITE_MAGIC_BYTES));
  ok("lim_timeout", INSPECTION_TIMEOUT_MS === 120000, String(INSPECTION_TIMEOUT_MS));
  ok("lim_mem", INSPECTION_MAX_TOTAL_PEEK_BYTES === 2 * 1024 * 1024, String(INSPECTION_MAX_TOTAL_PEEK_BYTES));
  ok("lim_zip_entries", DEFAULT_ZIP_LIMITS.maxEntries === 256, String(DEFAULT_ZIP_LIMITS.maxEntries));
  ok("lim_zip_single", DEFAULT_ZIP_LIMITS.maxSingleUncompressed === 150 * 1024 * 1024, "single");
  ok("lim_zip_total", DEFAULT_ZIP_LIMITS.maxUncompressedTotal === 420 * 1024 * 1024, "total");
  ok("lim_zip_ratio", DEFAULT_ZIP_LIMITS.maxCompressionRatio === 80, "ratio");
}

if (fails.length) {
  console.error("[ndic-tmc-format-inspection-fixtures] FAIL " + fails.length);
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    mode: INSPECTION_MODE,
    reportMaxBytes: INSPECTION_REPORT_MAX_BYTES,
    reportAllowedKeys: INSPECTION_REPORT_ALLOWED_KEYS.length,
    liveZipInspectApi: true,
    node: process.version,
  })
);
console.log("[ndic-tmc-format-inspection-fixtures] PASS");

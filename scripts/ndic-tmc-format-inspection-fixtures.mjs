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
  classifyEntryRole,
  assertInspectionProductionSafe,
  INSPECTION_REJECT,
  INSPECTION_REPORT_MAX_BYTES,
  INSPECTION_MODE,
  buildCandidateFormatFromCentral,
} from "./ndic-datex-v1/tmc-format-inspection.mjs";
import {
  containsForbiddenPathLeak,
  categorizePath,
  assertReportPathSafe,
  PATH_CATEGORY,
  redactAbsolutePaths,
} from "./ndic-datex-v1/tmc-path-redaction.mjs";
import { selectAuthoritativeFormat, TMC_FORMAT } from "./ndic-datex-v1/tmc-archive-stream.mjs";
import { buildStoredZip } from "./ndic-datex-v1/tmc-zip.mjs";
import { getNdicDatexV1Config } from "./ndic-datex-v1/config.mjs";
import { assertNdicCzechEgressRunnerOrThrow } from "./ndic-datex-v1/runner-identity.mjs";

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

// --- duplicate required role ---
{
  const report = inspectFormatFromEntryPeeks([
    { role: "points", ext: "dat", buf: Buffer.from("CID;TABCD\n11;25\n") },
    { role: "points", ext: "dat", buf: Buffer.from("CID;TABCD\n11;25\n") },
  ]);
  ok("dup_reject", report.rejectCode === INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE, report.rejectCode);
}

// --- report size / truncation ---
{
  const huge = inspectFormatFromEntryPeeks([{ role: "points", ext: "dat", buf: Buffer.from("CID;TABCD\n11;25\n") }]);
  huge.pad = "x".repeat(70_000);
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
      { name: "POINTS.DAT", data: "CID;TABCD;LCD;XCOORD;YCOORD\n11;25;1;14;50\n" },
      { name: "NAMES.DAT", data: "CID;TABCD;NID;NAME\n11;25;1;FakeName\n" },
      { name: "readme.PDF", data: "%PDF-fake" },
      { name: "nested.zip", data: "PK\x03\x04fake" },
    ])
  );
  const report = inspectTmcZipFormatFromFile(zipPath, { workDir: dir });
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
    files.push({ name: "POINTS" + i + ".DAT", data: "CID;TABCD\n11;25\n" + "x".repeat(3000) });
  }
  fs.writeFileSync(zipPath, buildStoredZip(files));
  const report = inspectTmcZipFormatFromFile(zipPath, { workDir: dir });
  ok(
    "mem_bound_or_ok",
    report.rejectCode === INSPECTION_REJECT.MEMORY_LIMIT || report.peekTotalBytes <= 2 * 1024 * 1024,
    String(report.rejectCode || report.peekTotalBytes)
  );
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
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
    liveZipInspectApi: true,
    node: process.version,
  })
);
console.log("[ndic-tmc-format-inspection-fixtures] PASS");

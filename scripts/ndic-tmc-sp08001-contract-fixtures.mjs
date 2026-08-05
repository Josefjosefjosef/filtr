/**
 * Offline fixtures for TISA SP08001 v2.6 structural contract (synthetic only).
 */
import {
  SP08001_EXCHANGE_FORMAT_VERSION,
  SP08001_SOURCE_SHA256,
  SP08001_SOURCE_URL,
  SP08001_SPEC_ID,
  SP08001_STANDARD_TABLE_COUNT,
  SP08001_TABLES,
  SP08001_PHYSICAL,
  resolveSp08001TableCodeFromBasename,
} from "./ndic-datex-v1/tmc-sp08001-contract.mjs";
import {
  assessSp08001ContentContract,
  buildSyntheticSp08001Dat,
  detectDatEncodingFromBytes,
  ENCODING_LAYER,
  matchSp08001Header,
  parseSp08001HeaderLine,
  resolveEncodingLayers,
  splitSp08001Fields,
  syntheticPointsRow,
} from "./ndic-datex-v1/tmc-sp08001-header.mjs";
import {
  assessSingletonContentContract,
  classifyEntryRole,
  inspectCpgPeek,
  inspectFormatFromEntryPeeks,
  inspectTextPeek,
  INSPECTION_REJECT,
  serializeInspectionReport,
} from "./ndic-datex-v1/tmc-format-inspection.mjs";

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log("PASS " + name);
  else {
    failed += 1;
    console.log("FAIL " + name + (detail != null ? " " + detail : ""));
  }
}

ok("spec_id", SP08001_SPEC_ID === "SP08001", SP08001_SPEC_ID);
ok("exchange_ver", SP08001_EXCHANGE_FORMAT_VERSION === "2.6", SP08001_EXCHANGE_FORMAT_VERSION);
ok("table_count_25", SP08001_STANDARD_TABLE_COUNT === 25, String(SP08001_STANDARD_TABLE_COUNT));
ok("sha256_set", /^[A-F0-9]{64}$/i.test(SP08001_SOURCE_SHA256), "sha");
ok("source_url_ndic", /registr\.dopravniinfo\.cz/.test(SP08001_SOURCE_URL), SP08001_SOURCE_URL);
ok("delimiter_semicolon", SP08001_PHYSICAL.delimiter === "semicolon", SP08001_PHYSICAL.delimiter);
ok("header_required", SP08001_PHYSICAL.headerRequired === true, "hdr");
ok("newline_crlf", SP08001_PHYSICAL.newline === "CRLF", SP08001_PHYSICAL.newline);
ok("default_utf8", SP08001_PHYSICAL.defaultEncoding === "UTF-8", SP08001_PHYSICAL.defaultEncoding);
ok("bom_undefined", SP08001_PHYSICAL.bomRule === "UNDEFINED_BY_SP08001", SP08001_PHYSICAL.bomRule);
ok("auth_layer_dat", SP08001_PHYSICAL.authoritativeLayer === "TISA_DAT_CSV", SP08001_PHYSICAL.authoritativeLayer);

ok("resolve_points", resolveSp08001TableCodeFromBasename("POINTS.DAT") === "POINTS", "pts");
ok("resolve_short", resolveSp08001TableCodeFromBasename("20.DAT") === "POINTS", "short");
ok("resolve_readme", resolveSp08001TableCodeFromBasename("README.DAT") === "README", "rm");
ok("role_points", classifyEntryRole("loc/POINTS.DAT") === "points", classifyEntryRole("loc/POINTS.DAT"));

const pointsHdr = SP08001_TABLES.POINTS.headerCodes;
ok("points_cols_27", pointsHdr.length === 27, String(pointsHdr.length));
ok("points_xcoord_char", SP08001_TABLES.POINTS.columns.find((c) => c.code === "XCOORD").type === "CHAR(9)", "x");
ok("points_ycoord_char", SP08001_TABLES.POINTS.columns.find((c) => c.code === "YCOORD").type === "CHAR(8)", "y");

const good = buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow()]);
const peekGood = inspectTextPeek(good);
ok("syn_header", peekGood.hasHeader === true, "hh");
ok("syn_delim", peekGood.delimiter === "semicolon", peekGood.delimiter);
ok("syn_crlf", peekGood.lineEnding === "crlf", peekGood.lineEnding);
const match = matchSp08001Header("POINTS", peekGood.headerCodes);
ok("syn_match", match.matched === true, match.reason);
const assessed = assessSp08001ContentContract("POINTS", peekGood);
ok("syn_content_verified", assessed.contentVerified === true, JSON.stringify(assessed));
ok("syn_cid", assessed.cidMatch === true, "cid");
ok("syn_tabcd", assessed.tabcdMatch === true, "tab");

const wrongOrder = Buffer.from(
  [...pointsHdr].reverse().join(";") + "\r\n" + syntheticPointsRow().join(";") + "\r\n",
  "utf8"
);
ok(
  "bad_order",
  assessSp08001ContentContract("POINTS", inspectTextPeek(wrongOrder)).contentVerified === false,
  "order"
);

const missingCol = Buffer.from(pointsHdr.slice(0, -1).join(";") + "\r\n", "utf8");
ok(
  "missing_col",
  matchSp08001Header("POINTS", parseSp08001HeaderLine(missingCol.toString("utf8").split(/\r?\n/)[0]).codes || [])
    .matched === false,
  "miss"
);

const dupCol = Buffer.from("CID;CID;TABCD\r\n", "utf8");
ok("dup_col", parseSp08001HeaderLine(dupCol.toString("utf8").trim()).ok === false, "dup");

const quoted = splitSp08001Fields('11;25;"Zkusebni; Lhota";x');
ok("quoted_semi", quoted.length === 4 && quoted[2] === "Zkusebni; Lhota", JSON.stringify(quoted));

const emptyField = splitSp08001Fields("11;;25");
ok("empty_field", emptyField.length === 3 && emptyField[1] === "", JSON.stringify(emptyField));

const bomBuf = buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow()], { bom: true });
const bomDet = detectDatEncodingFromBytes(bomBuf);
ok("bom_utf8", bomDet.encoding === "UTF-8" && bomDet.bom === true, JSON.stringify(bomDet));

const enc = resolveEncodingLayers([
  { layer: ENCODING_LAYER.DAT_DETECTED, encoding: "ASCII_OR_UTF8" },
  { layer: ENCODING_LAYER.README_DECLARED, encoding: "UTF-8" },
  { layer: ENCODING_LAYER.CPG_SHP_DBF, encoding: "WINDOWS-1250" },
]);
ok("enc_dat_utf8", enc.datEncoding === "UTF-8", enc.datEncoding);
ok("enc_cpg_separate", enc.cpgEncoding === "WINDOWS-1250", enc.cpgEncoding);
ok("enc_no_false_conflict", enc.falseConflictAvoided === true, "fc");

const cpg = inspectCpgPeek(Buffer.from("windows-1250", "utf8"));
ok("cpg_1250", cpg.encodingNormalized === "WINDOWS-1250", cpg.encodingNormalized);

const report = inspectFormatFromEntryPeeks([
  { role: "points", tableCode: "POINTS", ext: "dat", buf: good },
  { role: "encoding_cpg", ext: "cpg", buf: Buffer.from("windows-1250") },
]);
ok("report_delim", report.delimiterNormalized === "semicolon", report.delimiterNormalized);
ok("report_header", report.headerState === "PRESENT", report.headerState);
ok("report_enc_dat", report.encodingDatLayer === "UTF-8" || report.encodingNormalized === "UTF-8", report.encodingNormalized);
ok("report_enc_cpg", report.encodingCpgLayer === "WINDOWS-1250", report.encodingCpgLayer);
ok("report_false_conflict", report.encodingFalseConflictAvoided === true, "efc");
ok("report_cv_points", (report.roleContentVerifiedCounts.points || 0) === 1, "cv");
ok("report_contract_ver", report.exchangeFormatContractVersion === "2.6", report.exchangeFormatContractVersion);
ok("report_table_count", report.tableContractCount === 25, String(report.tableContractCount));
ok("report_auth_layer", report.authoritativeLayer === "TISA_DAT_CSV", report.authoritativeLayer);

const twoFile = inspectFormatFromEntryPeeks([
  { role: "points", ext: "dat", name: "POINTS.DAT", buf: Buffer.from("not;a;header\r\n1;2;3\r\n") },
  { role: "points", ext: "dat", name: "POINTS.TXT", buf: Buffer.from("also;not\r\n") },
]);
ok("multi_candidate_warn", twoFile.multipleCandidateRoleCount === 1, String(twoFile.multipleCandidateRoleCount));
ok(
  "multi_not_fatal",
  twoFile.rejectCode === "TMC_INSPECTION_FORMAT_EVIDENCE_INSUFFICIENT" &&
    twoFile.inspectionOutcome === "insufficient_evidence",
  twoFile.rejectCode
);

const conflict = inspectFormatFromEntryPeeks([
  { role: "points", tableCode: "POINTS", ext: "dat", buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow({ LCD: "900001" })]) },
  { role: "points", tableCode: "POINTS", ext: "dat", buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow({ LCD: "900002" })]) },
]);
ok("conflict_reject", conflict.rejectCode === INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE, conflict.rejectCode);
ok("conflict_dup_count", conflict.duplicateRequiredRoleCount === 1, String(conflict.duplicateRequiredRoleCount));

const wrongCid = buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow({ CID: "12", TABCD: "25" })]);
ok(
  "wrong_cid_not_verified",
  assessSp08001ContentContract("POINTS", inspectTextPeek(wrongCid)).contentVerified === false,
  "cid"
);

const namesBuf = buildSyntheticSp08001Dat("NAMES", [["11", "1", "1", "SyntheticName", "", ""]]);
ok(
  "names_verified",
  assessSp08001ContentContract("NAMES", inspectTextPeek(namesBuf)).contentVerified === true,
  "names"
);

const ser = serializeInspectionReport(report);
ok("serialize_ok", ser.bytes > 0 && ser.ok !== false, String(ser.bytes));

// Heuristic short header must NOT content-verify under SP08001 exact contract
const short = assessSingletonContentContract(
  "points",
  inspectTextPeek(Buffer.from("CID;TABCD;LCD;XCOORD;YCOORD\n11;25;1;14;50\n"))
);
ok("short_header_not_verified", short.contentVerified === false, "short");

if (failed) {
  console.log("SP08001_CONTRACT_FIXTURES=FAIL count=" + failed);
  process.exit(1);
}
console.log("SP08001_CONTRACT_FIXTURES=PASS");

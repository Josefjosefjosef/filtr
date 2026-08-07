/**
 * Synthetic TMC v11 ZIP builder for offline fixtures (never real NDIC data).
 */
import { SP08001_TABLE_CODES, getSp08001Table } from "./tmc-sp08001-contract.mjs";
import { buildSyntheticSp08001Dat, syntheticSp08001Row, syntheticPointsRow } from "./tmc-sp08001-header.mjs";
import { buildStoredZip } from "./tmc-zip.mjs";

function readmeBuf() {
  return Buffer.from("1\r\n01/01/2020\r\n01/01/2021\r\nSynthetic\r\nUTF-8\r\n2\r\n6\r\n", "utf8");
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.languagesFiveFields]
 * @param {boolean} [opts.languagesSixFields]
 * @param {boolean} [opts.emptyRnlt]
 * @param {boolean} [opts.invalidRnltHeader]
 * @param {boolean} [opts.allPesLevEmpty]
 * @param {string|null} [opts.pesLevValue]
 * @param {boolean} [opts.invalidPesLev]
 * @param {number} [opts.cid]
 * @param {number} [opts.tabcd]
 * @param {string} [opts.version]
 * @param {string[]} [opts.omitTables]
 * @param {boolean} [opts.extraUnknownDat]
 * @param {boolean} [opts.duplicateEntry]
 * @param {boolean} [opts.caseInsensitiveDuplicate]
 * @param {boolean} [opts.pathTraversal]
 * @param {boolean} [opts.wrongHeader]
 * @param {boolean} [opts.wrongFieldCount]
 * @param {boolean} [opts.longRow]
 * @param {boolean} [opts.longField]
 * @param {boolean} [opts.invalidUtf8]
 * @param {boolean} [opts.withBom]
 * @param {boolean} [opts.mixedLineEndings]
 * @param {boolean} [opts.duplicatePk]
 * @param {boolean} [opts.missingReference]
 * @param {boolean} [opts.selfReference]
 * @param {boolean} [opts.cycleReference]
 * @param {boolean} [opts.rnltAliasName]
 */
export function buildSyntheticBasicTmcZipFiles(opts = {}) {
  const cid = opts.cid != null ? String(opts.cid) : "11";
  const tabcd = opts.tabcd != null ? String(opts.tabcd) : "25";
  const version = opts.version != null ? String(opts.version) : "11";
  const omit = new Set(opts.omitTables || []);
  const files = [];

  for (const code of SP08001_TABLE_CODES) {
    if (omit.has(code)) continue;
    let rows = [];
    if (code === "LOCATIONDATASETS") {
      rows = [syntheticSp08001Row(code, { CID: cid, TABCD: tabcd, VERSION: version, DCOMMENT: "X" })];
    } else if (code === "COUNTRIES") {
      rows = [syntheticSp08001Row(code, { CID: cid })];
    } else if (code === "LANGUAGES") {
      const base = syntheticSp08001Row(code, { CID: cid, LID: "1", LANGUAGE: "X", REPRESENTATION: "" });
      if (opts.languagesSixFields) {
        // Force 6-field header via custom buffer below
        rows = null;
      } else if (opts.languagesFiveFields) {
        rows = null;
      } else {
        rows = [base];
      }
    } else if (code === "LOCATIONCODES") {
      rows = [
        syntheticSp08001Row(code, { CID: cid, TABCD: tabcd, LCD: "10001", ALLOCATED: "1" }),
        syntheticSp08001Row(code, { CID: cid, TABCD: tabcd, LCD: "10002", ALLOCATED: "1" }),
      ];
    } else if (code === "POINTS") {
      let p1 = syntheticPointsRow({ CID: cid, TABCD: tabcd, LCD: "10001", SEG_LCD: "", ROA_LCD: "", POL_LCD: "" });
      let p2 = syntheticPointsRow({ CID: cid, TABCD: tabcd, LCD: "10002", SEG_LCD: "", ROA_LCD: "", POL_LCD: "" });
      if (opts.selfReference) {
        p1 = syntheticPointsRow({ CID: cid, TABCD: tabcd, LCD: "10001", SEG_LCD: "10001" });
      }
      if (opts.cycleReference) {
        p1 = syntheticPointsRow({ CID: cid, TABCD: tabcd, LCD: "10001", SEG_LCD: "10002" });
        p2 = syntheticPointsRow({ CID: cid, TABCD: tabcd, LCD: "10002", SEG_LCD: "10001" });
      }
      if (opts.missingReference) {
        p1 = syntheticPointsRow({ CID: cid, TABCD: tabcd, LCD: "10001", SEG_LCD: "99999" });
      }
      if (opts.duplicatePk) {
        rows = [p1, syntheticPointsRow({ CID: cid, TABCD: tabcd, LCD: "10001" })];
      } else {
        rows = [p1, p2];
      }
    } else if (code === "ROADS") {
      const pes =
        opts.invalidPesLev === true ? "X" : opts.pesLevValue != null ? String(opts.pesLevValue) : opts.allPesLevEmpty === false ? "1" : "";
      rows = [
        syntheticSp08001Row(code, {
          CID: cid,
          TABCD: tabcd,
          LCD: "80001",
          CLASS: "L",
          TCD: "1",
          STCD: "1",
          PES_LEV: pes,
        }),
      ];
    } else if (code === "ROAD_NETWORK_LEVEL_TYPES") {
      if (opts.invalidRnltHeader) {
        files.push({
          name: opts.rnltAliasName ? "RNLT.DAT" : "ROAD_NETWORK_LEVEL_TYPES.DAT",
          data: Buffer.from("WRONG;HEADER\r\n", "utf8"),
        });
        continue;
      }
      if (opts.emptyRnlt !== false) {
        rows = []; // header only by default (PRESENT_EMPTY)
      } else {
        rows = [syntheticSp08001Row(code, { PES_LEV: "1", PES_LEV_DESC: "A", TDESC: "X" })];
      }
    } else if (
      code === "DLRS" ||
      code === "DLR_DESC" ||
      code === "NAMETRANSLATIONS" ||
      code === "SUBTYPETRANSLATION" ||
      code === "ERNO_BELONGS_TO_CO" ||
      code === "SEG_HAS_ERNO" ||
      code === "EUROROADNO" ||
      code === "JUNCTIONS" ||
      code === "OTHERAREAS"
    ) {
      rows = [];
    } else {
      rows = [syntheticSp08001Row(code, { CID: cid, TABCD: tabcd })];
    }

    let data;
    if (code === "LANGUAGES" && opts.languagesFiveFields) {
      data = Buffer.from("CID;LID;LANGUAGE;REPRESENTATION;EXTFIELD\r\n11;1;X;;ABCDEFGHIJKLMNOPQRSTU\r\n", "utf8");
    } else if (code === "LANGUAGES" && opts.languagesSixFields) {
      data = Buffer.from("CID;LID;LANGUAGE;REPRESENTATION;E5;E6\r\n11;1;X;;;\r\n", "utf8");
    } else if (code === "POINTS" && opts.wrongHeader) {
      data = Buffer.from("NOT;A;HEADER\r\n", "utf8");
    } else if (code === "POINTS" && opts.wrongFieldCount) {
      const hdr = getSp08001Table("POINTS").headerCodes.join(";");
      data = Buffer.from(hdr + "\r\n11;25;900001\r\n", "utf8");
    } else if (code === "POINTS" && opts.longRow) {
      const hdr = getSp08001Table("POINTS").headerCodes.join(";");
      data = Buffer.from(hdr + "\r\n" + "A".repeat(20_000) + "\r\n", "utf8");
    } else if (code === "NAMES" && opts.longField) {
      const hdr = getSp08001Table("NAMES").headerCodes.join(";");
      const long = "Z".repeat(2000);
      const row = syntheticSp08001Row("NAMES", { CID: cid, NAME: long });
      data = buildSyntheticSp08001Dat("NAMES", [row]);
      // rebuild with long name
      data = Buffer.from(hdr + "\r\n" + row.join(";").replace(/X(?![A-Z])/, long) + "\r\n", "utf8");
    } else if (code === "POINTS" && opts.invalidUtf8) {
      const hdr = Buffer.from(getSp08001Table("POINTS").headerCodes.join(";") + "\r\n", "utf8");
      data = Buffer.concat([hdr, Buffer.from([0xff, 0xfe, 0xfd]), Buffer.from("\r\n", "utf8")]);
    } else if (code === "POINTS" && opts.mixedLineEndings) {
      const hdr = getSp08001Table("POINTS").headerCodes.join(";");
      const r = syntheticPointsRow({ CID: cid, TABCD: tabcd, LCD: "900001" }).join(";");
      data = Buffer.from(hdr + "\r\n" + r + "\n", "utf8");
    } else if (rows === null) {
      continue;
    } else {
      data = buildSyntheticSp08001Dat(code, rows, { bom: opts.withBom === true && code === "POINTS" });
    }

    const name =
      code === "ROAD_NETWORK_LEVEL_TYPES" && opts.rnltAliasName ? "RNLT.DAT" : getSp08001Table(code).fileName;
    files.push({ name, data });
  }

  files.push({ name: "README.DAT", data: readmeBuf() });

  if (opts.extraUnknownDat) {
    files.push({ name: "UNKNOWN_EXTRA.DAT", data: Buffer.from("A;B\r\n1;2\r\n", "utf8") });
  }
  if (opts.extraDocumentedShpCompanion) {
    // Minimal shapefile companion bytes (non-authoritative; never parsed as SP08001 DAT).
    files.push({ name: "LOCATIONS.SHP", data: Buffer.from([0, 0, 0x27, 0x0a, 0, 0, 0, 0]) });
  }
  if (opts.extraUnknownTxt) {
    files.push({ name: "LICENSE.TXT", data: Buffer.from("synthetic\r\n", "utf8") });
  }
  if (opts.extraUnknownCsv) {
    files.push({ name: "EXTRA.CSV", data: Buffer.from("a,b\r\n1,2\r\n", "utf8") });
  }
  if (opts.duplicateEntry) {
    files.push({ name: "POINTS.DAT", data: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow()]) });
  }
  if (opts.caseInsensitiveDuplicate) {
    files.push({ name: "points.dat", data: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow()]) });
  }
  if (opts.pathTraversal) {
    files.push({ name: "../evil.DAT", data: Buffer.from("x", "utf8") });
  }

  return files;
}

export function buildSyntheticBasicTmcZipBuffer(opts = {}) {
  return buildStoredZip(buildSyntheticBasicTmcZipFiles(opts));
}

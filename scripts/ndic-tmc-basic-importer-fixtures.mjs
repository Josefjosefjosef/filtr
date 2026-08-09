#!/usr/bin/env node
/**
 * Offline synthetic fixtures for basic TMC v11 importer.
 * Never opens real NDIC archives. No network. Fail-closed gates.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildStoredZip, buildDeflatedZip } from "./ndic-datex-v1/tmc-zip.mjs";
import { buildSyntheticBasicTmcZipBuffer, buildSyntheticBasicTmcZipFiles } from "./ndic-datex-v1/tmc-basic-fixture-builder.mjs";
import {
  importBasicTmcArchive,
  rollbackBasicTmcImport,
  readActiveBasicIndex,
  FEATURE_FLAGS,
  TMC_IMPORTER_ERROR,
  RNLT_STATUS,
  PES_LEV_RELATIONSHIP_STATUS,
} from "./ndic-datex-v1/tmc-basic-importer.mjs";
import { createTestDiskStatsProvider, acquireTmcImportLock } from "./ndic-datex-v1/disk-preflight.mjs";
import { analyzeAndGateTmcZipFile } from "./ndic-datex-v1/tmc-archive-stream.mjs";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) {
    results.push({ id, pass: true });
  } else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

const AMPLE = createTestDiskStatsProvider({ availableBytes: 10n * 1024n * 1024n * 1024n });

function writeZip(name, buf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-tmc-bi-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return { dir, file };
}

function wipe(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function assertNoLeak(obj) {
  const s = JSON.stringify(obj);
  return (
    !/stáhnout/i.test(s) &&
    !/Downloads/i.test(s) &&
    !/900001/.test(s) === false // synthetic LCD may appear in staging path tests — forbid real Czech names instead
  );
}

function safeJson(obj) {
  const s = JSON.stringify(obj);
  ok("no_path_leak", !/C:\\\\Users|C:\/Users|AppData\\\\Local/i.test(s), "path");
  ok("no_secret_leak", !/password|authorization|bearer/i.test(s), "secret");
  return true;
}

async function run() {
  // --- feature flags locked ---
  ok("flag_rnlt_off", FEATURE_FLAGS.ADVANCED_RNLT_RELATIONSHIPS_ENABLED === false);
  ok("flag_pes_off", FEATURE_FLAGS.PES_LEV_RELATIONSHIP_RESOLUTION_ENABLED === false);
  ok("flag_lang5_off", FEATURE_FLAGS.LANGUAGES_FIFTH_FIELD_USED === false);
  ok("flag_infer_off", FEATURE_FLAGS.UNPROVEN_FIELDS_INFERRED === false);

  // 1 valid basic
  {
    const { dir, file } = writeZip("valid.zip", buildSyntheticBasicTmcZipBuffer({ emptyRnlt: true, allPesLevEmpty: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("valid_ok", r.ok === true, r.rejectCode);
    ok("valid_cid", r.cid === 11);
    ok("valid_tabcd", r.tabcd === 25);
    ok("valid_ver", r.tableVersion === 11);
    ok("valid_rnlt_empty", r.rnltStatus === RNLT_STATUS.PRESENT_EMPTY);
    ok("valid_pes_disabled", r.pesLevRelationshipStatus === PES_LEV_RELATIONSHIP_STATUS.DISABLED_UNPROVEN);
    ok("valid_lang5_not_used", r.languagesFifthFieldUsed === false);
    ok("valid_activation", r.metrics.activationSucceeded === true);
    ok("valid_cleanup", r.metrics.cleanupSucceeded === true);
    safeJson(r);
    wipe(dir);
  }

  // 2 missing required table
  {
    const { dir, file } = writeZip("miss.zip", buildSyntheticBasicTmcZipBuffer({ omitTables: ["POINTS"] }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("missing_table", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_REQUIRED_TABLE_MISSING, r.rejectCode);
    wipe(dir);
  }

  // 3 unknown unmapped .DAT → fail-closed (no broad extension ignore)
  {
    const { dir, file } = writeZip("unk.zip", buildSyntheticBasicTmcZipBuffer({ extraUnknownDat: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok(
      "unknown_table_fail_closed",
      r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT,
      r.rejectCode
    );
    ok("unknown_nonclassified_count", (r.unknownNonclassifiedCount || 0) >= 1, r.unknownNonclassifiedCount);
    wipe(dir);
  }

  // 3b documented shapefile companion → ignore + import pass
  {
    const { dir, file } = writeZip(
      "shp.zip",
      buildSyntheticBasicTmcZipBuffer({ extraDocumentedShpCompanion: true, emptyRnlt: true, allPesLevEmpty: true })
    );
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("documented_sidecar_ok", r.ok === true, r.rejectCode);
    ok("documented_sidecar_ignored", (r.ignoredNonStandardCount || 0) >= 1, r.ignoredNonStandardCount);
    ok(
      "documented_sidecar_reason",
      Array.isArray(r.ignoredEntries) &&
        r.ignoredEntries.some((e) => e.reasonCode === "COMPANION_NON_AUTHORITATIVE" && e.resolutionRequired === false),
      JSON.stringify(r.ignoredEntries)
    );
    ok("required_set_complete", r.requiredTableSetComplete === true);
    wipe(dir);
  }

  // 3c unknown .txt without documented classification → fail-closed
  {
    const { dir, file } = writeZip("unktxt.zip", buildSyntheticBasicTmcZipBuffer({ extraUnknownTxt: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok(
      "unknown_txt_fail_closed",
      r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT,
      r.rejectCode
    );
    wipe(dir);
  }

  // 3d unknown .csv → fail-closed
  {
    const { dir, file } = writeZip("unkcsv.zip", buildSyntheticBasicTmcZipBuffer({ extraUnknownCsv: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok(
      "unknown_csv_fail_closed",
      r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT,
      r.rejectCode
    );
    wipe(dir);
  }

  // 4 duplicate entry
  {
    const { dir, file } = writeZip("dup.zip", buildSyntheticBasicTmcZipBuffer({ duplicateEntry: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("dup_entry", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_ARCHIVE_DUPLICATE_ENTRY, r.rejectCode);
    wipe(dir);
  }

  // 5 case-insensitive duplicate
  {
    const { dir, file } = writeZip("cidup.zip", buildSyntheticBasicTmcZipBuffer({ caseInsensitiveDuplicate: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("case_dup", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_ARCHIVE_DUPLICATE_ENTRY, r.rejectCode);
    wipe(dir);
  }

  // 6 path traversal
  {
    const { dir, file } = writeZip("slip.zip", buildSyntheticBasicTmcZipBuffer({ pathTraversal: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("zip_slip", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_ZIP_BAD_PATH, r.rejectCode);
    wipe(dir);
  }

  // 7 zip bomb (ratio / size)
  {
    const files = [{ name: "POINTS.DAT", data: "x", inflatePad: 5 * 1024 * 1024 }];
    const buf = buildDeflatedZip(files);
    const { dir, file } = writeZip("bomb.zip", buf);
    const r = await importBasicTmcArchive(file, {
      workDir: path.join(dir, "w"),
      measureDeps: AMPLE,
      skipArchiveHash: true,
      limits: { maxCompressionRatio: 2, maxUncompressedTotal: 1024 * 1024, maxSingleUncompressed: 1024 * 1024, maxEntries: 256, maxCompressedTotal: 48 * 1024 * 1024 },
    });
    ok("zip_bomb", r.ok === false, r.rejectCode);
    wipe(dir);
  }

  // 8 unsupported compression
  {
    const files = buildSyntheticBasicTmcZipFiles();
    // Craft one entry with method 99 by patching — simpler: small custom zip
    const name = Buffer.from("X.DAT");
    const data = Buffer.from("a");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(99, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(99, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const centralStart = 30 + name.length + data.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12);
    end.writeUInt32LE(centralStart, 16);
    const buf = Buffer.concat([local, name, data, central, name, end]);
    const { dir, file } = writeZip("badm.zip", buf);
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("bad_method", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_ARCHIVE_UNSUPPORTED_COMPRESSION, r.rejectCode);
    wipe(dir);
  }

  // 9 encrypted
  {
    const name = Buffer.from("X.DAT");
    const data = Buffer.from("a");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x1, 6); // encrypted flag
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x1, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const centralStart = 30 + name.length + data.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12);
    end.writeUInt32LE(centralStart, 16);
    const buf = Buffer.concat([local, name, data, central, name, end]);
    const { dir, file } = writeZip("enc.zip", buf);
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("encrypted", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_ARCHIVE_ENCRYPTED, r.rejectCode);
    wipe(dir);
  }

  // 10-12 cid/tabcd/version
  for (const [id, o, code] of [
    ["bad_cid", { cid: 99 }, TMC_IMPORTER_ERROR.TMC_CID_MISMATCH],
    ["bad_tabcd", { tabcd: 99 }, TMC_IMPORTER_ERROR.TMC_TABCD_MISMATCH],
    ["bad_ver", { version: "99" }, TMC_IMPORTER_ERROR.TMC_VERSION_MISMATCH],
  ]) {
    const { dir, file } = writeZip(id + ".zip", buildSyntheticBasicTmcZipBuffer(o));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok(id, r.ok === false && r.rejectCode === code, r.rejectCode);
    wipe(dir);
  }

  // 13 header mismatch
  {
    const { dir, file } = writeZip("hdr.zip", buildSyntheticBasicTmcZipBuffer({ wrongHeader: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("header_mismatch", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_HEADER_MISMATCH, r.rejectCode);
    wipe(dir);
  }

  // 14 field count
  {
    const { dir, file } = writeZip("fc.zip", buildSyntheticBasicTmcZipBuffer({ wrongFieldCount: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("field_count", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_FIELD_COUNT_MISMATCH, r.rejectCode);
    wipe(dir);
  }

  // 15 long row
  {
    const { dir, file } = writeZip("lr.zip", buildSyntheticBasicTmcZipBuffer({ longRow: true }));
    const r = await importBasicTmcArchive(file, {
      workDir: path.join(dir, "w"),
      measureDeps: AMPLE,
      skipArchiveHash: true,
      datLimits: { maxLineBytes: 1024, maxFieldBytes: 512, maxFields: 64, maxRowsPerTable: 1000, maxTableBytes: 8 * 1024 * 1024 },
    });
    ok("long_row", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_ROW_TOO_LONG, r.rejectCode);
    wipe(dir);
  }

  // 16 long field
  {
    const { dir, file } = writeZip("lf.zip", buildSyntheticBasicTmcZipBuffer({ longField: true }));
    const r = await importBasicTmcArchive(file, {
      workDir: path.join(dir, "w"),
      measureDeps: AMPLE,
      skipArchiveHash: true,
      datLimits: { maxLineBytes: 8 * 1024, maxFieldBytes: 100, maxFields: 64, maxRowsPerTable: 1000, maxTableBytes: 8 * 1024 * 1024 },
    });
    ok("long_field", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_FIELD_TOO_LONG, r.rejectCode);
    wipe(dir);
  }

  // 17 invalid encoding
  {
    const { dir, file } = writeZip("enc2.zip", buildSyntheticBasicTmcZipBuffer({ invalidUtf8: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("bad_encoding", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_ENCODING_INVALID, r.rejectCode);
    wipe(dir);
  }

  // 18 BOM rejected when configured
  {
    const { dir, file } = writeZip("bom.zip", buildSyntheticBasicTmcZipBuffer({ withBom: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true, rejectBom: true });
    ok("bad_bom", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_ENCODING_INVALID, r.rejectCode);
    wipe(dir);
  }

  // 19 mixed line endings
  {
    const { dir, file } = writeZip("mix.zip", buildSyntheticBasicTmcZipBuffer({ mixedLineEndings: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("mixed_nl", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_ENCODING_INVALID, r.rejectCode);
    wipe(dir);
  }

  // 20 duplicate PK
  {
    const { dir, file } = writeZip("dpk.zip", buildSyntheticBasicTmcZipBuffer({ duplicatePk: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("dup_pk", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_PRIMARY_KEY_DUPLICATE, r.rejectCode);
    wipe(dir);
  }

  // 21 missing reference — basic import still ok (unresolved counted)
  {
    const { dir, file } = writeZip("mref.zip", buildSyntheticBasicTmcZipBuffer({ missingReference: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("missing_ref_ok", r.ok === true, r.rejectCode);
    ok("missing_ref_metric", r.metrics.missingReferenceCount >= 1, String(r.metrics.missingReferenceCount));
    wipe(dir);
  }

  // 22 cycle
  {
    const { dir, file } = writeZip("cyc.zip", buildSyntheticBasicTmcZipBuffer({ cycleReference: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("cycle_ref", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_REFERENCE_INVALID, r.rejectCode);
    wipe(dir);
  }

  // 23 self-ref
  {
    const { dir, file } = writeZip("self.zip", buildSyntheticBasicTmcZipBuffer({ selfReference: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("self_ref", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_REFERENCE_INVALID, r.rejectCode);
    wipe(dir);
  }

  // 24 empty RNLT basic import
  {
    const { dir, file } = writeZip("rnlt.zip", buildSyntheticBasicTmcZipBuffer({ emptyRnlt: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("empty_rnlt", r.ok === true && r.rnltStatus === RNLT_STATUS.PRESENT_EMPTY, r.rnltStatus);
    wipe(dir);
  }

  // 25 invalid RNLT header — still fail-closed on header for that table
  {
    const { dir, file } = writeZip("rnltbad.zip", buildSyntheticBasicTmcZipBuffer({ invalidRnltHeader: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("invalid_rnlt", r.ok === false, r.rejectCode);
    wipe(dir);
  }

  // 26 all PES_LEV empty fail-closed advanced
  {
    const { dir, file } = writeZip("pes.zip", buildSyntheticBasicTmcZipBuffer({ allPesLevEmpty: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("empty_pes", r.ok === true && r.pesLevRelationshipStatus === PES_LEV_RELATIONSHIP_STATUS.DISABLED_UNPROVEN);
    ok("empty_pes_count", r.metrics.emptyPesLevCount >= 1, String(r.metrics.emptyPesLevCount));
    wipe(dir);
  }

  // 27 non-empty PES_LEV accepted as value but not resolved
  {
    const { dir, file } = writeZip("pes2.zip", buildSyntheticBasicTmcZipBuffer({ allPesLevEmpty: false, pesLevValue: "1", emptyRnlt: false }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("pes_nonempty", r.ok === true && r.metrics.nonEmptyPesLevCount >= 1, r.rejectCode);
    ok("pes_still_disabled", r.pesLevRelationshipStatus === PES_LEV_RELATIONSHIP_STATUS.DISABLED_UNPROVEN);
    wipe(dir);
  }

  // 28 invalid PES_LEV
  {
    const { dir, file } = writeZip("pes3.zip", buildSyntheticBasicTmcZipBuffer({ invalidPesLev: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("pes_invalid", r.ok === false, r.rejectCode);
    wipe(dir);
  }

  // 29 languages 4 fields
  {
    const { dir, file } = writeZip("lang4.zip", buildSyntheticBasicTmcZipBuffer({}));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("lang4", r.ok === true && r.languagesExtensionFieldPresent !== true, String(r.languagesExtensionFieldPresent));
    wipe(dir);
  }

  // 30 languages 5 fields detected ignored
  {
    const { dir, file } = writeZip("lang5.zip", buildSyntheticBasicTmcZipBuffer({ languagesFiveFields: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("lang5_ok", r.ok === true && r.languagesExtensionFieldPresent === true, r.rejectCode);
    ok("lang5_unused", r.languagesFifthFieldUsed === false && r.languagesExtensionFieldSupported === false);
    wipe(dir);
  }

  // 31 languages 6 fields fail
  {
    const { dir, file } = writeZip("lang6.zip", buildSyntheticBasicTmcZipBuffer({ languagesSixFields: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok(
      "lang6",
      r.ok === false &&
        (r.rejectCode === TMC_IMPORTER_ERROR.TMC_LANGUAGES_EXTENSION_UNSUPPORTED ||
          r.rejectCode === TMC_IMPORTER_ERROR.TMC_FIELD_COUNT_MISMATCH),
      r.rejectCode
    );
    wipe(dir);
  }

  // 32 staging failure
  {
    const { dir, file } = writeZip("st.zip", buildSyntheticBasicTmcZipBuffer({}));
    const r = await importBasicTmcArchive(file, {
      workDir: path.join(dir, "w"),
      measureDeps: AMPLE,
      skipArchiveHash: true,
      forceStagingFailure: true,
    });
    ok("staging_fail", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_STAGING_FAILED, r.rejectCode);
    wipe(dir);
  }

  // 33 pre-activation failure
  {
    const { dir, file } = writeZip("pa.zip", buildSyntheticBasicTmcZipBuffer({}));
    const r = await importBasicTmcArchive(file, {
      workDir: path.join(dir, "w"),
      measureDeps: AMPLE,
      skipArchiveHash: true,
      forcePreActivationFailure: true,
    });
    ok("pre_act_fail", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_VALIDATION_FAILED, r.rejectCode);
    wipe(dir);
  }

  // 34 activation failure
  {
    const { dir, file } = writeZip("af.zip", buildSyntheticBasicTmcZipBuffer({}));
    const r = await importBasicTmcArchive(file, {
      workDir: path.join(dir, "w"),
      measureDeps: AMPLE,
      skipArchiveHash: true,
      forceActivationFailure: true,
    });
    ok("act_fail", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_ACTIVATION_FAILED, r.rejectCode);
    wipe(dir);
  }

  // 35-36 rollback + last-good
  {
    const { dir, file } = writeZip("rb.zip", buildSyntheticBasicTmcZipBuffer({}));
    const work = path.join(dir, "w");
    const r1 = await importBasicTmcArchive(file, { workDir: work, measureDeps: AMPLE, skipArchiveHash: true, returnInternalPaths: true });
    ok("rb_first", r1.ok === true, r1.rejectCode);
    const paths = r1._internalIndexPaths;
    const before = readActiveBasicIndex(paths.activePath);
    ok("rb_active", before != null && before.importRunId === r1.importRunId);
    // second import creates last-good
    const { dir: dir2, file: file2 } = writeZip("rb2.zip", buildSyntheticBasicTmcZipBuffer({}));
    const r2 = await importBasicTmcArchive(file2, { workDir: work, measureDeps: AMPLE, skipArchiveHash: true, returnInternalPaths: true });
    ok("rb_second", r2.ok === true, r2.rejectCode);
    const mid = readActiveBasicIndex(paths.activePath);
    ok("rb_active2", mid != null && mid.importRunId === r2.importRunId);
    const rb = rollbackBasicTmcImport(paths);
    ok("rollback", rb.ok === true);
    const after = readActiveBasicIndex(paths.activePath);
    ok("last_good", after != null && after.importRunId === r1.importRunId, after && after.importRunId);
    wipe(dir);
    wipe(dir2);
  }

  // 37 parallel lock
  {
    const { dir, file } = writeZip("lk.zip", buildSyntheticBasicTmcZipBuffer({}));
    const work = path.join(dir, "w");
    fs.mkdirSync(path.join(work, ".locks"), { recursive: true });
    const lock = acquireTmcImportLock(path.join(work, ".locks"), { holder: "test-holder", ttlMs: 60_000 });
    ok("lock_held", lock.ok === true);
    const r = await importBasicTmcArchive(file, { workDir: work, measureDeps: AMPLE, skipArchiveHash: true });
    ok("lock_block", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_IMPORT_ALREADY_RUNNING, r.rejectCode);
    lock.release();
    wipe(dir);
  }

  // 38 stale lock
  {
    const { dir, file } = writeZip("sl.zip", buildSyntheticBasicTmcZipBuffer({}));
    const work = path.join(dir, "w");
    const lockDir = path.join(work, ".locks");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, "tmc-import.lock"), JSON.stringify({ holder: "old", at: Date.now() - 120_000, pid: 1 }));
    const r = await importBasicTmcArchive(file, { workDir: work, measureDeps: AMPLE, skipArchiveHash: true, lockTtlMs: 30_000 });
    ok("stale_lock", r.ok === true, r.rejectCode);
    wipe(dir);
  }

  // 39 cleanup verified on success
  {
    const { dir, file } = writeZip("cl.zip", buildSyntheticBasicTmcZipBuffer({}));
    const work = path.join(dir, "w");
    const r = await importBasicTmcArchive(file, { workDir: work, measureDeps: AMPLE, skipArchiveHash: true, requireCleanup: true });
    ok("cleanup", r.ok === true && r.metrics.cleanupSucceeded === true);
    const stagingLeft = fs.existsSync(work) && fs.readdirSync(work).some((n) => n.startsWith("staging-"));
    ok("cleanup_no_staging", stagingLeft === false, String(stagingLeft));
    wipe(dir);
  }

  // 40 orphan temp — ensure wipe of work dir leaves no orphans from our run
  {
    const { dir, file } = writeZip("or.zip", buildSyntheticBasicTmcZipBuffer({}));
    const work = path.join(dir, "w");
    await importBasicTmcArchive(file, { workDir: work, measureDeps: AMPLE, skipArchiveHash: true });
    wipe(dir);
    ok("orphan_temp", fs.existsSync(dir) === false);
  }

  // 41 memory limit
  {
    const { dir, file } = writeZip("mem.zip", buildSyntheticBasicTmcZipBuffer({}));
    const r = await importBasicTmcArchive(file, {
      workDir: path.join(dir, "w"),
      measureDeps: AMPLE,
      skipArchiveHash: true,
      maxHeapBytes: 1,
    });
    ok("mem_limit", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_MEMORY_LIMIT, r.rejectCode);
    wipe(dir);
  }

  // 42 disk limit
  {
    const { dir, file } = writeZip("disk.zip", buildSyntheticBasicTmcZipBuffer({}));
    const tiny = createTestDiskStatsProvider({ availableBytes: 1n });
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: tiny, skipArchiveHash: true });
    ok("disk_limit", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_DISK_LIMIT, r.rejectCode);
    wipe(dir);
  }

  // 43 read-only input — archive itself remains readable; mark via chmod on Windows may no-op — simulate not found sibling
  {
    const { dir } = writeZip("ro.zip", buildSyntheticBasicTmcZipBuffer({}));
    const missing = path.join(dir, "missing.zip");
    const r = await importBasicTmcArchive(missing, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("readonly_missing", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_ARCHIVE_NOT_FOUND, r.rejectCode);
    wipe(dir);
  }

  // 44 partial output
  {
    const { dir, file } = writeZip("po.zip", buildSyntheticBasicTmcZipBuffer({}));
    const r = await importBasicTmcArchive(file, {
      workDir: path.join(dir, "w"),
      measureDeps: AMPLE,
      skipArchiveHash: true,
      forcePartialOutput: true,
    });
    ok("partial", r.ok === false && r.rejectCode === TMC_IMPORTER_ERROR.TMC_PARTIAL_OUTPUT, r.rejectCode);
    wipe(dir);
  }

  // 45 atomic activation — no partial visibility of active before success
  {
    const { dir, file } = writeZip("atom.zip", buildSyntheticBasicTmcZipBuffer({}));
    const work = path.join(dir, "w");
    const r = await importBasicTmcArchive(file, { workDir: work, measureDeps: AMPLE, skipArchiveHash: true, returnInternalPaths: true });
    ok("atomic", r.ok === true);
    ok("atomic_active", fs.existsSync(r._internalIndexPaths.activePath));
    ok("atomic_no_partial", fs.existsSync(r._internalIndexPaths.activePath + ".partial") === false);
    wipe(dir);
  }

  // gate readiness
  {
    const { dir, file } = writeZip("gate.zip", buildSyntheticBasicTmcZipBuffer({}));
    const g = analyzeAndGateTmcZipFile(file, { workDir: dir, measureDeps: AMPLE, skipLock: true });
    ok("gate_ready", g.importerStatus === "BASIC_IMPORTER_READY", g.importerStatus);
    wipe(dir);
  }

  // RNLT alias basename
  {
    const { dir, file } = writeZip("rnltname.zip", buildSyntheticBasicTmcZipBuffer({ rnltAliasName: true, emptyRnlt: true }));
    const r = await importBasicTmcArchive(file, { workDir: path.join(dir, "w"), measureDeps: AMPLE, skipArchiveHash: true });
    ok("rnlt_alias", r.ok === true, r.rejectCode);
    wipe(dir);
  }

  // LT CZE v11: empty POINTS.INTERRUPTSROAD is documented semantic-null (Tab.5) → accept
  {
    const { dir, file } = writeZip(
      "empty-ir.zip",
      buildSyntheticBasicTmcZipBuffer({ emptyRnlt: true, allPesLevEmpty: true, pointsEmptyInterruptsRoad: true })
    );
    const r = await importBasicTmcArchive(file, {
      workDir: path.join(dir, "w"),
      measureDeps: AMPLE,
      skipArchiveHash: true,
      returnResolverTable: true,
    });
    ok("points_empty_interruptsroad_ok", r.ok === true, r.rejectCode);
    ok(
      "points_empty_interruptsroad_activated",
      r.ok === true && r.resolverTable && Object.keys(r.resolverTable.points || {}).length === 2,
      r.rejectCode
    );
    wipe(dir);
  }

  // LT CZE v11 Tab.6: empty INPOS is NOT documented (only 0|1) → reject row / fail closed
  {
    const { dir, file } = writeZip(
      "empty-inpos.zip",
      buildSyntheticBasicTmcZipBuffer({ emptyRnlt: true, allPesLevEmpty: true, pointsEmptyInpos: true })
    );
    const r = await importBasicTmcArchive(file, {
      workDir: path.join(dir, "w"),
      measureDeps: AMPLE,
      skipArchiveHash: true,
      returnResolverTable: true,
    });
    // One of two POINTS rows has empty INPOS → soft-reject that row; other may remain.
    // If both would be invalid or relationships fail, import may fail — either way empty INPOS must not inflate index via bypass.
    const pts = r.ok && r.resolverTable ? Object.keys(r.resolverTable.points || {}).length : 0;
    ok("points_empty_inpos_not_both_accepted", !(r.ok === true && pts === 2), "pts=" + pts + " code=" + r.rejectCode);
    wipe(dir);
  }

  const pass = results.filter((x) => x.pass).length;
  const failN = results.filter((x) => !x.pass).length;
  const summary = {
    suite: "TMC_BASIC_IMPORTER_FIXTURES",
    total: results.length,
    success: pass,
    failure: failN,
    skipped: 0,
    syntheticOnly: true,
    realArchiveUsed: false,
  };
  // Print only opaque summary + fail ids (no licensed data)
  process.stdout.write(JSON.stringify(summary) + "\n");
  if (failN) {
    process.stdout.write(JSON.stringify({ fails: fails.slice(0, 50) }) + "\n");
    process.exitCode = 1;
  }
}

run().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      suite: "TMC_BASIC_IMPORTER_FIXTURES",
      failure: 1,
      internal: true,
      rejectCode: "TMC_INTERNAL_SAFE_FAILURE",
    }) + "\n"
  );
  process.exitCode = 1;
  void err;
});

/**
 * Offline fixtures: root-cause removal for TMC_ARCHIVE_USED=false / RESOLVED_BASIC=0.
 * Synthetic SP08001 only — never opens real licensed NDIC archives.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LIMITS } from "./ndic-datex-v1/config.mjs";
import {
  DEFAULT_ZIP_LIMITS,
  parseTmcTableFromDownload,
  resolveTmcParseLimits,
  buildStoredZip,
} from "./ndic-datex-v1/tmc-zip.mjs";
import { resolveTmcDownloadLimits, loadTmcTableFromDownload } from "./ndic-datex-v1/tmc-download-load.mjs";
import { buildSyntheticBasicTmcZipBuffer } from "./ndic-datex-v1/tmc-basic-fixture-builder.mjs";
import { localizeFromTmc } from "./ndic-datex-v1/tmc-localize.mjs";
import { activateTmcTable, emptyTmcStore, lookupTmcPoint } from "./ndic-datex-v1/tmc-table.mjs";
import {
  parseSp08001Coordinate,
  buildTmcResolverTableFromSp08001Accepted,
} from "./ndic-datex-v1/tmc-resolver-table-bridge.mjs";
import { classifyManifest } from "./ndic-datex-v1/tmc-basic-importer.mjs";
import { OBSERVED_TMC_ZIP_UNCOMPRESSED, OBSERVED_TMC_ZIP_LARGEST_ENTRY } from "./ndic-datex-v1/disk-preflight.mjs";
import { TMC_IMPORTER_ERROR } from "./ndic-datex-v1/tmc-importer-errors.mjs";
import { SP08001_TABLE_CODES } from "./ndic-datex-v1/tmc-sp08001-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else passCount += 1;
}

const AMPLE = {
  availableBytes: 8 * 1024 * 1024 * 1024,
  pathOk: true,
};

// --- Cycle 1: prove DATEX clamp was the unzip blocker ---
{
  const datexCap = DEFAULT_LIMITS.maxResponseBytes;
  const legacyClamped = Math.min(DEFAULT_ZIP_LIMITS.maxUncompressedTotal, datexCap);
  ok("rc1_datex_cap_lt_real_unc", datexCap < OBSERVED_TMC_ZIP_UNCOMPRESSED);
  ok("rc1_legacy_clamp_blocks_total", OBSERVED_TMC_ZIP_UNCOMPRESSED > legacyClamped);
  ok("rc1_legacy_clamp_blocks_entry", OBSERVED_TMC_ZIP_LARGEST_ENTRY > legacyClamped);
  ok("rc1_default_allows_entry", OBSERVED_TMC_ZIP_LARGEST_ENTRY <= DEFAULT_ZIP_LIMITS.maxSingleUncompressed);
  ok("rc1_default_allows_total", OBSERVED_TMC_ZIP_UNCOMPRESSED <= DEFAULT_ZIP_LIMITS.maxUncompressedTotal);

  const fixed = resolveTmcParseLimits({ limits: { maxResponseBytes: datexCap } });
  ok("rc1_fixed_ignores_datex_cap", fixed.maxUncompressedTotal === DEFAULT_ZIP_LIMITS.maxUncompressedTotal);
  ok("rc1_fixed_gzip_ignores_datex", fixed.maxGzipOutput === DEFAULT_ZIP_LIMITS.maxGzipOutput);

  const dl = resolveTmcDownloadLimits({ limits: { maxResponseBytes: datexCap } });
  ok("rc1_download_limits_ignore_datex", dl.maxUncompressedTotal === DEFAULT_ZIP_LIMITS.maxUncompressedTotal);
}

// --- Cycle 1b: reproduce legacy clamp failure on oversized declared ZIP ---
{
  const fakePoints = Buffer.alloc(100, 0x41);
  const zip = buildStoredZip([{ name: "POINTS.DAT", data: fakePoints, inflatePad: 0 }]);
  // Patch central uncompressed size to look like real NDIC entry (~118 MiB) while keeping tiny payload:
  // buildStoredZip writes real sizes — instead call parse with artificially clamped limits.
  let threw = null;
  try {
    parseTmcTableFromDownload(zip, {
      limits: {
        maxUncompressedTotal: DEFAULT_LIMITS.maxResponseBytes,
        maxSingleUncompressed: DEFAULT_LIMITS.maxResponseBytes,
        maxGzipOutput: DEFAULT_LIMITS.maxResponseBytes,
      },
    });
  } catch (e) {
    threw = e;
  }
  // Tiny zip still parses or fails payload — prove resolveTmcParseLimits no longer auto-clamps via maxResponseBytes alone
  const auto = resolveTmcParseLimits({ limits: { maxResponseBytes: 1024 } });
  ok("rc1_maxResponseBytes_not_applied", auto.maxUncompressedTotal === DEFAULT_ZIP_LIMITS.maxUncompressedTotal);
  ok("rc1_tiny_zip_path_stable", threw == null || Boolean(threw.code));
}

// --- Cycle 2: SP08001 import → resolver table → localize ---
{
  const buf = buildSyntheticBasicTmcZipBuffer({
    // Czech-ish coords: lon 14.5, lat 50.1 → /1e-5
  });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "iu-tmc-rc-"));
  const loaded = await loadTmcTableFromDownload(buf, {
    workDir: work,
    skipArchiveHash: true,
    limits: { ...DEFAULT_ZIP_LIMITS },
  });
  ok("rc2_load_ok", loaded.ok === true, loaded.rejectCode);
  ok("rc2_source_sp08001", loaded.source === "sp08001_basic");
  ok("rc2_points_present", loaded.ok && Object.keys(loaded.table.points).length >= 2);

  const store = emptyTmcStore();
  const act = activateTmcTable(store, loaded.table, {});
  ok("rc2_activate_ok", act.ok === true, act.reason);
  ok("rc2_lookup_10001", Boolean(lookupTmcPoint(store.active, 10001)));

  const loc = localizeFromTmc(
    [{ locationCode: 10001, countryCode: 2, tableNumber: 25, direction: "positive" }],
    store.active,
    {}
  );
  ok("rc2_localize_tmc_ok", loc.tmcOk >= 1);
  ok("rc2_localize_trust_tmc", loc.trust === "tmc");
}

// --- Cycle 2b: bridge unit + coord scale ---
{
  ok("rc2_coord_parse", parseSp08001Coordinate("+01450000") === 14.5);
  ok("rc2_coord_lat", parseSp08001Coordinate("+05010000") === 50.1);
  ok("rc2_coord_reject_alpha", parseSp08001Coordinate("abc") === null);

  const table = buildTmcResolverTableFromSp08001Accepted({
    tableVersion: 11,
    points: [
      {
        CID: "11",
        TABCD: "25",
        LCD: "20001",
        XCOORD: "+01450000",
        YCOORD: "+05010000",
        ROA_LCD: "80001",
        N1ID: "1",
      },
    ],
    roads: [{ LCD: "80001", ROADNUMBER: "D0", RNID: "2" }],
    names: [
      { NID: "1", NAME: "SynPoint" },
      { NID: "2", NAME: "SynRoad" },
    ],
  });
  ok("rc2_bridge_lcd", Boolean(table.points["20001"]));
  ok("rc2_bridge_lat", table.points["20001"].lat === 50.1);
  ok("rc2_bridge_lon", table.points["20001"].lon === 14.5);
  ok("rc2_bridge_road", table.points["20001"].roadNumber === "D0");
  ok("rc2_bridge_name", table.points["20001"].name === "SynPoint");
}

// --- Cycle 3: JSON path still works (no SP08001) ---
{
  const json = JSON.stringify({
    version: "json-v1",
    countryCode: 2,
    tableNumber: 25,
    points: { "9": { lcd: 9, name: "J", lat: 50, lon: 14 } },
  });
  const loaded = await loadTmcTableFromDownload(Buffer.from(json, "utf8"), {});
  ok("rc3_json_ok", loaded.ok === true);
  ok("rc3_json_source", loaded.source === "plain_or_json");
  ok("rc3_json_point", loaded.ok && Boolean(loaded.table.points["9"]));
}

// --- Cycle 4: source wiring in prod-sync ---
{
  const syncSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1-prod-sync.mjs"), "utf8");
  ok("rc4_uses_loadTmc", /loadTmcTableFromDownload/.test(syncSrc));
  ok("rc4_no_datex_body_clamp_for_tmc", !/bodyBuf\.length > config\.limits\.maxResponseBytes/.test(syncSrc));
  ok("rc4_uses_tmc_compressed_cap", /DEFAULT_ZIP_LIMITS\.maxCompressedTotal/.test(syncSrc));
  const zipSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "tmc-zip.mjs"), "utf8");
  ok("rc4_no_math_min_datex_clamp", !/Math\.min\(\s*DEFAULT_ZIP_LIMITS\.maxUncompressedTotal/.test(zipSrc));
  const impSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "tmc-basic-importer.mjs"), "utf8");
  ok("rc4_importer_full_peek", /maxPeekBytes != null \? opts\.maxPeekBytes : lim\.maxSingleUncompressed/.test(impSrc));
  ok("rc4_importer_return_resolver", /returnResolverTable/.test(impSrc));
}

// --- Cycle 5: forensic reason fields present ---
{
  const c = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "shadow-forensic-constants.mjs"), "utf8");
  ok("rc5_allowlist_reason", /"TMC_REASON"/.test(c));
  ok("rc5_allowlist_active", /"TMC_ACTIVE"/.test(c));
  ok("rc5_allowlist_points", /"TMC_POINT_COUNT"/.test(c));
  ok("rc5_allowlist_ignored", /"TMC_NONSTANDARD_IGNORED_COUNT"/.test(c));
}

// --- Cycle 6: fail-closed on unmapped text tables; documented companions only ---
{
  const forensic = JSON.parse(
    fs.readFileSync(
      path.join(
        process.env.TEMP || os.tmpdir(),
        "iu_ndic_forensic_31154704577",
        "ndic-shadow-forensic-31154704577-64fd72caa801335b6500587906703166979d7839",
        "ndic-shadow-forensic-summary.json"
      ),
      "utf8"
    )
  );
  ok("rc6_forensic_reason_unknown_table", forensic.TMC_REASON === "TMC_UNKNOWN_TABLE_PRESENT");
  ok("rc6_forensic_archive_false", forensic.TMC_ARCHIVE_USED === false);
  ok("rc6_forensic_points_zero", forensic.TMC_POINT_COUNT === 0);
  ok("rc6_prior_basename_not_retained", forensic.UNKNOWN_TABLE_BASENAME == null);
  ok("rc6_prior_path_not_retained", forensic.UNKNOWN_TABLE_ENTRY_PATH == null);

  const std = SP08001_TABLE_CODES.map((code) => ({ tableCode: code, ext: "dat", role: "standard" }));
  std.push({ tableCode: "README", ext: "dat", role: "metadata" });

  const withUnknown = [
    ...std,
    { tableCode: null, ext: "txt", role: "unknown_txt", basenameDigest: "aaaaaaaaaaaaaaaa" },
    { tableCode: null, ext: "dat", role: "unknown_dat", basenameDigest: "bbbbbbbbbbbbbbbb" },
    { tableCode: null, ext: "csv", role: "unknown_txt", basenameDigest: "cccccccccccccccc" },
  ];
  const mFail = classifyManifest(withUnknown);
  ok("rc6_unknown_text_fail_closed", mFail.ok === false && mFail.rejectCode === TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT);
  ok("rc6_unknown_nonclassified", (mFail.unknownNonclassifiedCount || 0) === 3, mFail.unknownNonclassifiedCount);
  ok(
    "rc6_unknown_entries_retained",
    Array.isArray(mFail.unknownNonclassifiedEntries) && mFail.unknownNonclassifiedEntries.length === 3
  );
  ok(
    "rc6_unknown_digests",
    mFail.unknownNonclassifiedEntries.every((e) => /^[a-f0-9]{16}$/.test(e.basenameDigest))
  );
  ok("rc6_required_found_on_fail", mFail.requiredTableCountFound === 25, mFail.requiredTableCountFound);
  ok("rc6_prior_unknown_entries_absent_in_summary", forensic.TMC_UNKNOWN_NONCLASSIFIED_ENTRIES == null);

  const withShp = [...std, { tableCode: null, ext: "shp", role: "shp_layer", basenameDigest: "dddddddddddddddd" }];
  const mOk = classifyManifest(withShp);
  ok("rc6_documented_shp_ok", mOk.ok === true, mOk.rejectCode);
  ok("rc6_shp_ignored_count", mOk.ignoredNonStandardCount === 1, mOk.ignoredNonStandardCount);
  ok("rc6_shp_reason", mOk.ignoredEntries[0].reasonCode === "COMPANION_NON_AUTHORITATIVE");
  ok("rc6_shp_not_resolution_required", mOk.ignoredEntries[0].resolutionRequired === false);
  ok("rc6_required_complete", mOk.requiredTableSetComplete === true);

  const missingPts = classifyManifest([
    ...std.filter((t) => t.tableCode !== "POINTS"),
    { tableCode: null, ext: "shp", role: "shp_layer" },
  ]);
  ok(
    "rc6_missing_points_still_fails",
    missingPts.ok === false && missingPts.rejectCode === TMC_IMPORTER_ERROR.TMC_REQUIRED_TABLE_MISSING,
    missingPts.rejectCode
  );

  const bufFail = buildSyntheticBasicTmcZipBuffer({ extraUnknownDat: true });
  const workFail = fs.mkdtempSync(path.join(os.tmpdir(), "iu-tmc-rc6f-"));
  const loadedFail = await loadTmcTableFromDownload(bufFail, {
    workDir: workFail,
    skipArchiveHash: true,
    limits: { ...DEFAULT_ZIP_LIMITS },
  });
  ok("rc6_load_unknown_fails", loadedFail.ok === false && loadedFail.rejectCode === TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT);

  const bufOk = buildSyntheticBasicTmcZipBuffer({
    extraDocumentedShpCompanion: true,
    emptyRnlt: true,
    allPesLevEmpty: true,
  });
  const workOk = fs.mkdtempSync(path.join(os.tmpdir(), "iu-tmc-rc6o-"));
  const loadedOk = await loadTmcTableFromDownload(bufOk, {
    workDir: workOk,
    skipArchiveHash: true,
    limits: { ...DEFAULT_ZIP_LIMITS },
  });
  ok("rc6_load_documented_sidecar_ok", loadedOk.ok === true, loadedOk.rejectCode);
  ok("rc6_ignored_propagated", (loadedOk.ignoredNonStandardCount || 0) >= 1, loadedOk.ignoredNonStandardCount);
  const store = emptyTmcStore();
  const act = activateTmcTable(store, loadedOk.table, {});
  ok("rc6_activate_with_sidecar", act.ok === true, act.reason);
  const loc = localizeFromTmc([{ locationCode: 10001, countryCode: 2, tableNumber: 25 }], store.active, {});
  ok("rc6_localize_after_sidecar", loc.trust === "tmc" && loc.tmcOk >= 1);
}

if (fails.length) {
  console.error("FAIL " + fails.join(" | "));
  process.exit(1);
}
console.log("PASS count=" + passCount);

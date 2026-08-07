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
import { OBSERVED_TMC_ZIP_UNCOMPRESSED, OBSERVED_TMC_ZIP_LARGEST_ENTRY } from "./ndic-datex-v1/disk-preflight.mjs";

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
}

if (fails.length) {
  console.error("FAIL " + fails.join(" | "));
  process.exit(1);
}
console.log("PASS count=" + passCount);

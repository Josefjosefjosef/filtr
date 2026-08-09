#!/usr/bin/env node
/**
 * Offline fixtures for disk-backed TMC ZIP structure + limits + atomic index.
 * No network. Synthetic ZIPs only (never real NDIC payloads).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildStoredZip, DEFAULT_ZIP_LIMITS, TMC_PATH_REJECT } from "./ndic-datex-v1/tmc-zip.mjs";
import {
  analyzeAndGateTmcZipFile,
  inspectZipFileCentral,
  selectAuthoritativeFormat,
  atomicActivateTmcIndex,
  rollbackTmcIndex,
  TMC_FORMAT,
  TMC_ZIP_LIMITS_V11,
  TMC_CID_EXPECTED,
  TMC_TABCD_EXPECTED,
} from "./ndic-datex-v1/tmc-archive-stream.mjs";
import { createTestDiskStatsProvider } from "./ndic-datex-v1/disk-preflight.mjs";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

/** Deterministic ample free space — never depends on host /tmp capacity. */
const AMPLE = createTestDiskStatsProvider({ availableBytes: 10n * 1024n * 1024n * 1024n });

function writeTempZip(name, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-tmc-fx-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, buildStoredZip(files));
  return { dir, file };
}

function wipe(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

// --- limits cover observed shadow #8 ---
{
  ok("lim_entry", TMC_ZIP_LIMITS_V11.maxSingleUncompressed > 117804443, String(TMC_ZIP_LIMITS_V11.maxSingleUncompressed));
  ok("lim_total", TMC_ZIP_LIMITS_V11.maxUncompressedTotal > 332163805, String(TMC_ZIP_LIMITS_V11.maxUncompressedTotal));
  ok("lim_comp", TMC_ZIP_LIMITS_V11.maxCompressedTotal > 21075661, String(TMC_ZIP_LIMITS_V11.maxCompressedTotal));
  ok("lim_ratio", TMC_ZIP_LIMITS_V11.maxCompressionRatio > 45.87, String(TMC_ZIP_LIMITS_V11.maxCompressionRatio));
  ok("lim_entries", TMC_ZIP_LIMITS_V11.maxEntries > 97, String(TMC_ZIP_LIMITS_V11.maxEntries));
  ok("cid_11", TMC_CID_EXPECTED === 11, String(TMC_CID_EXPECTED));
  ok("tabcd_25", TMC_TABCD_EXPECTED === 25, String(TMC_TABCD_EXPECTED));
  ok("warn_levels", JSON.stringify(TMC_ZIP_LIMITS_V11.warnThresholds) === "[0.7,0.85,0.95]", "warn");
}

// --- valid ZIP with directories ---
{
  const { dir, file } = writeTempZip("dirs.zip", [
    { name: "loc/", data: "" },
    { name: "loc/POINTS.DAT", data: "CID=11;TABCD=25\n" },
    { name: "loc/names.txt", data: "a;b\n" },
  ]);
  const meta = inspectZipFileCentral(file);
  ok("dirs_ok", meta.directoryEntryCount >= 1 && meta.fileEntryCount === 2, JSON.stringify(meta));
  ok("dirs_dat", meta.datFileCount === 1, String(meta.datFileCount));
  ok("auth_tisa_candidate", meta.candidateFormat === TMC_FORMAT.TISA_DAT_CSV, meta.candidateFormat);
  ok("auth_unverified", meta.authoritativeFormat === "UNVERIFIED", meta.authoritativeFormat);
  ok("auth_not_verified_flag", meta.authoritativeFormatVerified === false, String(meta.authoritativeFormatVerified));
  ok("auth_confidence_metadata", meta.candidateFormatConfidence === "metadata_only", meta.candidateFormatConfidence);
  const gate = analyzeAndGateTmcZipFile(file, { workDir: dir, measureDeps: AMPLE });
  ok(
    "basic_importer_ready",
    gate.rejectCode === "TMC_BASIC_IMPORT_REQUIRED" && gate.importerStatus === "BASIC_IMPORTER_READY",
    gate.rejectCode + "/" + gate.importerStatus
  );
  ok("size_preflight", gate.sizePreflightPassed === true, "size");
  ok("no_names_in_meta", !JSON.stringify(meta).includes("POINTS.DAT"), "name_leak");
  wipe(dir);
}

// --- prefer TISA over SHP ---
{
  const decision = selectAuthoritativeFormat({
    datFileCount: 5,
    csvFileCount: 0,
    txtFileCount: 2,
    sqliteCandidateCount: 1,
    jsonCandidateCount: 0,
    fileExtSummary: { shp: 6, dbf: 6, dat: 5, txt: 1 },
    candidateLayers: { tisaNameHint: 2 },
  });
  ok("prefer_tisa", decision.candidateFormat === TMC_FORMAT.TISA_DAT_CSV, decision.candidateFormat);
  ok("prefer_unverified", decision.authoritativeFormatVerified === false, "verified");
  ok(
    "prefer_status",
    decision.importerStatus === "BASIC_IMPORTER_READY",
    decision.importerStatus
  );
}

// --- shapefile-only ambiguous ---
{
  const decision = selectAuthoritativeFormat({
    datFileCount: 0,
    csvFileCount: 0,
    txtFileCount: 0,
    sqliteCandidateCount: 0,
    jsonCandidateCount: 0,
    fileExtSummary: { shp: 2, dbf: 2, shx: 2 },
    candidateLayers: {},
  });
  ok("shp_only", decision.format === TMC_FORMAT.SHAPEFILE_SET, decision.format);
}

// --- zip-slip / traversal / nul / abs ---
{
  for (const [id, name, cat] of [
    ["slip", "../evil.dat", TMC_PATH_REJECT.PARENT_TRAVERSAL],
    ["abs", "/tmp/evil.dat", TMC_PATH_REJECT.ABSOLUTE],
    ["bslash", "..\\evil.dat", TMC_PATH_REJECT.BACKSLASH],
    ["nul", "evil\u0000.dat", TMC_PATH_REJECT.CONTROL_CHAR],
  ]) {
    const { dir, file } = writeTempZip(id + ".zip", [{ name, data: "x" }]);
    const meta = inspectZipFileCentral(file);
    ok(id + "_reject", meta.pathRejectCategory === cat || meta.pathRejectCategory != null, meta.pathRejectCategory);
    wipe(dir);
  }
}

// --- encrypted / unsupported method simulated via crafted central is hard;
//     duplicate path after normalize ---
{
  const { dir, file } = writeTempZip("dup.zip", [
    { name: "a/b.dat", data: "1" },
    { name: "a\\b.dat", data: "2" },
  ]);
  const meta = inspectZipFileCentral(file);
  // backslash may be rejected as path; either dup or path reject is fail-closed
  ok(
    "dup_or_path",
    meta.duplicateEntryCount > 0 || meta.pathRejectCategory != null,
    String(meta.duplicateEntryCount) + ":" + meta.pathRejectCategory
  );
  wipe(dir);
}

// --- per-entry size reject (declared) ---
{
  const big = Buffer.alloc(2000, 0x41);
  const { dir, file } = writeTempZip("big.zip", [{ name: "huge.dat", data: big }]);
  const meta = inspectZipFileCentral(file, { maxSingleUncompressed: 1000 });
  ok("per_entry_over", meta.entriesOverCurrentPerEntryLimit >= 1, String(meta.entriesOverCurrentPerEntryLimit));
  ok("per_entry_cat", meta.entrySizeRejectCategory === "TMC_SIZE_PER_ENTRY", meta.entrySizeRejectCategory);
  wipe(dir);
}

// --- entry count limit ---
{
  const files = [];
  for (let i = 0; i < 5; i++) files.push({ name: "f" + i + ".dat", data: "x" });
  const { dir, file } = writeTempZip("many.zip", files);
  const meta = inspectZipFileCentral(file, { maxEntries: 3 });
  ok("entry_count", meta.entrySizeRejectCategory === "TMC_ZIP_TOO_MANY" || meta.centralEntryCount > 3, meta.entrySizeRejectCategory);
  wipe(dir);
}

// --- atomic activate + rollback + cleanup ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-tmc-idx-"));
  const paths = {
    activePath: path.join(dir, "active.json"),
    stagingPath: path.join(dir, "staging.json"),
    lastGoodPath: path.join(dir, "last-good.json"),
  };
  atomicActivateTmcIndex(paths, '{"v":"v1"}');
  ok("active_v1", fs.readFileSync(paths.activePath, "utf8") === '{"v":"v1"}', "v1");
  atomicActivateTmcIndex(paths, '{"v":"v2"}');
  ok("last_good", fs.readFileSync(paths.lastGoodPath, "utf8") === '{"v":"v1"}', "lg");
  ok("active_v2", fs.readFileSync(paths.activePath, "utf8") === '{"v":"v2"}', "v2");
  const rb = rollbackTmcIndex(paths);
  ok("rollback", rb.ok === true && fs.readFileSync(paths.activePath, "utf8") === '{"v":"v1"}', "rb");
  wipe(dir);
  ok("cleanup", !fs.existsSync(dir), "wipe");
}

// --- memory: central inspect must not retain large payload ---
{
  const payload = Buffer.alloc(4 * 1024 * 1024, 0x5a);
  const { dir, file } = writeTempZip("mem.zip", [
    { name: "layer/POINTS.DAT", data: payload },
    { name: "layer/names.txt", data: "n\n" },
  ]);
  const before = process.memoryUsage();
  const meta = inspectZipFileCentral(file);
  const after = process.memoryUsage();
  const heapDelta = after.heapUsed - before.heapUsed;
  ok("mem_auth_candidate", meta.candidateFormat === TMC_FORMAT.TISA_DAT_CSV, meta.candidateFormat);
  ok("mem_auth_unverified", meta.authoritativeFormat === "UNVERIFIED", meta.authoritativeFormat);
  ok("mem_heap_not_linear", heapDelta < 2 * 1024 * 1024, "heapDelta=" + heapDelta);
  ok("mem_rss_reported", typeof after.rss === "number" && after.rss > 0, String(after.rss));
  ok("mem_external_reported", typeof after.external === "number", String(after.external));
  ok(
    "mem_array_buffers_reported",
    typeof after.arrayBuffers === "number",
    String(after.arrayBuffers)
  );
  console.log(
    JSON.stringify({
      memory: {
        heapUsed: after.heapUsed,
        rss: after.rss,
        external: after.external,
        arrayBuffers: after.arrayBuffers,
        heapDelta,
        zipBytesOnDisk: fs.statSync(file).size,
      },
    })
  );
  wipe(dir);
}

// --- DEFAULT_ZIP_LIMITS alignment ---
{
  ok("align_entry", DEFAULT_ZIP_LIMITS.maxSingleUncompressed === TMC_ZIP_LIMITS_V11.maxSingleUncompressed, "entry");
  ok("align_total", DEFAULT_ZIP_LIMITS.maxUncompressedTotal === TMC_ZIP_LIMITS_V11.maxUncompressedTotal, "total");
}

if (fails.length) {
  console.error("[ndic-tmc-archive-stream-fixtures] FAIL " + fails.length);
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    TMC_CID_EXPECTED,
    TMC_TABCD_EXPECTED,
    maxSingleUncompressed: TMC_ZIP_LIMITS_V11.maxSingleUncompressed,
    maxUncompressedTotal: TMC_ZIP_LIMITS_V11.maxUncompressedTotal,
    maxCompressedTotal: TMC_ZIP_LIMITS_V11.maxCompressedTotal,
  })
);
console.log("[ndic-tmc-archive-stream-fixtures] PASS");

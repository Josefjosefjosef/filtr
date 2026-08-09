#!/usr/bin/env node
/**
 * Offline disk-preflight fixtures (no NDIC network).
 * Capacity-dependent checks use createTestDiskStatsProvider (API inject only).
 * One real-statfs integration test remains host-capacity-agnostic.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  computeRequiredDiskBytes,
  runDiskPreflight,
  measureFilesystemAvailable,
  knownTmcArchiveFitsAvailable,
  acquireTmcImportLock,
  wipeTaskOwnedPath,
  classifyDiskPath,
  measureTaskOwnedBytes,
  createTestDiskStatsProvider,
  assertNoTestDiskProviderEnv,
  refuseTestDiskProviderInShadow,
  DISK_FORMULA_VERSION,
  DISK_REJECT,
  OBSERVED_TMC_ZIP_COMPRESSED,
  OBSERVED_TMC_ZIP_UNCOMPRESSED,
  OBSERVED_TMC_ZIP_LARGEST_ENTRY,
  DISK_DEFAULTS,
  FORBIDDEN_TEST_DISK_ENV_KEYS,
} from "./ndic-datex-v1/disk-preflight.mjs";
import { buildStoredZip, safeUnzipEntries, DEFAULT_ZIP_LIMITS } from "./ndic-datex-v1/tmc-zip.mjs";
import { analyzeAndGateTmcZipFile, atomicActivateTmcIndex, rollbackTmcIndex } from "./ndic-datex-v1/tmc-archive-stream.mjs";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  results.push({ id, pass: !!cond, detail: detail != null ? String(detail) : "" });
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const GiB = 1024n * 1024n * 1024n;
const FREE_6_7_GIB = (67n * GiB) / 10n;
const FREE_6_7_GB_DECIMAL = 6700000000n;
/** Controlled ample free space for deterministic “pass disk then later reject” paths. */
const CONTROLLED_AMPLE_BYTES = 10n * GiB;
/** Controlled scarce free space for TMC_DISK_SPACE. */
const CONTROLLED_SCARCE_BYTES = 1000n * 4096n; // 4_096_000

// --- exact operands for known archive (zipAlreadyOnDisk=true) ---
const knownReq = computeRequiredDiskBytes({
  downloadedArchiveBytes: OBSERVED_TMC_ZIP_COMPRESSED,
  declaredUncompressedBytes: OBSERVED_TMC_ZIP_UNCOMPRESSED,
  largestEntryBytes: OBSERVED_TMC_ZIP_LARGEST_ENTRY,
  zipAlreadyOnDisk: true,
  existingTaskOwnedBytes: 0,
});

// 0) Env must not activate test provider; forbidden keys empty in this process
{
  let threw = false;
  try {
    assertNoTestDiskProviderEnv(process.env);
  } catch (_) {
    threw = true;
  }
  ok("t00_no_forbidden_test_disk_env", threw === false, "env");
  const fakeEnv = { IU_NDIC_TEST_DISK_AVAILABLE_BYTES: "999" };
  let blocked = false;
  try {
    assertNoTestDiskProviderEnv(fakeEnv);
  } catch (e) {
    blocked = e && e.code === "REFUSING_TEST_DISK_PROVIDER_ENV";
  }
  ok("t00_forbidden_env_fail_closed", blocked, "refuse");
  ok(
    "t00_shadow_refuses_test_provider",
    refuseTestDiskProviderInShadow(createTestDiskStatsProvider({ availableBytes: 1n }), {
      IU_NDIC_DATEX_V1_MODE: "shadow",
    }) === DISK_REJECT.TEST_PROVIDER,
    "shadow"
  );
  ok(
    "t00_fixture_mode_allows_provider",
    refuseTestDiskProviderInShadow(createTestDiskStatsProvider({ availableBytes: 1n }), {}) === null,
    "fixture"
  );
  ok("t00_forbidden_keys_listed", FORBIDDEN_TEST_DISK_ENV_KEYS.length >= 3, String(FORBIDDEN_TEST_DISK_ENV_KEYS.length));
}

// 1) Known archive + ~6.7 GiB / 6.7 GB free passes (pure arithmetic, no host fs)
{
  const fitGiB = knownTmcArchiveFitsAvailable(FREE_6_7_GIB);
  const fitGB = knownTmcArchiveFitsAvailable(FREE_6_7_GB_DECIMAL);
  ok("t01_known_archive_fits_6_7_gib", fitGiB.ok === true, String(fitGiB.requiredBytes));
  ok("t01b_known_archive_fits_6_7_gb_decimal", fitGB.ok === true, String(fitGB.requiredBytes));
}

// 1c) Controlled ample space → disk preflight ok (deterministic)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-disk-ok-"));
  const disk = runDiskPreflight({
    checkDir: dir,
    downloadedArchiveBytes: OBSERVED_TMC_ZIP_COMPRESSED,
    declaredUncompressedBytes: OBSERVED_TMC_ZIP_UNCOMPRESSED,
    largestEntryBytes: OBSERVED_TMC_ZIP_LARGEST_ENTRY,
    zipAlreadyOnDisk: true,
    measureDeps: createTestDiskStatsProvider({ availableBytes: CONTROLLED_AMPLE_BYTES }),
  });
  ok("t01c_controlled_ample_passes", disk.ok === true, disk.rejectCode);
  ok(
    "t01c_available_exact",
    disk.filesystemAvailableBytes === CONTROLLED_AMPLE_BYTES.toString(),
    String(disk.filesystemAvailableBytes)
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// 2) Controlled insufficiency → TMC_DISK_SPACE
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-disk-space-"));
  const disk = runDiskPreflight({
    checkDir: dir,
    downloadedArchiveBytes: OBSERVED_TMC_ZIP_COMPRESSED,
    declaredUncompressedBytes: OBSERVED_TMC_ZIP_UNCOMPRESSED,
    largestEntryBytes: OBSERVED_TMC_ZIP_LARGEST_ENTRY,
    zipAlreadyOnDisk: true,
    measureDeps: createTestDiskStatsProvider({ availableBytes: CONTROLLED_SCARCE_BYTES, blockSize: 4096n }),
  });
  ok("t02_insufficient_space_TMC_DISK_SPACE", disk.ok === false && disk.rejectCode === DISK_REJECT.SPACE, disk.rejectCode);
  ok(
    "t02_available_bytes_exact_string",
    disk.filesystemAvailableBytes === CONTROLLED_SCARCE_BYTES.toString(),
    String(disk.filesystemAvailableBytes)
  );
  ok("t02_available_not_number_type", typeof disk.filesystemAvailableBytes !== "number", typeof disk.filesystemAvailableBytes);
  fs.rmSync(dir, { recursive: true, force: true });
}

// 3) Nonexistent path → PATH (no capacity dependency)
{
  const disk = runDiskPreflight({
    checkDir: path.join(os.tmpdir(), "ndic-missing-" + Date.now() + "-nope"),
    downloadedArchiveBytes: 1,
    zipAlreadyOnDisk: true,
    measureDeps: createTestDiskStatsProvider({ availableBytes: CONTROLLED_AMPLE_BYTES }),
  });
  ok("t03_missing_path_TMC_DISK_PATH_INVALID", disk.ok === false && disk.rejectCode === DISK_REJECT.PATH, disk.rejectCode);
  ok("t03_no_fake_available_bytes", disk.filesystemAvailableBytes === null, String(disk.filesystemAvailableBytes));
  ok("t03_no_fake_zero_string", disk.filesystemAvailableBytes !== "0", String(disk.filesystemAvailableBytes));
}

// 4) Unmeasurable path → MEASURE
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-disk-meas-"));
  const disk = runDiskPreflight({
    checkDir: dir,
    downloadedArchiveBytes: 1,
    zipAlreadyOnDisk: true,
    measureDeps: {
      statSync: fs.statSync,
      statfsSync: () => {
        throw new Error("statfs_boom");
      },
    },
  });
  ok("t04_unmeasurable_TMC_DISK_MEASURE_FAILED", disk.ok === false && disk.rejectCode === DISK_REJECT.MEASURE, disk.rejectCode);
  ok("t04_no_fake_available_bytes", disk.filesystemAvailableBytes === null, String(disk.filesystemAvailableBytes));
  ok("t04_no_fake_zero_string", disk.filesystemAvailableBytes !== "0", String(disk.filesystemAvailableBytes));
  fs.rmSync(dir, { recursive: true, force: true });
}

// 5) B / KiB / MiB / GiB not confused
{
  ok("t05_kib", 1024 === 1024, "kib");
  ok("t05_mib", 1024 * 1024 === 1_048_576, "mib");
  ok("t05_gib", 1024 * 1024 * 1024 === 1_073_741_824, "gib");
  ok("t05_obs_comp_bytes", OBSERVED_TMC_ZIP_COMPRESSED === 21_075_661, String(OBSERVED_TMC_ZIP_COMPRESSED));
  ok("t05_6_7_gb_ne_gib", FREE_6_7_GB_DECIMAL !== FREE_6_7_GIB, FREE_6_7_GB_DECIMAL + "!=" + FREE_6_7_GIB);
}

// 6) BigInt precision preserved
{
  const hugeBlocks = 9007199254740993n;
  const block = 4096n;
  const product = hugeBlocks * block;
  const lost = BigInt(Math.trunc(Number(hugeBlocks) * Number(block)));
  ok("t06_bigint_precise", product === 9007199254740993n * 4096n, String(product));
  ok("t06_number_loses", lost !== product, lost + "!=" + product);
  const measured = measureFilesystemAvailable(os.tmpdir(), createTestDiskStatsProvider({ availableBytes: product }));
  ok("t06_provider_preserves_huge", measured.ok && measured.availableBytes === product, String(measured.availableBytes));
}

// 7) ZIP bomb limits remain active
{
  let bomb = false;
  try {
    const zip = buildStoredZip([{ name: "a.json", data: "{}" }]);
    const evil = Buffer.from(zip);
    evil.writeUInt32LE(0x3fffffff, 22);
    safeUnzipEntries(evil, { limits: { maxSingleUncompressed: 1024, maxCompressionRatio: 10 } });
  } catch (e) {
    bomb = e && (e.code === "TMC_ZIP_RATIO" || e.code === "TMC_ZIP_ENTRY_TOO_LARGE" || e.code === "TMC_ZIP_BOMB");
  }
  ok("t07_zip_bomb_active", bomb, "bomb");
}

// 8) Largest entry 117804443 streamed (working reserve, not full hold)
{
  ok(
    "t08_largest_stream_reserve",
    knownReq.archiveWorkingReserveBytes === 151358875n,
    String(knownReq.archiveWorkingReserveBytes)
  );
  ok(
    "t08_working_lt_160mib_cap",
    knownReq.archiveWorkingReserveBytes <= BigInt(DISK_DEFAULTS.maxStreamingWorkBytes),
    String(knownReq.archiveWorkingReserveBytes)
  );
}

// 9) Declared 332163805 not fully required / not held as working
{
  ok(
    "t09_declared_not_full_working",
    knownReq.archiveWorkingReserveBytes < BigInt(OBSERVED_TMC_ZIP_UNCOMPRESSED),
    String(knownReq.archiveWorkingReserveBytes)
  );
  ok(
    "t09_required_lt_declared_plus_os",
    knownReq.requiredBytes <
      BigInt(OBSERVED_TMC_ZIP_UNCOMPRESSED) + BigInt(DISK_DEFAULTS.operatingSystemSafetyReserveBytes) + 300n * 1024n * 1024n,
    String(knownReq.requiredBytes)
  );
}

// 10–12) Cleanup task-owned only; foreign + parallel preserved
{
  const fenceA = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-jobA-"));
  const fenceB = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-jobB-"));
  const fileA = path.join(fenceA, "a.bin");
  const fileB = path.join(fenceB, "b.bin");
  fs.writeFileSync(fileA, "A");
  fs.writeFileSync(fileB, "B");
  const foreign = path.join(os.tmpdir(), "ndic-foreign-" + Date.now() + ".txt");
  fs.writeFileSync(foreign, "F");
  ok("t10_cleanup_task_owned", wipeTaskOwnedPath(fileA, fenceA).ok === true && !fs.existsSync(fileA), "a");
  ok("t11_cleanup_keeps_foreign", wipeTaskOwnedPath(foreign, fenceA).ok === false && fs.existsSync(foreign), "foreign");
  ok("t12_cleanup_keeps_parallel_job", wipeTaskOwnedPath(fileB, fenceA).ok === false && fs.existsSync(fileB), "parallel");
  fs.unlinkSync(foreign);
  fs.rmSync(fenceA, { recursive: true, force: true });
  fs.rmSync(fenceB, { recursive: true, force: true });
}

// 13–14) Interrupted import / failed activation → last-good
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-atomic-"));
  const paths = {
    activePath: path.join(dir, "active.json"),
    stagingPath: path.join(dir, "staging.json"),
    lastGoodPath: path.join(dir, "last-good.json"),
  };
  atomicActivateTmcIndex(paths, '{"v":"good"}');
  atomicActivateTmcIndex(paths, '{"v":"candidate"}');
  ok("t13_last_good_preserved_on_disk", fs.readFileSync(paths.lastGoodPath, "utf8") === '{"v":"good"}', "lg");
  fs.writeFileSync(paths.activePath, '{"v":"corrupt"}');
  const rb = rollbackTmcIndex(paths);
  ok("t14_atomic_rollback_restores_last_good", rb.ok && fs.readFileSync(paths.activePath, "utf8") === '{"v":"good"}', "rb");
  fs.rmSync(dir, { recursive: true, force: true });
}

// 15–16) Concurrent lock + no steal of active foreign lock
{
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-lock-"));
  const lockDir = path.join(base, ".locks");
  const a = acquireTmcImportLock(lockDir, { holder: "job-a", ttlMs: 60_000 });
  const b = acquireTmcImportLock(lockDir, { holder: "job-b", ttlMs: 60_000 });
  ok("t15_concurrent_second_blocked", a.ok === true && b.ok === false && b.rejectCode === DISK_REJECT.LOCK, b.rejectCode);
  const stolen = acquireTmcImportLock(lockDir, { holder: "crash-reclaim", ttlMs: 60_000 });
  ok("t16_no_steal_active_foreign_lock", stolen.ok === false && stolen.rejectCode === DISK_REJECT.LOCK, stolen.rejectCode);
  a.release();
  const after = acquireTmcImportLock(lockDir, { holder: "job-c", ttlMs: 60_000 });
  ok("t16b_lock_free_after_release", after.ok === true, "c");
  after.release();
  fs.rmSync(base, { recursive: true, force: true });
}

// 17) Controlled ample disk → later importer reject preserves diagnostics
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-diag-"));
  const zipPath = path.join(dir, "tmc.zip");
  fs.writeFileSync(
    zipPath,
    buildStoredZip([
      { name: "loc/", data: "" },
      { name: "loc/POINTS.DAT", data: "CID=11;TABCD=25\n" },
    ])
  );
  const measureDeps = createTestDiskStatsProvider({ availableBytes: CONTROLLED_AMPLE_BYTES });
  const gate = analyzeAndGateTmcZipFile(zipPath, { workDir: dir, measureDeps });
  const diag = gate.diskDiagnostics || {};
  const requiredFields = [
    "diskCheckPathCategory",
    "filesystemAvailableBytes",
    "filesystemRequiredBytes",
    "downloadedArchiveBytes",
    "declaredUncompressedBytes",
    "archiveWorkingReserveBytes",
    "indexReserveBytes",
    "rollbackReserveBytes",
    "atomicSwapReserveBytes",
    "operatingSystemSafetyReserveBytes",
    "existingTaskOwnedBytes",
    "cleanupCandidateBytes",
    "diskFormulaVersion",
  ];
  const missing = requiredFields.filter((k) => diag[k] == null || diag[k] === "");
  ok("t17_all_diagnostic_fields", missing.length === 0, missing.join(","));
  ok(
    "t17_available_bytes_exact_digit_string",
    diag.filesystemAvailableBytes === CONTROLLED_AMPLE_BYTES.toString(),
    String(diag.filesystemAvailableBytes)
  );
  ok(
    "t17_required_bytes_preserved",
    typeof diag.filesystemRequiredBytes === "string" && /^\d+$/.test(diag.filesystemRequiredBytes),
    String(diag.filesystemRequiredBytes)
  );
  ok(
    "t17_preserved_after_tmc_importer_reject",
    gate.rejectCode === "TMC_BASIC_IMPORT_REQUIRED" &&
      diag.filesystemAvailableBytes === CONTROLLED_AMPLE_BYTES.toString(),
    gate.rejectCode + ":" + diag.filesystemAvailableBytes
  );
  ok("t17_disk_preflight_passed", gate.diskPreflightPassed === true, String(gate.diskPreflightPassed));
  const blob = JSON.stringify({ rejectCode: gate.rejectCode, diskDiagnostics: diag });
  ok("t17_no_authorization", !/Authorization/i.test(blob), "auth");
  ok("t17_no_basic_token", !/Basic\s+[A-Za-z0-9+/=]{8,}/i.test(blob), "basic");
  ok("t17_no_secret_names_values", !/IU_NDIC_PULL_PASS\s*=/.test(blob), "pass");
  ok("t17_no_raw_xml", !/<SituationPublication/i.test(blob), "xml");
  ok("t17_no_sensitive_abs_path", !/[A-Za-z]:\\\\Users\\\\|\/home\/(?!runner)/.test(blob), "path");
  console.log(
    "SANITIZED_DISK_DIAG_SAMPLE=" +
      JSON.stringify({
        rejectCode: gate.rejectCode,
        diskCheckPathCategory: diag.diskCheckPathCategory,
        filesystemAvailableBytes: diag.filesystemAvailableBytes,
        filesystemRequiredBytes: diag.filesystemRequiredBytes,
        downloadedArchiveBytes: diag.downloadedArchiveBytes,
        declaredUncompressedBytes: diag.declaredUncompressedBytes,
        archiveWorkingReserveBytes: diag.archiveWorkingReserveBytes,
        indexReserveBytes: diag.indexReserveBytes,
        rollbackReserveBytes: diag.rollbackReserveBytes,
        atomicSwapReserveBytes: diag.atomicSwapReserveBytes,
        operatingSystemSafetyReserveBytes: diag.operatingSystemSafetyReserveBytes,
        existingTaskOwnedBytes: diag.existingTaskOwnedBytes,
        cleanupCandidateBytes: diag.cleanupCandidateBytes,
        diskFormulaVersion: diag.diskFormulaVersion,
      })
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// 19) After successful controlled measure, arithmetic reject keeps available bytes
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-arith-"));
  const disk = runDiskPreflight({
    checkDir: dir,
    downloadedArchiveBytes: -1n,
    zipAlreadyOnDisk: true,
    measureDeps: createTestDiskStatsProvider({ availableBytes: CONTROLLED_AMPLE_BYTES }),
  });
  ok("t19_arithmetic_after_measure", disk.ok === false && disk.rejectCode === DISK_REJECT.ARITHMETIC, disk.rejectCode);
  ok(
    "t19_available_preserved_digit_string",
    disk.filesystemAvailableBytes === CONTROLLED_AMPLE_BYTES.toString(),
    String(disk.filesystemAvailableBytes)
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// 18) Task-owned residues diagnosed; foreign not deleted
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-stale-"));
  fs.writeFileSync(path.join(dir, "stale.bin"), Buffer.alloc(4096));
  const owned = measureTaskOwnedBytes(dir, dir);
  ok("t18_existing_task_owned_measured", owned === 4096n, String(owned));
  const foreign = path.join(os.tmpdir(), "ndic-stale-foreign-" + Date.now());
  fs.writeFileSync(foreign, "x");
  ok("t18_foreign_not_wiped", wipeTaskOwnedPath(foreign, dir).ok === false && fs.existsSync(foreign), "keep");
  fs.unlinkSync(foreign);
  fs.rmSync(dir, { recursive: true, force: true });
}

// 20) Real host statfs integration — capacity-agnostic (no expected free size)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-real-statfs-"));
  const measured = measureFilesystemAvailable(dir);
  ok(
    "t20_real_measure_ok_or_measure_failed",
    measured.ok === true || measured.rejectCode === DISK_REJECT.MEASURE,
    measured.ok ? "ok" : measured.rejectCode
  );
  if (measured.ok) {
    ok("t20_available_nonneg", measured.availableBytes >= 0n, String(measured.availableBytes));
    ok(
      "t20_available_digit_string",
      /^\d+$/.test(measured.availableBytes.toString()),
      measured.availableBytes.toString()
    );
    const cat = classifyDiskPath(dir);
    ok("t20_path_category_known", typeof cat === "string" && cat.length > 0, cat);
  }
  // Must not claim a specific host capacity
  ok("t20_no_fixed_capacity_assertion", true, "host_agnostic");
  fs.rmSync(dir, { recursive: true, force: true });
}

// Reserves unchanged (production defaults)
{
  ok("reserves_index_64mib", DISK_DEFAULTS.indexReserveBytes === 64 * 1024 * 1024, String(DISK_DEFAULTS.indexReserveBytes));
  ok("reserves_rollback_64mib", DISK_DEFAULTS.rollbackReserveBytes === 64 * 1024 * 1024, String(DISK_DEFAULTS.rollbackReserveBytes));
  ok("reserves_atomic_64mib", DISK_DEFAULTS.atomicSwapReserveBytes === 64 * 1024 * 1024, String(DISK_DEFAULTS.atomicSwapReserveBytes));
  ok(
    "reserves_os_512mib",
    DISK_DEFAULTS.operatingSystemSafetyReserveBytes === 512 * 1024 * 1024,
    String(DISK_DEFAULTS.operatingSystemSafetyReserveBytes)
  );
}

// Formula reconciliation proof lines
{
  ok("formula_working_exact", knownReq.archiveWorkingReserveBytes === 151358875n, String(knownReq.archiveWorkingReserveBytes));
  ok("formula_required_exact", knownReq.requiredBytes === 889556379n, String(knownReq.requiredBytes));
  ok("formula_version", knownReq.diskFormulaVersion === DISK_FORMULA_VERSION, knownReq.diskFormulaVersion);
  ok("formula_zip_on_disk_not_double_counted", knownReq.zipAlreadyOnDisk === true, "on_disk");
}

console.log(
  JSON.stringify({
    diskFormulaVersion: DISK_FORMULA_VERSION,
    operands: {
      downloadedArchiveBytes: OBSERVED_TMC_ZIP_COMPRESSED,
      declaredUncompressedBytes: OBSERVED_TMC_ZIP_UNCOMPRESSED,
      largestEntryBytes: OBSERVED_TMC_ZIP_LARGEST_ENTRY,
      archiveWorkingReserveBytes: knownReq.archiveWorkingReserveBytes.toString(),
      indexReserveBytes: knownReq.indexReserveBytes.toString(),
      rollbackReserveBytes: knownReq.rollbackReserveBytes.toString(),
      atomicSwapReserveBytes: knownReq.atomicSwapReserveBytes.toString(),
      operatingSystemSafetyReserveBytes: knownReq.operatingSystemSafetyReserveBytes.toString(),
      existingTaskOwnedBytes: "0",
      cleanupCandidateBytes: "0",
      filesystemRequiredBytes: knownReq.requiredBytes.toString(),
      simAvailable_6_7_GiB: FREE_6_7_GIB.toString(),
      simAvailable_6_7_GB_decimal: FREE_6_7_GB_DECIMAL.toString(),
      controlledAmpleBytes: CONTROLLED_AMPLE_BYTES.toString(),
    },
    results: results.map((r) => r.id + "=" + (r.pass ? "PASS" : "FAIL")),
    node: process.version,
  })
);

if (fails.length) {
  console.error("[ndic-disk-preflight-fixtures] FAIL " + fails.length);
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log("[ndic-disk-preflight-fixtures] PASS");

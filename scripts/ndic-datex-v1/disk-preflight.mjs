/**
 * Fail-closed TMC / NDIC disk preflight (integer bytes, task-owned paths only).
 *
 * ROOT CAUSE (shadow #9): downloads used os.tmpdir() (/tmp tmpfs on VPS) while
 * workspace df showed ~6.7 GiB free. Flat minFreeDiskBytes=2GiB then failed on tmpfs.
 *
 * Formula version tmc-disk-v2:
 *   required = workingReserve + indexReserve + rollbackReserve
 *            + atomicSwapReserve + osSafetyReserve
 *   After ZIP is already on disk, do NOT re-require downloadedArchiveBytes.
 *   Working reserve is capped for streaming (never require full declared uncompressed).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const DISK_FORMULA_VERSION = "tmc-disk-v2";

/** Observed shadow #8/#9 compressed archive size (bytes). */
export const OBSERVED_TMC_ZIP_COMPRESSED = 21_075_661;
/** Observed declared total uncompressed (bytes). */
export const OBSERVED_TMC_ZIP_UNCOMPRESSED = 332_163_805;
/** Observed largest entry (bytes). */
export const OBSERVED_TMC_ZIP_LARGEST_ENTRY = 117_804_443;

export const DISK_DEFAULTS = Object.freeze({
  /** Max simultaneous stream buffer / partial extract (largest entry + margin). */
  maxStreamingWorkBytes: 160 * 1024 * 1024,
  /** Cap on working reserve even if declared uncompressed is huge. */
  maxWorkingReserveBytes: 200 * 1024 * 1024,
  indexReserveBytes: 64 * 1024 * 1024,
  rollbackReserveBytes: 64 * 1024 * 1024,
  atomicSwapReserveBytes: 64 * 1024 * 1024,
  operatingSystemSafetyReserveBytes: 512 * 1024 * 1024,
  /** Absolute floor so tiny fixtures still get a meaningful check in tests. */
  minRequiredBytes: 16 * 1024 * 1024,
});

export const DISK_REJECT = Object.freeze({
  SPACE: "TMC_DISK_SPACE",
  MEASURE: "TMC_DISK_MEASURE_FAILED",
  PATH: "TMC_DISK_PATH_INVALID",
  ARITHMETIC: "TMC_DISK_ARITHMETIC",
  ZIP_LIMIT: "TMC_DISK_ZIP_LIMIT",
  STALE_TASK: "TMC_DISK_STALE_TASK_OWNED",
  LOCK: "TMC_DISK_LOCK_HELD",
  TEST_PROVIDER: "REFUSING_TEST_DISK_PROVIDER_IN_SHADOW",
});

/**
 * Env keys that must NEVER select a fake disk provider.
 * Production/shadow measure path never reads these; if set, entrypoints fail closed.
 */
export const FORBIDDEN_TEST_DISK_ENV_KEYS = Object.freeze([
  "IU_NDIC_TEST_DISK_AVAILABLE_BYTES",
  "IU_NDIC_DISK_STATS_PROVIDER",
  "IU_NDIC_FAKE_DISK_FREE",
  "IU_NDIC_TEST_STATFS",
]);

/**
 * Fail closed if a forbidden test-disk env key is present.
 * Does not invent free space; blocks accidental/malicious activation.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertNoTestDiskProviderEnv(env = process.env) {
  for (const k of FORBIDDEN_TEST_DISK_ENV_KEYS) {
    const v = env[k];
    if (v != null && String(v).trim() !== "") {
      throw Object.assign(new Error("REFUSING_TEST_DISK_PROVIDER_ENV"), {
        code: "REFUSING_TEST_DISK_PROVIDER_ENV",
        keyName: k,
      });
    }
  }
}

/**
 * TEST-ONLY: build measureDeps returning an exact BigInt availableBytes string path.
 * Must be passed via direct API (`opts.measureDeps`) from offline fixtures only.
 * Never selected from workflow inputs, env, or production config.
 *
 * @param {{ availableBytes: bigint|number|string, blockSize?: bigint|number, statSync?: typeof fs.statSync }} opts
 * @returns {{ __ndicTestDiskStatsProvider: true, statSync: Function, statfsSync: Function }}
 */
export function createTestDiskStatsProvider(opts) {
  if (!opts || opts.availableBytes == null) {
    throw new Error("test_disk_available_required");
  }
  const availableBytes =
    typeof opts.availableBytes === "bigint" ? opts.availableBytes : BigInt(String(opts.availableBytes));
  if (availableBytes < 0n) throw new Error("test_disk_negative");
  // blockSize=1 → bavail*blockSize equals availableBytes exactly (no precision loss).
  const blockSize =
    opts.blockSize != null
      ? typeof opts.blockSize === "bigint"
        ? opts.blockSize
        : BigInt(String(opts.blockSize))
      : 1n;
  if (blockSize <= 0n) throw new Error("test_disk_block");
  if (availableBytes % blockSize !== 0n) throw new Error("test_disk_not_divisible");
  const bavail = availableBytes / blockSize;
  return {
    __ndicTestDiskStatsProvider: true,
    statSync: opts.statSync || fs.statSync,
    statfsSync: () => ({ bavail, bsize: blockSize, frsize: blockSize }),
  };
}

/**
 * Refuse test disk provider while NDIC mode is shadow/active (production path).
 * Offline fixtures run without IU_NDIC_DATEX_V1_MODE=shadow/active.
 * @param {object} measureDeps
 * @param {NodeJS.ProcessEnv} [env]
 */
export function refuseTestDiskProviderInShadow(measureDeps, env = process.env) {
  if (!measureDeps || measureDeps.__ndicTestDiskStatsProvider !== true) return null;
  const mode = String(env.IU_NDIC_DATEX_V1_MODE || "")
    .trim()
    .toLowerCase();
  if (mode === "shadow" || mode === "active") {
    return DISK_REJECT.TEST_PROVIDER;
  }
  return null;
}

/**
 * @param {string} absPath
 * @returns {"runner_temp"|"workspace"|"task_temp"|"os_tmpdir"|"other"}
 */
export function classifyDiskPath(absPath) {
  const p = String(absPath || "").replace(/\\/g, "/").toLowerCase();
  const runnerTemp = String(process.env.RUNNER_TEMP || "").replace(/\\/g, "/").toLowerCase();
  const shadow = String(process.env.IU_NDIC_SHADOW_WORK_DIR || "").replace(/\\/g, "/").toLowerCase();
  const ws = String(process.env.GITHUB_WORKSPACE || "").replace(/\\/g, "/").toLowerCase();
  const tmp = String(os.tmpdir() || "").replace(/\\/g, "/").toLowerCase();
  if (runnerTemp && (p === runnerTemp || p.startsWith(runnerTemp + "/"))) return "runner_temp";
  if (shadow && (p === shadow || p.startsWith(shadow + "/"))) return "task_temp";
  if (ws && (p === ws || p.startsWith(ws + "/"))) return "workspace";
  if (tmp && (p === tmp || p.startsWith(tmp + "/"))) return "os_tmpdir";
  if (p === "/tmp" || p.startsWith("/tmp/")) return "os_tmpdir";
  return "other";
}

/**
 * Measure free bytes on the filesystem owning `dir` (must exist).
 * Uses frsize when present (POSIX block unit); falls back to bsize.
 * Production default: real fs.statfsSync. Never reads FORBIDDEN_TEST_DISK_ENV_KEYS.
 * @param {string} dir
 * @param {{ statSync?: typeof fs.statSync, statfsSync?: typeof fs.statfsSync, __ndicTestDiskStatsProvider?: boolean }} [deps] test inject only
 * @returns {{ ok: true, availableBytes: bigint, bavail: bigint, blockSize: bigint } | { ok: false, rejectCode: string, detail?: string }}
 */
export function measureFilesystemAvailable(dir, deps = {}) {
  const refused = refuseTestDiskProviderInShadow(deps);
  if (refused) {
    return { ok: false, rejectCode: refused, detail: "test_provider_blocked" };
  }
  const statSync = deps.statSync || fs.statSync;
  const statfsSync = deps.statfsSync || fs.statfsSync;
  if (!dir || typeof dir !== "string") {
    return { ok: false, rejectCode: DISK_REJECT.PATH, detail: "empty_path" };
  }
  let st;
  try {
    st = statSync(dir);
  } catch (_) {
    return { ok: false, rejectCode: DISK_REJECT.PATH, detail: "stat_failed" };
  }
  if (!st.isDirectory()) {
    return { ok: false, rejectCode: DISK_REJECT.PATH, detail: "not_directory" };
  }
  if (typeof statfsSync !== "function") {
    return { ok: false, rejectCode: DISK_REJECT.MEASURE, detail: "statfs_unavailable" };
  }
  try {
    const s = statfsSync(dir, { bigint: true });
    const bavail = BigInt(s.bavail);
    const fr = s.frsize != null ? BigInt(s.frsize) : null;
    const bs = BigInt(s.bsize);
    const blockSize = fr != null && fr > 0n ? fr : bs;
    if (blockSize <= 0n) {
      return { ok: false, rejectCode: DISK_REJECT.ARITHMETIC, detail: "block_size" };
    }
    if (bavail < 0n) {
      return { ok: false, rejectCode: DISK_REJECT.ARITHMETIC, detail: "bavail_negative" };
    }
    const availableBytes = bavail * blockSize;
    return { ok: true, availableBytes, bavail, blockSize };
  } catch (_) {
    return { ok: false, rejectCode: DISK_REJECT.MEASURE, detail: "statfs_throw" };
  }
}

/**
 * @param {{
 *   downloadedArchiveBytes?: number|bigint,
 *   declaredUncompressedBytes?: number|bigint,
 *   largestEntryBytes?: number|bigint,
 *   zipAlreadyOnDisk?: boolean,
 *   existingTaskOwnedBytes?: number|bigint,
 *   defaults?: Partial<typeof DISK_DEFAULTS>,
 * }} input
 */
export function computeRequiredDiskBytes(input = {}) {
  const d = { ...DISK_DEFAULTS, ...(input.defaults || {}) };
  try {
    const downloaded = toBigIntNonNeg(input.downloadedArchiveBytes || 0);
    const declared = toBigIntNonNeg(input.declaredUncompressedBytes || 0);
    const largest = toBigIntNonNeg(input.largestEntryBytes || 0);
    const existing = toBigIntNonNeg(input.existingTaskOwnedBytes || 0);

    const streamCap = BigInt(d.maxStreamingWorkBytes);
    const workCap = BigInt(d.maxWorkingReserveBytes);
    // Prefer largest-entry stream buffer; never demand full declared uncompressed.
    let working = largest > 0n ? largest + 32n * 1024n * 1024n : streamCap;
    if (working > streamCap) working = streamCap;
    if (declared > 0n && working > declared) working = declared;
    if (working > workCap) working = workCap;

    const indexR = BigInt(d.indexReserveBytes);
    const rollbackR = BigInt(d.rollbackReserveBytes);
    const atomicR = BigInt(d.atomicSwapReserveBytes);
    const osR = BigInt(d.operatingSystemSafetyReserveBytes);

    let required = working + indexR + rollbackR + atomicR + osR;
    // ZIP not yet on target FS: include download size once.
    if (input.zipAlreadyOnDisk !== true) {
      required += downloaded;
    }
    // Stale task-owned bytes reduce effective free; caller may add to required
    // or subtract from available — we surface them and add as reclaimable note.
    const minReq = BigInt(d.minRequiredBytes);
    if (required < minReq) required = minReq;

    return {
      ok: true,
      requiredBytes: required,
      archiveWorkingReserveBytes: working,
      indexReserveBytes: indexR,
      rollbackReserveBytes: rollbackR,
      atomicSwapReserveBytes: atomicR,
      operatingSystemSafetyReserveBytes: osR,
      downloadedArchiveBytes: downloaded,
      declaredUncompressedBytes: declared,
      existingTaskOwnedBytes: existing,
      zipAlreadyOnDisk: input.zipAlreadyOnDisk === true,
      diskFormulaVersion: DISK_FORMULA_VERSION,
    };
  } catch (_) {
    return { ok: false, rejectCode: DISK_REJECT.ARITHMETIC };
  }
}

function toBigIntNonNeg(v) {
  const n = typeof v === "bigint" ? v : BigInt(Math.max(0, Number(v) || 0));
  if (n < 0n) throw new Error("neg");
  return n;
}

/**
 * Ensure task-owned directory exists (mode 0700) under an approved base.
 * Never uses bare os.tmpdir() as the NDIC work root.
 * @param {{ baseDir?: string, runId?: string }} [opts]
 */
export function ensureTaskOwnedWorkDir(opts = {}) {
  const base =
    opts.baseDir ||
    process.env.IU_NDIC_SHADOW_WORK_DIR ||
    process.env.RUNNER_TEMP ||
    path.join(process.cwd(), ".cache", "ndic-task");
  const runId = opts.runId || "ndic-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const dir = path.join(base, runId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch (_) {}
  return { baseDir: path.resolve(base), workDir: path.resolve(dir), runId };
}

/**
 * Create a bounded download target inside task-owned dir (not os.tmpdir()).
 * @param {string} workDir
 * @param {string} [prefix]
 */
export function createTaskOwnedTempFile(workDir, prefix = "ndic-body-") {
  const dir = fs.mkdtempSync(path.join(workDir, prefix));
  try {
    fs.chmodSync(dir, 0o700);
  } catch (_) {}
  return { dir, file: path.join(dir, "body.bin") };
}

/**
 * Sum sizes of files under task-owned dir (best-effort, no follow symlink escape).
 * @param {string} dir
 * @param {string} [mustBeUnder]
 */
export function measureTaskOwnedBytes(dir, mustBeUnder) {
  const root = path.resolve(dir);
  const fence = mustBeUnder ? path.resolve(mustBeUnder) : root;
  if (!root.startsWith(fence)) return 0n;
  let total = 0n;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(cur, ent.name);
      const resolved = path.resolve(p);
      if (!resolved.startsWith(fence)) continue;
      try {
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) stack.push(resolved);
        else if (ent.isFile()) total += BigInt(fs.statSync(resolved).size);
      } catch (_) {}
    }
  }
  return total;
}

/**
 * Full preflight for TMC after ZIP is on disk (or before with zipAlreadyOnDisk=false).
 * @param {{
 *   checkDir: string,
 *   downloadedArchiveBytes?: number,
 *   declaredUncompressedBytes?: number,
 *   largestEntryBytes?: number,
 *   zipAlreadyOnDisk?: boolean,
 *   existingTaskOwnedBytes?: number|bigint,
 *   cleanupCandidateBytes?: number|bigint,
 *   zipLimitExceeded?: boolean,
 *   measureDeps?: object,
 * }} opts
 */
export function runDiskPreflight(opts) {
  const pathCategory = classifyDiskPath(opts.checkDir);
  const measureDeps = opts.measureDeps || {};
  const measured = measureFilesystemAvailable(opts.checkDir, measureDeps);
  if (!measured.ok) {
    return {
      ok: false,
      rejectCode: measured.rejectCode,
      diskCheckPathCategory: pathCategory,
      diskFormulaVersion: DISK_FORMULA_VERSION,
      filesystemAvailableBytes: null,
      filesystemRequiredBytes: null,
      measureDetail: measured.detail || null,
    };
  }
  if (opts.zipLimitExceeded === true) {
    return {
      ok: false,
      rejectCode: DISK_REJECT.ZIP_LIMIT,
      diskCheckPathCategory: pathCategory,
      diskFormulaVersion: DISK_FORMULA_VERSION,
      filesystemAvailableBytes: measured.availableBytes.toString(),
    };
  }

  const req = computeRequiredDiskBytes({
    downloadedArchiveBytes: opts.downloadedArchiveBytes,
    declaredUncompressedBytes: opts.declaredUncompressedBytes,
    largestEntryBytes: opts.largestEntryBytes,
    zipAlreadyOnDisk: opts.zipAlreadyOnDisk,
    existingTaskOwnedBytes: opts.existingTaskOwnedBytes,
  });
  if (!req.ok) {
    return {
      ok: false,
      rejectCode: req.rejectCode || DISK_REJECT.ARITHMETIC,
      diskCheckPathCategory: pathCategory,
      diskFormulaVersion: DISK_FORMULA_VERSION,
      // Disk was measured successfully — never invent 0; preserve exact byte string.
      filesystemAvailableBytes: measured.availableBytes.toString(),
      filesystemRequiredBytes: null,
    };
  }

  const available = measured.availableBytes;
  const required = req.requiredBytes;
  const cleanupCandidate = toBigIntNonNeg(opts.cleanupCandidateBytes || 0);
  // Effective available after optional cleanup of our own stale bytes (not performed here).
  const effectiveAvailable = available + cleanupCandidate;

  const pass = effectiveAvailable >= required;
  const diag = {
    ok: pass,
    rejectCode: pass ? null : DISK_REJECT.SPACE,
    diskCheckPathCategory: pathCategory,
    filesystemAvailableBytes: available.toString(),
    filesystemRequiredBytes: required.toString(),
    downloadedArchiveBytes: req.downloadedArchiveBytes.toString(),
    declaredUncompressedBytes: req.declaredUncompressedBytes.toString(),
    archiveWorkingReserveBytes: req.archiveWorkingReserveBytes.toString(),
    indexReserveBytes: req.indexReserveBytes.toString(),
    rollbackReserveBytes: req.rollbackReserveBytes.toString(),
    atomicSwapReserveBytes: req.atomicSwapReserveBytes.toString(),
    operatingSystemSafetyReserveBytes: req.operatingSystemSafetyReserveBytes.toString(),
    existingTaskOwnedBytes: req.existingTaskOwnedBytes.toString(),
    cleanupCandidateBytes: cleanupCandidate.toString(),
    diskFormulaVersion: DISK_FORMULA_VERSION,
    blockSize: measured.blockSize.toString(),
  };
  return diag;
}

/**
 * Exclusive lock for TMC import under task base (stale lock reclaim after ttlMs).
 * @param {string} lockDir
 * @param {{ ttlMs?: number, holder?: string }} [opts]
 */
export function acquireTmcImportLock(lockDir, opts = {}) {
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : 30 * 60 * 1000;
  const holder = opts.holder || "ndic-" + process.pid;
  fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(lockDir, "tmc-import.lock");
  const now = Date.now();
  try {
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, "utf8");
      const parsed = JSON.parse(raw);
      const age = now - Number(parsed.at || 0);
      if (age >= 0 && age < ttlMs) {
        return { ok: false, rejectCode: DISK_REJECT.LOCK, lockPath };
      }
      // stale — reclaim
    }
  } catch (_) {}
  const payload = JSON.stringify({ holder, at: now, pid: process.pid });
  const tmp = lockPath + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, payload, { mode: 0o600 });
  try {
    fs.renameSync(tmp, lockPath);
  } catch (_) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
    return { ok: false, rejectCode: DISK_REJECT.LOCK, lockPath };
  }
  return {
    ok: true,
    lockPath,
    release() {
      try {
        const cur = fs.readFileSync(lockPath, "utf8");
        if (cur.includes(holder)) fs.unlinkSync(lockPath);
      } catch (_) {}
    },
  };
}

/**
 * Wipe only paths under fence (task-owned). Never deletes fence root parents.
 * @param {string} target
 * @param {string} fenceDir
 */
export function wipeTaskOwnedPath(target, fenceDir) {
  const t = path.resolve(target);
  const f = path.resolve(fenceDir);
  if (!t.startsWith(f + path.sep) && t !== f) {
    return { ok: false, reason: "outside_fence" };
  }
  if (t === path.resolve("/") || t === path.resolve(os.homedir()) || t === f) {
    // Allow wiping run subdir equal to fence only if fence itself is a run dir — still OK for run dirs
    if (t === path.resolve("/") || t === path.resolve(os.homedir())) {
      return { ok: false, reason: "forbidden_root" };
    }
  }
  try {
    fs.rmSync(t, { recursive: true, force: true });
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: "rm_failed" };
  }
}

/** Convenience: known real archive should fit ~6.7 GiB free on disk FS. */
export function knownTmcArchiveFitsAvailable(availableBytes) {
  const req = computeRequiredDiskBytes({
    downloadedArchiveBytes: OBSERVED_TMC_ZIP_COMPRESSED,
    declaredUncompressedBytes: OBSERVED_TMC_ZIP_UNCOMPRESSED,
    largestEntryBytes: OBSERVED_TMC_ZIP_LARGEST_ENTRY,
    zipAlreadyOnDisk: true,
  });
  if (!req.ok) return { ok: false };
  const avail = typeof availableBytes === "bigint" ? availableBytes : BigInt(availableBytes);
  return {
    ok: avail >= req.requiredBytes,
    requiredBytes: req.requiredBytes,
    availableBytes: avail,
  };
}

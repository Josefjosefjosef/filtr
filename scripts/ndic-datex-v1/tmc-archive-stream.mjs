/**
 * Disk-backed TMC ZIP structure analysis + streamed import scaffold.
 * Never loads full ZIP or full 117MiB entries into a single Buffer for parsing.
 * Authoritative TISA/EN ISO 14819-3 import is fail-closed until format is confirmed.
 */
import fs from "node:fs";
import path from "node:path";
import { TMC_CID, TMC_LOCATION_TABLE_NUMBER } from "./config.mjs";
import { TMC_PATH_REJECT, classifyZipPath, DEFAULT_ZIP_LIMITS } from "./tmc-zip.mjs";
import {
  runDiskPreflight,
  acquireTmcImportLock,
  measureTaskOwnedBytes,
  DISK_FORMULA_VERSION,
  DISK_REJECT,
} from "./disk-preflight.mjs";

/** Observed shadow #8 (~21.1 MiB / 332 MiB / 117.8 MiB / ratio 45.87 / 97 entries). */
export const TMC_ZIP_LIMITS_V11 = Object.freeze({
  maxCompressedTotal: DEFAULT_ZIP_LIMITS.maxCompressedTotal,
  maxUncompressedTotal: DEFAULT_ZIP_LIMITS.maxUncompressedTotal,
  maxSingleUncompressed: DEFAULT_ZIP_LIMITS.maxSingleUncompressed,
  maxCompressionRatio: DEFAULT_ZIP_LIMITS.maxCompressionRatio,
  maxEntries: DEFAULT_ZIP_LIMITS.maxEntries,
  maxNameLen: DEFAULT_ZIP_LIMITS.maxNameLen,
  maxPathDepth: DEFAULT_ZIP_LIMITS.maxPathDepth,
  maxImportMs: DEFAULT_ZIP_LIMITS.maxImportMs,
  maxWorkDirBytes: DEFAULT_ZIP_LIMITS.maxWorkDirBytes,
  minFreeDiskBytes: DEFAULT_ZIP_LIMITS.minFreeDiskBytes,
  // Legacy flat floor kept for docs; preflight now uses tmc-disk-v2 requiredBytes.
  legacyFlatMinFreeDiskBytes: 2 * 1024 * 1024 * 1024,
  warnThresholds: DEFAULT_ZIP_LIMITS.warnThresholds,
  prevMaxSingleUncompressed: 64 * 1024 * 1024,
  prevMaxUncompressedTotal: 96 * 1024 * 1024,
  prevMaxCompressedTotal: 40 * 1024 * 1024,
});

export const TMC_CID_EXPECTED = TMC_CID;
export const TMC_TABCD_EXPECTED = TMC_LOCATION_TABLE_NUMBER;

export const TMC_FORMAT = Object.freeze({
  TISA_DAT_CSV: "TISA_DAT_CSV",
  SHAPEFILE_SET: "SHAPEFILE_SET",
  SQLITE_DB: "SQLITE_DB",
  JSON_TABLE: "JSON_TABLE",
  MIXED_UNKNOWN: "MIXED_UNKNOWN",
  UNRESOLVED: "UNRESOLVED",
});

const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "none";
}

function warnHits(used, max, thresholds) {
  const ratio = max > 0 ? used / max : 1;
  return thresholds.filter((t) => ratio >= t && ratio < 1).map((t) => Math.round(t * 100));
}

/**
 * Read EOCD + central directory from a ZIP file without loading the whole archive.
 * @param {string} filePath
 * @param {Partial<typeof TMC_ZIP_LIMITS_V11>} [limits]
 */
export function inspectZipFileCentral(filePath, limits = {}) {
  const lim = { ...TMC_ZIP_LIMITS_V11, ...limits };
  const st = fs.statSync(filePath);
  const meta = {
    archiveValidationStage: "central_directory",
    compressedSizeOnDisk: st.size,
    centralEntryCount: 0,
    directoryEntryCount: 0,
    fileEntryCount: 0,
    declaredCompressedTotalBytes: 0,
    declaredUncompressedTotalBytes: 0,
    maxDeclaredCompressedEntryBytes: 0,
    maxDeclaredUncompressedEntryBytes: 0,
    maxObservedCompressionRatio: 0,
    entriesOverCurrentPerEntryLimit: 0,
    totalOverCurrentUncompressedLimit: false,
    encryptedEntryCount: 0,
    zip64EntryCount: 0,
    unsupportedEntryTypeCount: 0,
    duplicateEntryCount: 0,
    pathRejectCategory: null,
    pathRejectCounts: Object.create(null),
    entrySizeRejectCategory: null,
    fileExtSummary: Object.create(null),
    candidateLayers: Object.create(null),
    shapefileSets: 0,
    datFileCount: 0,
    txtFileCount: 0,
    csvFileCount: 0,
    sqliteCandidateCount: 0,
    jsonCandidateCount: 0,
    limitsApplied: {
      maxCompressedTotal: lim.maxCompressedTotal,
      maxUncompressedTotal: lim.maxUncompressedTotal,
      maxSingleUncompressed: lim.maxSingleUncompressed,
      maxCompressionRatio: lim.maxCompressionRatio,
      maxEntries: lim.maxEntries,
      prevMaxSingleUncompressed: lim.prevMaxSingleUncompressed,
      prevMaxUncompressedTotal: lim.prevMaxUncompressedTotal,
      prevMaxCompressedTotal: lim.prevMaxCompressedTotal,
    },
    utilization: {
      compressedWarnPct: warnHits(st.size, lim.maxCompressedTotal, lim.warnThresholds),
      uncompressedWarnPct: [],
      perEntryWarnPct: [],
    },
    authoritativeFormat: "UNVERIFIED",
    authoritativeFormatVerified: false,
    candidateFormat: TMC_FORMAT.UNRESOLVED,
    candidateFormatConfidence: "metadata_only",
    candidateEvidenceSource: "central_directory",
    authoritativeReason: null,
    cidDetected: null,
    tabcdDetected: null,
    versionHint: null,
  };

  if (st.size > lim.maxCompressedTotal) {
    meta.entrySizeRejectCategory = "TMC_SIZE_COMPRESSED_TOTAL";
    meta.archiveValidationStage = "compressed_total_exceeded";
    return meta;
  }

  const fd = fs.openSync(filePath, "r");
  try {
    const tailLen = Math.min(st.size, 65536 + 22);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, st.size - tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) {
      meta.archiveValidationStage = "eocd_missing";
      meta.entrySizeRejectCategory = "TMC_ZIP_EOCD";
      return meta;
    }
    const totalEntries = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      meta.zip64EntryCount += 1;
      meta.archiveValidationStage = "zip64_eocd";
      // Fail-closed for ZIP64 until explicitly supported
      meta.entrySizeRejectCategory = "TMC_ZIP64_UNSUPPORTED";
      return meta;
    }
    if (totalEntries > lim.maxEntries) {
      meta.entrySizeRejectCategory = "TMC_ZIP_TOO_MANY";
      meta.archiveValidationStage = "entry_count_exceeded";
      return meta;
    }
    if (cdOffset + cdSize > st.size) {
      meta.archiveValidationStage = "central_truncated";
      return meta;
    }
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);

    const seen = new Set();
    const seenFold = new Set();
    const shpBases = new Set();
    let off = 0;
    while (off + 46 <= cd.length) {
      if (cd.readUInt32LE(off) !== CENTRAL_SIG) {
        off += 1;
        continue;
      }
      meta.centralEntryCount += 1;
      const flags = cd.readUInt16LE(off + 8);
      const method = cd.readUInt16LE(off + 10);
      const comp = cd.readUInt32LE(off + 20);
      const uncomp = cd.readUInt32LE(off + 24);
      const nameLen = cd.readUInt16LE(off + 28);
      const extraLen = cd.readUInt16LE(off + 30);
      const commentLen = cd.readUInt16LE(off + 32);
      const externalAttrs = cd.readUInt32LE(off + 38);
      if (flags & 0x1) meta.encryptedEntryCount += 1;
      if (comp === 0xffffffff || uncomp === 0xffffffff) meta.zip64EntryCount += 1;
      if (method !== 0 && method !== 8) meta.unsupportedEntryTypeCount += 1;
      const mode = (externalAttrs >>> 16) & 0xffff;
      if ((mode & 0xf000) === 0xa000 || (mode & 0xf000) === 0x1000 || (mode & 0xf000) === 0x2000 || (mode & 0xf000) === 0x6000) {
        meta.unsupportedEntryTypeCount += 1;
      }
      let nameRaw = "";
      try {
        nameRaw = cd.slice(off + 46, off + 46 + nameLen).toString("utf8");
      } catch (_) {
        meta.pathRejectCategory = TMC_PATH_REJECT.UNSUPPORTED_ENCODING;
        break;
      }
      const classified = classifyZipPath(nameRaw, {
        maxDepth: lim.maxPathDepth,
        maxNameLen: lim.maxNameLen,
      });
      nameRaw = "";
      if (!classified.ok) {
        meta.pathRejectCategory = classified.category || TMC_PATH_REJECT.OTHER;
        meta.pathRejectCounts[meta.pathRejectCategory] =
          (meta.pathRejectCounts[meta.pathRejectCategory] || 0) + 1;
        meta.archiveValidationStage = "path_reject";
        break;
      }
      if (classified.isDirectory) {
        meta.directoryEntryCount += 1;
      } else {
        meta.fileEntryCount += 1;
        meta.declaredCompressedTotalBytes += comp;
        meta.declaredUncompressedTotalBytes += uncomp;
        if (comp > meta.maxDeclaredCompressedEntryBytes) meta.maxDeclaredCompressedEntryBytes = comp;
        if (uncomp > meta.maxDeclaredUncompressedEntryBytes) meta.maxDeclaredUncompressedEntryBytes = uncomp;
        if (comp > 0) {
          const ratio = uncomp / comp;
          if (ratio > meta.maxObservedCompressionRatio) {
            meta.maxObservedCompressionRatio = Math.round(ratio * 100) / 100;
          }
        }
        if (uncomp > lim.maxSingleUncompressed) meta.entriesOverCurrentPerEntryLimit += 1;
        const p = classified.path;
        if (seen.has(p) || seenFold.has(p.toLowerCase())) meta.duplicateEntryCount += 1;
        else {
          seen.add(p);
          seenFold.add(p.toLowerCase());
        }
        const ext = extOf(p);
        meta.fileExtSummary[ext] = (meta.fileExtSummary[ext] || 0) + 1;
        if (ext === "dat") meta.datFileCount += 1;
        if (ext === "txt") meta.txtFileCount += 1;
        if (ext === "csv") meta.csvFileCount += 1;
        if (ext === "json") meta.jsonCandidateCount += 1;
        if (ext === "db" || ext === "sqlite" || ext === "sqlite3") meta.sqliteCandidateCount += 1;
        if (ext === "shp") {
          const base = p.replace(/\.shp$/i, "");
          shpBases.add(base.toLowerCase());
        }
        // TISA/CID/TABCD hints from filename only (no content) — sanitized counts later
        if (/cid\s*[=_]?\s*11|tabcd\s*[=_]?\s*25|tmc.*v?11|loc\d+|points|roads|names|segm/i.test(p)) {
          meta.candidateLayers.tisaNameHint =
            (meta.candidateLayers.tisaNameHint || 0) + 1;
        }
      }
      off += 46 + nameLen + extraLen + commentLen;
    }

    for (const base of shpBases) {
      // count set if at least shp present; companion check deferred to extract phase
      meta.shapefileSets += 1;
      void base;
    }

    meta.utilization.uncompressedWarnPct = warnHits(
      meta.declaredUncompressedTotalBytes,
      lim.maxUncompressedTotal,
      lim.warnThresholds
    );
    meta.utilization.perEntryWarnPct = warnHits(
      meta.maxDeclaredUncompressedEntryBytes,
      lim.maxSingleUncompressed,
      lim.warnThresholds
    );

    if (meta.declaredUncompressedTotalBytes > lim.maxUncompressedTotal) {
      meta.totalOverCurrentUncompressedLimit = true;
      meta.entrySizeRejectCategory = meta.entrySizeRejectCategory || "TMC_SIZE_TOTAL_UNCOMPRESSED";
    }
    if (meta.entriesOverCurrentPerEntryLimit > 0) {
      meta.entrySizeRejectCategory = meta.entrySizeRejectCategory || "TMC_SIZE_PER_ENTRY";
    }
    if (meta.maxObservedCompressionRatio > lim.maxCompressionRatio) {
      meta.entrySizeRejectCategory = meta.entrySizeRejectCategory || "TMC_SIZE_RATIO";
    }
    if (meta.encryptedEntryCount > 0) {
      meta.entrySizeRejectCategory = meta.entrySizeRejectCategory || "TMC_ZIP_ENCRYPTED";
    }

    // Deterministic candidate format selection (no content read yet)
    const decision = selectAuthoritativeFormat(meta);
    meta.authoritativeFormat = decision.authoritativeFormat || "UNVERIFIED";
    meta.authoritativeFormatVerified = decision.authoritativeFormatVerified === true;
    meta.candidateFormat = decision.candidateFormat || decision.format;
    meta.candidateFormatConfidence = decision.candidateFormatConfidence || "metadata_only";
    meta.candidateEvidenceSource = decision.candidateEvidenceSource || "central_directory";
    // Legacy field retained as candidate alias for older fixtures (not verified content).
    meta.formatCandidateLegacy = decision.format;
    meta.authoritativeReason = decision.reason;
    meta.cidDetected = decision.cid;
    meta.tabcdDetected = decision.tabcd;
    meta.versionHint = decision.versionHint;
  } finally {
    fs.closeSync(fd);
  }
  return meta;
}

/**
 * Prefer official TISA exchange layer over convenient SHP/SQLite (metadata-only).
 * Does NOT claim authoritativeFormatVerified — content inspection required.
 * @param {object} meta
 */
export function selectAuthoritativeFormat(meta) {
  const ext = meta.fileExtSummary || {};
  const hasTisaLike =
    (meta.datFileCount || 0) > 0 ||
    (meta.csvFileCount || 0) > 0 ||
    (meta.txtFileCount || 0) > 0 ||
    (meta.candidateLayers && meta.candidateLayers.tisaNameHint > 0);
  const hasShp = (ext.shp || 0) > 0 && (ext.dbf || 0) > 0;
  const hasSqlite = (meta.sqliteCandidateCount || 0) > 0;
  const hasJson = (meta.jsonCandidateCount || 0) > 0;

  const base = {
    cid: null,
    tabcd: null,
    candidateFormatConfidence: "metadata_only",
    candidateEvidenceSource: "central_directory",
    authoritativeFormat: "UNVERIFIED",
    authoritativeFormatVerified: false,
  };

  if (hasTisaLike && (hasShp || hasSqlite)) {
    return {
      ...base,
      format: TMC_FORMAT.TISA_DAT_CSV,
      candidateFormat: TMC_FORMAT.TISA_DAT_CSV,
      reason: "tisa_like_present_preferred_over_shp_sqlite",
      versionHint: "v11.0_candidate",
      importerStatus: "BASIC_IMPORTER_READY",
    };
  }
  if (hasTisaLike) {
    return {
      ...base,
      format: TMC_FORMAT.TISA_DAT_CSV,
      candidateFormat: TMC_FORMAT.TISA_DAT_CSV,
      reason: "tisa_dat_txt_csv_candidates",
      versionHint: "v11.0_candidate",
      importerStatus: "BASIC_IMPORTER_READY",
    };
  }
  if (hasJson && !hasShp && !hasSqlite) {
    return {
      ...base,
      format: TMC_FORMAT.JSON_TABLE,
      candidateFormat: TMC_FORMAT.JSON_TABLE,
      reason: "json_only_archive",
      versionHint: null,
      importerStatus: "JSON_SUPPORTED",
    };
  }
  if (hasShp && !hasTisaLike) {
    return {
      ...base,
      format: TMC_FORMAT.SHAPEFILE_SET,
      candidateFormat: TMC_FORMAT.SHAPEFILE_SET,
      reason: "shapefile_without_tisa_layer",
      versionHint: null,
      importerStatus: "TMC_AUTHORITATIVE_FORMAT_AMBIGUOUS_SHP_ONLY",
    };
  }
  if (hasSqlite && !hasTisaLike) {
    return {
      ...base,
      format: TMC_FORMAT.SQLITE_DB,
      candidateFormat: TMC_FORMAT.SQLITE_DB,
      reason: "sqlite_without_tisa_layer",
      versionHint: null,
      importerStatus: "TMC_AUTHORITATIVE_FORMAT_AMBIGUOUS_DB_ONLY",
    };
  }
  return {
    ...base,
    format: TMC_FORMAT.UNRESOLVED,
    candidateFormat: TMC_FORMAT.UNRESOLVED,
    reason: "no_authoritative_layer",
    versionHint: null,
    importerStatus: "TMC_AUTHORITATIVE_FORMAT_UNRESOLVED",
  };
}

/**
 * Peek SQLite magic at local-file data start (streamed, max 16 bytes).
 * @param {string} zipPath
 * @param {number} localHeaderOffset
 * @param {number} nameLen
 * @param {number} extraLen
 */
export function peekSqliteMagic(zipPath, localHeaderOffset, nameLen, extraLen) {
  const fd = fs.openSync(zipPath, "r");
  try {
    const dataOff = localHeaderOffset + 30 + nameLen + extraLen;
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, dataOff);
    return buf.slice(0, 6).toString("utf8") === "SQLite";
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Shadow-oriented TMC ingest from on-disk ZIP: structure + fail-closed authoritative gate.
 * Does not implement full TISA .DAT parse yet (requires confirmed sample layout).
 *
 * @param {string} zipPath
 * @param {{ limits?: object, workDir?: string, signal?: AbortSignal, skipLock?: boolean, measureDeps?: object }} [opts]
 *   measureDeps — TEST-ONLY inject for offline fixtures (createTestDiskStatsProvider).
 *   Production/shadow must omit it so real fs.statfs is used.
 */
export function analyzeAndGateTmcZipFile(zipPath, opts = {}) {
  const lim = { ...TMC_ZIP_LIMITS_V11, ...(opts.limits || {}) };
  const started = Date.now();
  const workDir = opts.workDir || path.dirname(zipPath);
  let lock = null;
  const releaseLock = () => {
    if (lock && typeof lock.release === "function") {
      try {
        lock.release();
      } catch (_) {}
    }
  };

  try {
    if (opts.skipLock !== true) {
      lock = acquireTmcImportLock(path.join(workDir, ".locks"));
      if (!lock.ok) {
        return {
          ok: false,
          rejectCode: lock.rejectCode || DISK_REJECT.LOCK,
          importerCompatible: false,
          zipMetadata: {
            archiveValidationStage: "lock",
            diskFormulaVersion: DISK_FORMULA_VERSION,
          },
          importerStatus: lock.rejectCode || DISK_REJECT.LOCK,
          elapsedMs: Date.now() - started,
        };
      }
    }

    let zipSize = 0;
    try {
      zipSize = fs.statSync(zipPath).size;
    } catch (_) {
      return {
        ok: false,
        rejectCode: DISK_REJECT.PATH,
        importerCompatible: false,
        zipMetadata: { archiveValidationStage: "zip_stat", diskFormulaVersion: DISK_FORMULA_VERSION },
        importerStatus: DISK_REJECT.PATH,
        elapsedMs: Date.now() - started,
      };
    }

    // Central directory first (cheap) so requiredBytes uses declared sizes — still before inflate.
    const meta = inspectZipFileCentral(zipPath, lim);
    const existingTaskOwnedBytes = measureTaskOwnedBytes(workDir, workDir);
    const disk = runDiskPreflight({
      checkDir: workDir,
      downloadedArchiveBytes: zipSize,
      declaredUncompressedBytes: meta.declaredUncompressedTotalBytes || 0,
      largestEntryBytes: meta.maxDeclaredUncompressedEntryBytes || 0,
      zipAlreadyOnDisk: true,
      existingTaskOwnedBytes,
      // Direct API only — never from env/workflow (shadow omits → real statfs).
      measureDeps: opts.measureDeps,
    });
    meta.diskDiagnostics = {
      diskCheckPathCategory: disk.diskCheckPathCategory,
      filesystemAvailableBytes: disk.filesystemAvailableBytes,
      filesystemRequiredBytes: disk.filesystemRequiredBytes,
      downloadedArchiveBytes: disk.downloadedArchiveBytes,
      declaredUncompressedBytes: disk.declaredUncompressedBytes,
      archiveWorkingReserveBytes: disk.archiveWorkingReserveBytes,
      indexReserveBytes: disk.indexReserveBytes,
      rollbackReserveBytes: disk.rollbackReserveBytes,
      atomicSwapReserveBytes: disk.atomicSwapReserveBytes,
      operatingSystemSafetyReserveBytes: disk.operatingSystemSafetyReserveBytes,
      existingTaskOwnedBytes: disk.existingTaskOwnedBytes,
      cleanupCandidateBytes: disk.cleanupCandidateBytes,
      diskFormulaVersion: disk.diskFormulaVersion || DISK_FORMULA_VERSION,
      rejectCode: disk.rejectCode || null,
      legacyFlatMinFreeDiskBytes: lim.legacyFlatMinFreeDiskBytes || lim.minFreeDiskBytes,
    };

    if (!disk.ok) {
      meta.archiveValidationStage = "disk_preflight";
      return {
        ok: false,
        rejectCode: disk.rejectCode || DISK_REJECT.SPACE,
        importerCompatible: false,
        zipMetadata: meta,
        importerStatus: disk.rejectCode || DISK_REJECT.SPACE,
        diskDiagnostics: meta.diskDiagnostics,
        elapsedMs: Date.now() - started,
      };
    }

    const decision = selectAuthoritativeFormat(meta);
    meta.candidateFormat = decision.candidateFormat || decision.format;
    meta.candidateFormatConfidence = decision.candidateFormatConfidence || "metadata_only";
    meta.candidateEvidenceSource = decision.candidateEvidenceSource || "central_directory";
    meta.authoritativeFormat = decision.authoritativeFormat || "UNVERIFIED";
    meta.authoritativeFormatVerified = false;
    meta.authoritativeReason = decision.reason;
    meta.formatCandidateLegacy = decision.format;

    if (meta.entrySizeRejectCategory) {
      return {
        ok: false,
        rejectCode: meta.entrySizeRejectCategory,
        importerCompatible: false,
        zipMetadata: meta,
        importerStatus: meta.entrySizeRejectCategory,
        diskDiagnostics: meta.diskDiagnostics,
        elapsedMs: Date.now() - started,
      };
    }
    if (meta.pathRejectCategory) {
      return {
        ok: false,
        rejectCode: "TMC_ZIP_BAD_PATH",
        pathRejectCategory: meta.pathRejectCategory,
        importerCompatible: false,
        zipMetadata: meta,
        importerStatus: "TMC_ZIP_BAD_PATH",
        diskDiagnostics: meta.diskDiagnostics,
        elapsedMs: Date.now() - started,
      };
    }
    if (decision.importerStatus === "JSON_SUPPORTED") {
      return {
        ok: false,
        rejectCode: "TMC_JSON_REQUIRES_STREAM_EXTRACT",
        importerCompatible: false,
        zipMetadata: meta,
        importerStatus: decision.importerStatus,
        diskDiagnostics: meta.diskDiagnostics,
        elapsedMs: Date.now() - started,
      };
    }

    // Basic TMC v11 importer is implemented. Sync gate only advertises readiness;
    // full content import runs via importBasicTmcArchive (async, streaming).
    const isTisa =
      decision.format === TMC_FORMAT.TISA_DAT_CSV || decision.candidateFormat === TMC_FORMAT.TISA_DAT_CSV;
    if (isTisa) {
      return {
        ok: false,
        rejectCode: "TMC_BASIC_IMPORT_REQUIRED",
        importerCompatible: true,
        zipMetadata: meta,
        importerStatus: "BASIC_IMPORTER_READY",
        basicImporterEntrypoint: "importBasicTmcArchive",
        cidExpected: TMC_CID_EXPECTED,
        tabcdExpected: TMC_TABCD_EXPECTED,
        cidValidated: false,
        tabcdValidated: false,
        sizePreflightPassed: true,
        diskPreflightPassed: true,
        streamingReady: true,
        atomicImportReady: true,
        rollbackReady: true,
        advancedRelationshipsEnabled: false,
        diskDiagnostics: meta.diskDiagnostics,
        elapsedMs: Date.now() - started,
      };
    }

    return {
      ok: false,
      rejectCode: decision.importerStatus || "TMC_AUTHORITATIVE_FORMAT_UNRESOLVED",
      importerCompatible: false,
      zipMetadata: meta,
      importerStatus: decision.importerStatus,
      cidExpected: TMC_CID_EXPECTED,
      tabcdExpected: TMC_TABCD_EXPECTED,
      cidValidated: false,
      tabcdValidated: false,
      sizePreflightPassed: true,
      diskPreflightPassed: true,
      streamingReady: true,
      atomicImportReady: true,
      rollbackReady: true,
      diskDiagnostics: meta.diskDiagnostics,
      elapsedMs: Date.now() - started,
    };
  } finally {
    releaseLock();
  }
}

/**
 * Atomically activate an internal TMC index file (never public path).
 * @param {{ activePath: string, stagingPath: string, lastGoodPath: string }} paths
 * @param {Buffer|string} payload
 */
export function atomicActivateTmcIndex(paths, payload) {
  const dir = path.dirname(paths.stagingPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = paths.stagingPath + ".partial";
  fs.writeFileSync(tmp, payload, { mode: 0o600 });
  try {
    if (fs.existsSync(paths.stagingPath)) fs.rmSync(paths.stagingPath, { force: true });
  } catch (_) {}
  fs.renameSync(tmp, paths.stagingPath);
  if (fs.existsSync(paths.activePath)) {
    try {
      fs.copyFileSync(paths.activePath, paths.lastGoodPath);
    } catch (_) {}
    // Windows cannot rename onto an existing destination.
    try {
      fs.rmSync(paths.activePath, { force: true });
    } catch (_) {}
  }
  fs.renameSync(paths.stagingPath, paths.activePath);
  return { ok: true, activated: true };
}

/**
 * Rollback active index to last-good.
 */
export function rollbackTmcIndex(paths) {
  if (!fs.existsSync(paths.lastGoodPath)) {
    return { ok: false, reason: "no_last_good" };
  }
  fs.copyFileSync(paths.lastGoodPath, paths.activePath);
  return { ok: true };
}

/**
 * Basic TMC location table v11 importer (CID 11 / TABCD 25).
 *
 * Layers (colocated for repo convention; exported by role):
 *   TmcArchivePreflight, TmcArchiveReader, TmcManifestClassifier,
 *   TmcDatStreamReader, TmcHeaderValidator, TmcRowParser,
 *   TmcTableValidators, TmcBasicRelationshipValidator, TmcNormalizer,
 *   TmcStagingStore, TmcActivationManager, TmcLastGoodManager,
 *   TmcImporterMetrics, TmcImporterResult
 *
 * Fail-closed on RNLT advanced relationships, PES_LEV resolution, LANGUAGES 5th field use.
 * Synthetic fixtures only — never opens real licensed archives in tests.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  inspectZipFileCentral,
  atomicActivateTmcIndex,
  rollbackTmcIndex,
  TMC_ZIP_LIMITS_V11,
  TMC_CID_EXPECTED,
  TMC_TABCD_EXPECTED,
  TMC_FORMAT,
  selectAuthoritativeFormat,
} from "./tmc-archive-stream.mjs";
import {
  acquireTmcImportLock,
  runDiskPreflight,
  measureTaskOwnedBytes,
  wipeTaskOwnedPath,
  DISK_REJECT,
  DISK_FORMULA_VERSION,
} from "./disk-preflight.mjs";
import { collectInspectionPeekTargets } from "./tmc-format-inspection.mjs";
import { peekZipEntryBytesStreaming, PEEK_STATUS } from "./tmc-zip-entry-peek.mjs";
import {
  SP08001_TABLE_CODES,
  SP08001_STANDARD_TABLE_COUNT,
  getSp08001Table,
} from "./tmc-sp08001-contract.mjs";
import { isAllowedEmptyTable } from "./tmc-sp08001-format-promotion.mjs";
import { parseSp08001DatBuffer, validateFieldType } from "./tmc-dat-parser.mjs";
import {
  FEATURE_FLAGS,
  RNLT_STATUS,
  PES_LEV_RELATIONSHIP_STATUS,
  emptyMetrics,
  rowsToObjects,
  normalizeRoad,
  normalizePoint,
} from "./tmc-basic-model.mjs";
import { validateBasicRelationships, detectPointNextCycles } from "./tmc-basic-relationships.mjs";
import { TMC_IMPORTER_ERROR } from "./tmc-importer-errors.mjs";

export const TMC_TABLE_VERSION_EXPECTED = 11;
export const BASIC_IMPORTER_VERSION = "tmc-basic-importer-v11-1";

export {
  FEATURE_FLAGS,
  RNLT_STATUS,
  PES_LEV_RELATIONSHIP_STATUS,
  TMC_IMPORTER_ERROR,
};

function cryptoRunId() {
  return crypto.randomBytes(16).toString("hex");
}

function archiveSha256File(filePath) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

function isSymlinkOrReparse(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink()) return true;
    // Windows reparse: rough check via stats — treat non-file as reject
    if (!st.isFile()) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * TmcArchivePreflight — fail-closed ZIP + path checks (reuses central inspect).
 */
export function tmcArchivePreflight(zipPath, lim) {
  if (!zipPath || typeof zipPath !== "string") {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_NOT_FOUND };
  }
  if (!fs.existsSync(zipPath)) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_NOT_FOUND };
  }
  if (isSymlinkOrReparse(zipPath)) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_INVALID };
  }
  if (!String(zipPath).toLowerCase().endsWith(".zip")) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_INVALID };
  }
  const fd = fs.openSync(zipPath, "r");
  try {
    const magic = Buffer.alloc(4);
    fs.readSync(fd, magic, 0, 4, 0);
    if (!(magic[0] === 0x50 && magic[1] === 0x4b)) {
      return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_INVALID };
    }
  } finally {
    fs.closeSync(fd);
  }
  const meta = inspectZipFileCentral(zipPath, lim);
  if (meta.entrySizeRejectCategory) {
    return { ok: false, rejectCode: meta.entrySizeRejectCategory, meta };
  }
    if (meta.pathRejectCategory) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ZIP_BAD_PATH, meta, pathRejectCategory: meta.pathRejectCategory };
  }
  if (meta.encryptedEntryCount > 0 || meta.entrySizeRejectCategory === "TMC_ZIP_ENCRYPTED") {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_ENCRYPTED, meta };
  }
  if (meta.unsupportedEntryTypeCount > 0) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_UNSUPPORTED_COMPRESSION, meta };
  }
  if (meta.duplicateEntryCount > 0) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_DUPLICATE_ENTRY, meta };
  }
  if (meta.zip64EntryCount > 0) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ZIP64_UNSUPPORTED, meta };
  }
  return { ok: true, meta };
}

/**
 * Classify DAT targets into standard tables + README metadata.
 */
export function classifyManifest(targets) {
  const byCode = Object.create(null);
  const unknownDat = [];
  let readme = null;
  for (const t of targets || []) {
    if (!t.tableCode) {
      if (t.ext === "dat" || t.ext === "txt" || t.ext === "csv") unknownDat.push(t);
      continue;
    }
    if (t.tableCode === "README") {
      if (readme) return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_DUPLICATE_ENTRY };
      readme = t;
      continue;
    }
    if (byCode[t.tableCode]) {
      return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_DUPLICATE_ENTRY };
    }
    byCode[t.tableCode] = t;
  }
  if (unknownDat.length > 0) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT };
  }
  const missing = [];
  for (const code of SP08001_TABLE_CODES) {
    if (!byCode[code]) missing.push(code);
  }
  if (missing.length) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_REQUIRED_TABLE_MISSING, missingCount: missing.length };
  }
  return {
    ok: true,
    byCode,
    readme,
    standardTableCount: SP08001_STANDARD_TABLE_COUNT,
    role: {
      README: "METADATA_ONLY",
      ROAD_NETWORK_LEVEL_TYPES: "UNSUPPORTED_ADVANCED_RELATIONSHIP",
      ROADS: "REQUIRED_FOR_BASIC_RESOLUTION",
      POINTS: "REQUIRED_FOR_BASIC_RESOLUTION",
      LOCATIONCODES: "REQUIRED_FOR_BASIC_RESOLUTION",
      LOCATIONDATASETS: "REQUIRED_FOR_ARCHIVE_VALIDITY",
      LANGUAGES: "REQUIRED_FOR_ARCHIVE_VALIDITY",
    },
  };
}

async function readEntryBounded(zipPath, target, maxOut, opts) {
  const peek = await peekZipEntryBytesStreaming(zipPath, target, maxOut, opts);
  if (peek.status === PEEK_STATUS.ENCRYPTED_REJECTED) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_ENCRYPTED };
  }
  if (peek.status === PEEK_STATUS.UNSUPPORTED_METHOD) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_UNSUPPORTED_COMPRESSION };
  }
  if (peek.status === PEEK_STATUS.STRUCTURAL_ERROR || peek.status === PEEK_STATUS.DECOMPRESSION_ERROR) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_INVALID };
  }
  if (peek.status === PEEK_STATUS.TRUNCATED_AT_LIMIT) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_LIMIT_EXCEEDED };
  }
  return { ok: true, buf: peek.buf || Buffer.alloc(0), bytesRead: peek.bytesRead || 0 };
}

function validateTableRows(tableCode, headerCodes, rowObjs) {
  const table = getSp08001Table(tableCode);
  let rejected = 0;
  const accepted = [];
  const pkSeen = new Set();
  for (const row of rowObjs) {
    let rowOk = true;
    for (const col of table.columns) {
      const v = row[col.code];
      const check = validateFieldType(col.type, v, col.optional);
      // PES_LEV special: empty → null allowed even if optional:false (documented-but-unproven mandatory)
      if (col.code === "PES_LEV" && check.empty) {
        continue;
      }
      if (!check.ok) {
        rowOk = false;
        break;
      }
    }
    if (!rowOk) {
      rejected += 1;
      continue;
    }
    // Primary identity: prefer LCD+CID+TABCD when present
    let pk = null;
    if (row.LCD != null && row.CID != null && row.TABCD != null) {
      pk = `${row.CID}|${row.TABCD}|${row.LCD}`;
    } else if (tableCode === "ROAD_NETWORK_LEVEL_TYPES" && row.PES_LEV != null && String(row.PES_LEV) !== "") {
      pk = `RNLT|${row.PES_LEV}`;
    } else if (tableCode === "LANGUAGES" && row.LID != null) {
      pk = `LANG|${row.CID}|${row.LID}`;
    } else if (tableCode === "COUNTRIES" && row.CID != null) {
      pk = `C|${row.CID}`;
    }
    if (pk) {
      if (pkSeen.has(pk)) {
        return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_PRIMARY_KEY_DUPLICATE, rejected, accepted: [] };
      }
      pkSeen.add(pk);
    }
    accepted.push(row);
  }
  if (!isAllowedEmptyTable(tableCode) && accepted.length === 0 && tableCode !== "ROAD_NETWORK_LEVEL_TYPES") {
    // RNLT may be empty for basic import; other required tables need rows unless allowlisted empty
    if (!isAllowedEmptyTable(tableCode)) {
      // LOCATIONDATASETS / COUNTRIES / CLASSES etc. need at least header validity; empty data fails for non-allowlisted
      // Keep strict: non-allowlisted empty ⇒ validation failure for core tables used in resolution
      const mustHaveRows = ["LOCATIONDATASETS", "COUNTRIES", "CLASSES", "TYPES", "SUBTYPES", "POINTS", "ROADS", "LANGUAGES", "LOCATIONCODES"].includes(
        tableCode
      );
      if (mustHaveRows) {
        return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_VALIDATION_FAILED, rejected, accepted: [] };
      }
    }
  }
  return { ok: true, rejected, accepted };
}

/**
 * Main entry: basic TMC v11 import with staging / atomic activation / last-good.
 */
export async function importBasicTmcArchive(zipPath, opts = {}) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const importRunId = opts.importRunId || cryptoRunId();
  const lim = { ...TMC_ZIP_LIMITS_V11, ...(opts.limits || {}) };
  const workDir = opts.workDir || path.join(os.tmpdir(), "iu-tmc-import-" + importRunId);
  const metrics = emptyMetrics();
  let lock = null;
  let stagingRoot = null;
  let cleanupSucceeded = false;

  const fail = (code, extra = {}) => {
    if (stagingRoot) {
      try {
        wipeTaskOwnedPath(stagingRoot, workDir);
      } catch (_) {}
    }
    if (lock && typeof lock.release === "function") {
      try {
        lock.release();
      } catch (_) {}
    }
    metrics.durationMs = Date.now() - t0;
    metrics.cleanupSucceeded = cleanupSucceeded;
    return {
      ok: false,
      rejectCode: code,
      importerStatus: code,
      importRunId,
      featureFlags: { ...FEATURE_FLAGS },
      metrics,
      startedAt,
      completedAt: new Date().toISOString(),
      ...extra,
    };
  };

  try {
    fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
    stagingRoot = path.join(workDir, "staging-" + importRunId);
    fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });

    if (opts.skipLock !== true) {
      lock = acquireTmcImportLock(path.join(workDir, ".locks"), {
        ttlMs: opts.lockTtlMs,
        holder: opts.lockHolder || "tmc-basic-" + process.pid + "-" + importRunId.slice(0, 8),
      });
      if (!lock.ok) {
        return fail(TMC_IMPORTER_ERROR.TMC_IMPORT_ALREADY_RUNNING);
      }
    }

    if (opts.forceStagingFailure === true) {
      return fail(TMC_IMPORTER_ERROR.TMC_STAGING_FAILED);
    }

    const pre = tmcArchivePreflight(zipPath, lim);
    if (!pre.ok) {
      const mapped =
        pre.rejectCode === "TMC_ZIP_ENCRYPTED" ? TMC_IMPORTER_ERROR.TMC_ARCHIVE_ENCRYPTED : pre.rejectCode;
      return fail(mapped);
    }

    const meta = pre.meta;
    metrics.archiveCompressedBytes = fs.statSync(zipPath).size;
    metrics.archiveDeclaredUncompressedBytes = meta.declaredUncompressedTotalBytes || 0;
    metrics.archiveEntryCount = meta.centralEntryCount || 0;
    metrics.datEntryCount = meta.datFileCount || 0;

    const existingTaskOwnedBytes = measureTaskOwnedBytes(workDir, workDir);
    const disk = runDiskPreflight({
      checkDir: workDir,
      downloadedArchiveBytes: metrics.archiveCompressedBytes,
      declaredUncompressedBytes: metrics.archiveDeclaredUncompressedBytes,
      largestEntryBytes: meta.maxDeclaredUncompressedEntryBytes || 0,
      zipAlreadyOnDisk: true,
      existingTaskOwnedBytes,
      measureDeps: opts.measureDeps,
    });
    if (!disk.ok) {
      const code =
        disk.rejectCode === DISK_REJECT.SPACE ? TMC_IMPORTER_ERROR.TMC_DISK_LIMIT : disk.rejectCode || TMC_IMPORTER_ERROR.TMC_DISK_LIMIT;
      return fail(code);
    }

    if (opts.maxHeapBytes != null) {
      const heap = process.memoryUsage().heapUsed;
      metrics.peakHeapBytes = heap;
      if (heap > opts.maxHeapBytes) return fail(TMC_IMPORTER_ERROR.TMC_MEMORY_LIMIT);
    }

    const decision = selectAuthoritativeFormat(meta);
    if (decision.format !== TMC_FORMAT.TISA_DAT_CSV && decision.candidateFormat !== TMC_FORMAT.TISA_DAT_CSV) {
      return fail(TMC_IMPORTER_ERROR.TMC_ARCHIVE_INVALID);
    }

    const collected = collectInspectionPeekTargets(zipPath, lim);
    if (!collected.ok) return fail(TMC_IMPORTER_ERROR.TMC_ARCHIVE_INVALID);

    const manifest = classifyManifest(collected.targets);
    if (!manifest.ok) return fail(manifest.rejectCode);
    metrics.standardTableCount = manifest.standardTableCount;

    const tableStore = Object.create(null);
    let languagesExtensionFieldPresent = false;
    let rnltStatus = RNLT_STATUS.MISSING;
    let emptyPesLevCount = 0;
    let nonEmptyPesLevCount = 0;
    let invalidPesLevCount = 0;
    let tableVersion = null;
    let cidOk = false;
    let tabcdOk = false;

    const maxPeek = opts.maxPeekBytes != null ? opts.maxPeekBytes : 2 * 1024 * 1024;

    for (const code of SP08001_TABLE_CODES) {
      const target = manifest.byCode[code];
      const read = await readEntryBounded(zipPath, target, maxPeek, { timeoutMs: opts.timeoutMs });
      if (!read.ok) return fail(read.rejectCode);
      metrics.archiveActualReadBytes += read.bytesRead || 0;

      if (opts.maxRssBytes != null) {
        const rss = process.memoryUsage().rss;
        metrics.peakRssBytes = Math.max(metrics.peakRssBytes, rss);
        if (rss > opts.maxRssBytes) return fail(TMC_IMPORTER_ERROR.TMC_MEMORY_LIMIT);
      }

      const parsed = parseSp08001DatBuffer(code, read.buf, {
        limits: opts.datLimits,
        rejectBom: opts.rejectBom,
        forbidMixedLineEndings: opts.forbidMixedLineEndings,
      });
      if (!parsed.ok) return fail(parsed.rejectCode);

      if (code === "LANGUAGES" && parsed.languagesExtensionFieldPresent) {
        languagesExtensionFieldPresent = true;
      }

      metrics.parsedRowCount += parsed.rowCount;
      const objs = rowsToObjects(parsed.headerCodes, parsed.rows);
      const validated = validateTableRows(code, parsed.headerCodes, objs);
      if (!validated.ok) return fail(validated.rejectCode);
      metrics.rejectedRowCount += validated.rejected;
      metrics.acceptedRowCount += validated.accepted.length;

      if (code === "ROAD_NETWORK_LEVEL_TYPES") {
        if (parsed.headerMatch && parsed.headerMatch.matched === false) {
          rnltStatus = RNLT_STATUS.PRESENT_UNSUPPORTED_HEADER;
        } else if (validated.accepted.length === 0) {
          rnltStatus = RNLT_STATUS.PRESENT_EMPTY;
        } else {
          rnltStatus = RNLT_STATUS.PRESENT_VALID_BASIC;
        }
        // Advanced always disabled
        if (FEATURE_FLAGS.ADVANCED_RNLT_RELATIONSHIPS_ENABLED) {
          return fail(TMC_IMPORTER_ERROR.TMC_RNLT_ADVANCED_DISABLED);
        }
      }

      if (code === "ROADS") {
        for (const row of validated.accepted) {
          const pes = row.PES_LEV == null ? "" : String(row.PES_LEV).trim();
          if (pes === "") emptyPesLevCount += 1;
          else {
            const check = validateFieldType("NUMERIC(1)", pes, false);
            if (!check.ok) invalidPesLevCount += 1;
            else nonEmptyPesLevCount += 1;
          }
        }
        if (FEATURE_FLAGS.PES_LEV_RELATIONSHIP_RESOLUTION_ENABLED) {
          return fail(TMC_IMPORTER_ERROR.TMC_PES_LEV_ADVANCED_DISABLED);
        }
      }

      if (code === "LOCATIONDATASETS") {
        for (const row of validated.accepted) {
          if (String(row.CID) !== String(TMC_CID_EXPECTED)) return fail(TMC_IMPORTER_ERROR.TMC_CID_MISMATCH);
          if (String(row.TABCD) !== String(TMC_TABCD_EXPECTED)) return fail(TMC_IMPORTER_ERROR.TMC_TABCD_MISMATCH);
          const ver = String(row.VERSION || "").trim();
          const verNum = Number(ver);
          if (verNum !== TMC_TABLE_VERSION_EXPECTED && ver !== String(TMC_TABLE_VERSION_EXPECTED)) {
            return fail(TMC_IMPORTER_ERROR.TMC_VERSION_MISMATCH);
          }
          tableVersion = TMC_TABLE_VERSION_EXPECTED;
          cidOk = true;
          tabcdOk = true;
        }
      }

      // CID/TABCD on rows that have them
      for (const row of validated.accepted) {
        if (row.CID != null && String(row.CID).trim() !== "" && String(row.CID) !== String(TMC_CID_EXPECTED)) {
          return fail(TMC_IMPORTER_ERROR.TMC_CID_MISMATCH);
        }
        if (row.TABCD != null && String(row.TABCD).trim() !== "" && String(row.TABCD) !== String(TMC_TABCD_EXPECTED)) {
          return fail(TMC_IMPORTER_ERROR.TMC_TABCD_MISMATCH);
        }
      }

      tableStore[code] = {
        rowCount: validated.accepted.length,
        encoding: parsed.encodingMeta,
        // Store only opaque counts in public result; full objects stay in staging file
        _accepted: validated.accepted,
      };
    }

    // README metadata-only — parse structural flags, never store raw text in model
    if (manifest.readme) {
      const read = await readEntryBounded(zipPath, manifest.readme, Math.min(maxPeek, 64 * 1024), {});
      if (!read.ok) return fail(read.rejectCode);
      metrics.archiveActualReadBytes += read.bytesRead || 0;
      // Do not emit README body
      tableStore.README = { role: "METADATA_ONLY", byteLength: read.buf.length };
    }

    if (!cidOk || !tabcdOk || tableVersion !== TMC_TABLE_VERSION_EXPECTED) {
      return fail(TMC_IMPORTER_ERROR.TMC_VALIDATION_FAILED);
    }

    metrics.emptyPesLevCount = emptyPesLevCount;
    metrics.nonEmptyPesLevCount = nonEmptyPesLevCount;
    metrics.invalidPesLevCount = invalidPesLevCount;
    if (invalidPesLevCount > 0) return fail(TMC_IMPORTER_ERROR.TMC_VALIDATION_FAILED);

    const versionMeta = { tableVersion, cid: TMC_CID_EXPECTED, tabcd: TMC_TABCD_EXPECTED };
    const roads = (tableStore.ROADS._accepted || []).map((r) => normalizeRoad(r, versionMeta));
    const points = (tableStore.POINTS._accepted || []).map((r) => normalizePoint(r, versionMeta));
    const locationCodes = new Set();
    for (const row of tableStore.LOCATIONCODES._accepted || []) {
      locationCodes.add(String(row.LCD));
    }
    for (const p of points) locationCodes.add(String(p.lcd));

    if (opts.injectCycle === true && points.length >= 2) {
      points[0].nextPos = String(points[1].lcd);
      points[1].nextPos = String(points[0].lcd);
    }

    const cycle = detectPointNextCycles(points);
    if (cycle.hasCycle) {
      return fail(TMC_IMPORTER_ERROR.TMC_REFERENCE_INVALID);
    }

    const rel = validateBasicRelationships(
      {
        points,
        roads,
        locationCodes,
        rnltAdvancedAttempted: false,
      },
      { maxUnresolved: opts.maxUnresolved, failOnSelfCycle: opts.failOnSelfCycle }
    );
    if (!rel.ok) return fail(rel.rejectCode);
    metrics.missingReferenceCount = rel.metrics.missingReferenceCount;
    metrics.duplicateKeyCount = rel.metrics.duplicateKeyCount;
    metrics.unsupportedAdvancedRelationshipCount = rel.metrics.unsupportedAdvancedRelationshipCount;

    // Strip private accepted rows before persist
    const publicTables = Object.create(null);
    for (const code of Object.keys(tableStore)) {
      publicTables[code] = {
        rowCount: tableStore[code].rowCount,
        encoding: tableStore[code].encoding || null,
        role: code === "README" ? "METADATA_ONLY" : code === "ROAD_NETWORK_LEVEL_TYPES" ? "UNSUPPORTED_ADVANCED_RELATIONSHIP" : "STANDARD",
      };
    }

    const archiveSha256 = opts.skipArchiveHash ? "synthetic" : archiveSha256File(zipPath);

    const stagingPayload = {
      schema: "tmc-basic-index-v1",
      importRunId,
      cid: TMC_CID_EXPECTED,
      tabcd: TMC_TABCD_EXPECTED,
      tableVersion: TMC_TABLE_VERSION_EXPECTED,
      archiveSha256,
      startedAt,
      featureFlags: { ...FEATURE_FLAGS },
      rnltStatus,
      pesLevRelationshipStatus: PES_LEV_RELATIONSHIP_STATUS.DISABLED_UNPROVEN,
      languagesExtensionFieldPresent,
      languagesExtensionFieldSupported: false,
      languagesFifthFieldUsed: false,
      tables: publicTables,
      model: {
        roadCount: roads.length,
        pointCount: points.length,
        // Opaque resolution counts only
        resolutionSummary: {
          total: rel.resolutions.length,
          resolvedBasic: rel.resolutions.filter((r) => r.status === "RESOLVED_BASIC").length,
        },
      },
      metricsSnapshot: { ...metrics },
      importerVersion: BASIC_IMPORTER_VERSION,
    };

    const indexDir = path.join(workDir, "index");
    fs.mkdirSync(indexDir, { recursive: true, mode: 0o700 });
    const paths = {
      activePath: path.join(indexDir, "active.json"),
      stagingPath: path.join(stagingRoot, "index.json"),
      lastGoodPath: path.join(indexDir, "last-good.json"),
    };

    if (opts.forcePreActivationFailure === true) {
      return fail(TMC_IMPORTER_ERROR.TMC_VALIDATION_FAILED);
    }

    const body = Buffer.from(JSON.stringify(stagingPayload), "utf8");
    fs.writeFileSync(paths.stagingPath, body, { mode: 0o600 });
    metrics.temporaryDiskBytes = body.length;

    if (opts.forceActivationFailure === true) {
      return fail(TMC_IMPORTER_ERROR.TMC_ACTIVATION_FAILED);
    }
    if (opts.forcePartialOutput === true) {
      fs.writeFileSync(paths.activePath + ".partial", body, { mode: 0o600 });
      return fail(TMC_IMPORTER_ERROR.TMC_PARTIAL_OUTPUT);
    }

    let activated;
    try {
      activated = atomicActivateTmcIndex(paths, body);
    } catch (_) {
      return fail(TMC_IMPORTER_ERROR.TMC_ACTIVATION_FAILED);
    }
    if (!activated || !activated.ok) return fail(TMC_IMPORTER_ERROR.TMC_ACTIVATION_FAILED);
    metrics.activationSucceeded = true;

    // Cleanup staging after successful activate
    try {
      wipeTaskOwnedPath(stagingRoot, workDir);
      cleanupSucceeded = true;
      stagingRoot = null;
    } catch (_) {
      cleanupSucceeded = false;
      if (opts.requireCleanup === true) return fail(TMC_IMPORTER_ERROR.TMC_INTERNAL_SAFE_FAILURE);
    }
    metrics.cleanupSucceeded = cleanupSucceeded;

    if (lock && typeof lock.release === "function") {
      try {
        lock.release();
      } catch (_) {}
      lock = null;
    }

    metrics.durationMs = Date.now() - t0;
    const mu = process.memoryUsage();
    metrics.peakHeapBytes = Math.max(metrics.peakHeapBytes, mu.heapUsed);
    metrics.peakRssBytes = Math.max(metrics.peakRssBytes, mu.rss);

    return {
      ok: true,
      rejectCode: null,
      importerStatus: "BASIC_IMPORT_ACTIVATED",
      importRunId,
      cid: TMC_CID_EXPECTED,
      tabcd: TMC_TABCD_EXPECTED,
      tableVersion: TMC_TABLE_VERSION_EXPECTED,
      archiveSha256,
      startedAt,
      completedAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(),
      status: "activated",
      featureFlags: { ...FEATURE_FLAGS },
      rnltStatus,
      pesLevRelationshipStatus: PES_LEV_RELATIONSHIP_STATUS.DISABLED_UNPROVEN,
      languagesExtensionFieldPresent,
      languagesExtensionFieldSupported: false,
      languagesFifthFieldUsed: FEATURE_FLAGS.LANGUAGES_FIFTH_FIELD_USED,
      unprovenFieldsInferred: FEATURE_FLAGS.UNPROVEN_FIELDS_INFERRED,
      metrics,
      indexPaths: {
        activePath: "index/active.json",
        stagingPath: "staging/index.json",
        lastGoodPath: "index/last-good.json",
      },
      indexDirCategory: "task_owned",
      ...(opts.returnInternalPaths === true ? { _internalIndexPaths: paths } : {}),
      tableCounts: Object.fromEntries(Object.keys(publicTables).map((k) => [k, publicTables[k].rowCount])),
      diskFormulaVersion: DISK_FORMULA_VERSION,
      authoritativeFormatVerified: true,
      authoritativeFormat: TMC_FORMAT.TISA_DAT_CSV,
    };
  } catch (_) {
    return fail(TMC_IMPORTER_ERROR.TMC_INTERNAL_SAFE_FAILURE);
  } finally {
    if (lock && typeof lock.release === "function") {
      try {
        lock.release();
      } catch (_) {}
    }
  }
}

export function rollbackBasicTmcImport(paths) {
  const r = rollbackTmcIndex(paths);
  if (!r.ok) return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ROLLBACK_FAILED };
  return { ok: true };
}

export function readActiveBasicIndex(activePath) {
  if (!fs.existsSync(activePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(activePath, "utf8"));
  } catch {
    return null;
  }
}

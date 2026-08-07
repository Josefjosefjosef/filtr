/**
 * Safe TMC download ingest (server/CI only).
 * Supports: plain JSON/text, ZIP, GZIP, GZIP→ZIP.
 * Content-Encoding: gzip — only gunzip when magic bytes still present
 * (fetch runtimes often auto-decode; never double-decompress on header alone).
 * Never logs Authorization / credentials / raw table contents.
 */
import zlib from "zlib";
import { parseTmcTablePayload } from "./tmc-table.mjs";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;

export const DEFAULT_ZIP_LIMITS = Object.freeze({
  /**
   * Shadow #8 observed: ~21.1 MiB compressed / ~332.2 MiB declared uncompressed /
   * largest entry ~117.8 MiB / ratio ~45.87 / 97 central entries.
   * Caps keep ~25–35% reserve above those values while remaining bomb-closed.
   */
  maxEntries: 256,
  maxUncompressedTotal: 420 * 1024 * 1024,
  maxSingleUncompressed: 150 * 1024 * 1024,
  maxCompressedTotal: 48 * 1024 * 1024,
  maxCompressionRatio: 80,
  maxNameLen: 240,
  maxPathDepth: 12,
  maxGzipLayers: 2,
  maxGzipOutput: 420 * 1024 * 1024,
  maxImportMs: 300_000,
  maxWorkDirBytes: 900 * 1024 * 1024,
  minFreeDiskBytes: 2 * 1024 * 1024 * 1024,
  warnThresholds: Object.freeze([0.7, 0.85, 0.95]),
});

/** Previous per-entry / total caps (shadow #6–#7 era; regression docs). */
export const TMC_ZIP_LIMITS_PREV = Object.freeze({
  maxSingleUncompressed: 64 * 1024 * 1024,
  maxUncompressedTotal: 96 * 1024 * 1024,
  maxCompressedTotal: 40 * 1024 * 1024,
  maxEntries: 64,
  maxPathDepth: 8,
});

export function isGzipMagic(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

export function isZipMagic(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
  if (buf[0] === 0x50 && buf[1] === 0x4b) return true;
  try {
    return buf.readUInt32LE(0) === LOCAL_SIG;
  } catch {
    return false;
  }
}

/**
 * Safe gunzip with output size cap (gzip-bomb guard).
 * @param {Buffer} buf
 * @param {{ maxOutput?: number }} [opts]
 */
export function safeGunzip(buf, opts = {}) {
  const maxOutput = opts.maxOutput || DEFAULT_ZIP_LIMITS.maxGzipOutput;
  if (!isGzipMagic(buf)) {
    throw Object.assign(new Error("tmc_gzip_magic"), { code: "TMC_GZIP_MAGIC" });
  }
  if (buf.length > DEFAULT_ZIP_LIMITS.maxCompressedTotal) {
    throw Object.assign(new Error("tmc_gzip_too_large"), { code: "TMC_GZIP_TOO_LARGE" });
  }
  try {
    return zlib.gunzipSync(buf, { maxOutputLength: maxOutput });
  } catch (e) {
    const code = e && e.code;
    if (code === "ERR_BUFFER_TOO_LARGE" || /exceed|too large|maxOutput/i.test(String(e && e.message))) {
      throw Object.assign(new Error("tmc_gzip_bomb"), { code: "TMC_GZIP_BOMB" });
    }
    throw Object.assign(new Error("tmc_gzip_corrupt"), { code: "TMC_GZIP_CORRUPT" });
  }
}

/**
 * Unwrap Content-Encoding / magic GZIP layers without double-decompressing
 * bodies already decoded by the HTTP runtime.
 *
 * @param {Buffer} buf
 * @param {{ contentEncoding?: string, limits?: Partial<typeof DEFAULT_ZIP_LIMITS> }} [opts]
 * @returns {{ body: Buffer, layers: string[], skippedDoubleGzip: boolean }}
 */
export function unwrapTmcTransportLayers(buf, opts = {}) {
  if (!Buffer.isBuffer(buf)) {
    throw Object.assign(new Error("tmc_body_not_buffer"), { code: "TMC_BODY_TYPE" });
  }
  const limits = { ...DEFAULT_ZIP_LIMITS, ...(opts.limits || {}) };
  const contentEncoding = String(opts.contentEncoding || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const layers = [];
  let body = buf;
  let skippedDoubleGzip = false;

  const claimsGzip = contentEncoding.some((c) => c === "gzip" || c === "x-gzip");
  if (claimsGzip) {
    if (isGzipMagic(body)) {
      body = safeGunzip(body, { maxOutput: limits.maxGzipOutput });
      layers.push("content-encoding-gzip");
    } else {
      // Runtime already decompressed — do not gunzip again.
      layers.push("content-encoding-gzip-already-decoded");
      skippedDoubleGzip = true;
    }
  }

  let gzipCount = claimsGzip && !skippedDoubleGzip ? 1 : 0;
  while (isGzipMagic(body) && gzipCount < limits.maxGzipLayers) {
    body = safeGunzip(body, { maxOutput: limits.maxGzipOutput });
    layers.push("gzip-magic");
    gzipCount += 1;
  }
  if (isGzipMagic(body)) {
    throw Object.assign(new Error("tmc_gzip_too_many_layers"), { code: "TMC_GZIP_LAYERS" });
  }

  return { body, layers, skippedDoubleGzip };
}

/** Sanitized path-reject categories (never include raw entry names). */
export const TMC_PATH_REJECT = Object.freeze({
  ABSOLUTE: "TMC_PATH_ABSOLUTE",
  PARENT_TRAVERSAL: "TMC_PATH_PARENT_TRAVERSAL",
  BACKSLASH: "TMC_PATH_BACKSLASH",
  CONTROL_CHAR: "TMC_PATH_CONTROL_CHAR",
  EMPTY: "TMC_PATH_EMPTY",
  DIRECTORY_ENTRY: "TMC_PATH_DIRECTORY_ENTRY",
  DRIVE_PREFIX: "TMC_PATH_DRIVE_PREFIX",
  NORMALIZATION_CHANGED: "TMC_PATH_NORMALIZATION_CHANGED",
  DUPLICATE: "TMC_PATH_DUPLICATE",
  TOO_LONG: "TMC_PATH_TOO_LONG",
  DEPTH_EXCEEDED: "TMC_PATH_DEPTH_EXCEEDED",
  UNSUPPORTED_ENCODING: "TMC_PATH_UNSUPPORTED_ENCODING",
  OTHER: "TMC_PATH_OTHER",
});

/**
 * Classify / normalize a ZIP entry name without echoing the raw name.
 * Safe relative directory entries (trailing `/`) are allowed as non-extracted
 * markers — TISA location-table ZIPs commonly include them.
 *
 * @param {string} nameRaw
 * @param {{ maxDepth?: number, maxNameLen?: number }} [opts]
 */
export function classifyZipPath(nameRaw, opts = {}) {
  const maxDepth = opts.maxDepth != null ? opts.maxDepth : DEFAULT_ZIP_LIMITS.maxPathDepth;
  const maxNameLen = opts.maxNameLen != null ? opts.maxNameLen : DEFAULT_ZIP_LIMITS.maxNameLen;
  if (nameRaw == null || typeof nameRaw !== "string") {
    return {
      ok: false,
      isDirectory: false,
      path: null,
      category: nameRaw == null ? TMC_PATH_REJECT.EMPTY : TMC_PATH_REJECT.UNSUPPORTED_ENCODING,
      hadBackslash: false,
    };
  }
  const hadBackslash = nameRaw.includes("\\");
  // ZIP AppNote uses `/`; bare `\` is rejected (no silent rewrite that hides traversal).
  if (hadBackslash) {
    return {
      ok: false,
      isDirectory: false,
      path: null,
      category: TMC_PATH_REJECT.BACKSLASH,
      hadBackslash: true,
    };
  }
  if (!nameRaw) {
    return { ok: false, isDirectory: false, path: null, category: TMC_PATH_REJECT.EMPTY, hadBackslash: false };
  }
  if (nameRaw.length > maxNameLen) {
    return {
      ok: false,
      isDirectory: false,
      path: null,
      category: TMC_PATH_REJECT.TOO_LONG,
      hadBackslash: false,
    };
  }
  for (let i = 0; i < nameRaw.length; i++) {
    const c = nameRaw.charCodeAt(i);
    if (c === 0 || c < 0x20) {
      return {
        ok: false,
        isDirectory: false,
        path: null,
        category: TMC_PATH_REJECT.CONTROL_CHAR,
        hadBackslash: false,
      };
    }
  }
  if (nameRaw.startsWith("/")) {
    return {
      ok: false,
      isDirectory: false,
      path: null,
      category: TMC_PATH_REJECT.ABSOLUTE,
      hadBackslash: false,
    };
  }
  if (/^[a-zA-Z]:/.test(nameRaw)) {
    return {
      ok: false,
      isDirectory: false,
      path: null,
      category: TMC_PATH_REJECT.DRIVE_PREFIX,
      hadBackslash: false,
    };
  }

  const isDirectory = nameRaw.endsWith("/");
  const trimmed = isDirectory ? nameRaw.slice(0, -1) : nameRaw;
  if (!trimmed) {
    return {
      ok: false,
      isDirectory: true,
      path: null,
      category: TMC_PATH_REJECT.ABSOLUTE,
      hadBackslash: false,
    };
  }
  const parts = trimmed.split("/");
  if (parts.some((p) => p === "..")) {
    return {
      ok: false,
      isDirectory,
      path: null,
      category: TMC_PATH_REJECT.PARENT_TRAVERSAL,
      hadBackslash: false,
    };
  }
  if (parts.some((p) => p === "")) {
    return {
      ok: false,
      isDirectory,
      path: null,
      category: TMC_PATH_REJECT.OTHER,
      hadBackslash: false,
    };
  }
  if (parts.length > maxDepth) {
    return {
      ok: false,
      isDirectory,
      path: null,
      category: TMC_PATH_REJECT.DEPTH_EXCEEDED,
      hadBackslash: false,
    };
  }
  const normalized = parts.join("/");
  try {
    if (normalized.normalize("NFC") !== normalized) {
      return {
        ok: false,
        isDirectory,
        path: null,
        category: TMC_PATH_REJECT.NORMALIZATION_CHANGED,
        hadBackslash: false,
      };
    }
  } catch (_) {
    return {
      ok: false,
      isDirectory,
      path: null,
      category: TMC_PATH_REJECT.UNSUPPORTED_ENCODING,
      hadBackslash: false,
    };
  }
  return {
    ok: true,
    isDirectory,
    path: normalized,
    category: isDirectory ? TMC_PATH_REJECT.DIRECTORY_ENTRY : null,
    hadBackslash: false,
  };
}

/**
 * Aggregate ZIP size/path metadata from local headers without decompressing payloads
 * and without retaining entry names.
 * @param {Buffer} buf
 * @param {{ limits?: Partial<typeof DEFAULT_ZIP_LIMITS> }} [opts]
 */
export function inspectZipDeclaredMetadata(buf, opts = {}) {
  const limits = { ...DEFAULT_ZIP_LIMITS, ...(opts.limits || {}) };
  const meta = {
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
    archiveValidationStage: "central_declared",
    fileExtSummary: Object.create(null),
    limitsApplied: {
      maxSingleUncompressed: limits.maxSingleUncompressed,
      maxUncompressedTotal: limits.maxUncompressedTotal,
      maxCompressedTotal: limits.maxCompressedTotal,
      maxCompressionRatio: limits.maxCompressionRatio,
      prevMaxSingleUncompressed: TMC_ZIP_LIMITS_PREV.maxSingleUncompressed,
    },
  };
  if (!Buffer.isBuffer(buf) || buf.length < 4) {
    meta.archiveValidationStage = "empty";
    return meta;
  }
  if (buf.length > limits.maxCompressedTotal) {
    meta.archiveValidationStage = "compressed_total_exceeded";
    meta.entrySizeRejectCategory = "TMC_SIZE_COMPRESSED_TOTAL";
    return meta;
  }

  let cOff = 0;
  while (cOff + 46 <= buf.length) {
    const sig = buf.readUInt32LE(cOff);
    if (sig !== CENTRAL_SIG) {
      cOff += 1;
      continue;
    }
    meta.centralEntryCount += 1;
    const nameLen = buf.readUInt16LE(cOff + 28);
    const extraLen = buf.readUInt16LE(cOff + 30);
    const commentLen = buf.readUInt16LE(cOff + 32);
    const flags = buf.readUInt16LE(cOff + 8);
    if (flags & 0x1) meta.encryptedEntryCount += 1;
    const comp = buf.readUInt32LE(cOff + 20);
    const uncomp = buf.readUInt32LE(cOff + 24);
    if (comp === 0xffffffff || uncomp === 0xffffffff) meta.zip64EntryCount += 1;
    cOff += 46 + nameLen + extraLen + commentLen;
  }

  const seen = new Set();
  const seenFold = new Set();
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== LOCAL_SIG) break;
    const method = buf.readUInt16LE(offset + 8);
    const flags = buf.readUInt16LE(offset + 6);
    const compSize = buf.readUInt32LE(offset + 18);
    const uncompSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    if (nameLen > limits.maxNameLen || dataStart > buf.length) {
      meta.archiveValidationStage = "truncated";
      break;
    }
    if (flags & 0x1) meta.encryptedEntryCount += 1;
    if (compSize === 0xffffffff || uncompSize === 0xffffffff) meta.zip64EntryCount += 1;
    if (method !== 0 && method !== 8) meta.unsupportedEntryTypeCount += 1;

    let nameRaw = "";
    try {
      nameRaw = buf.slice(nameStart, nameStart + nameLen).toString("utf8");
    } catch (_) {
      meta.pathRejectCategory = TMC_PATH_REJECT.UNSUPPORTED_ENCODING;
      meta.pathRejectCounts[TMC_PATH_REJECT.UNSUPPORTED_ENCODING] =
        (meta.pathRejectCounts[TMC_PATH_REJECT.UNSUPPORTED_ENCODING] || 0) + 1;
      break;
    }
    const classified = classifyZipPath(nameRaw, {
      maxDepth: limits.maxPathDepth,
      maxNameLen: limits.maxNameLen,
    });
    // Drop name immediately — only keep aggregates
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
      offset = dataStart + compSize;
      continue;
    }
    meta.fileEntryCount += 1;
    meta.declaredCompressedTotalBytes += compSize;
    meta.declaredUncompressedTotalBytes += uncompSize;
    if (compSize > meta.maxDeclaredCompressedEntryBytes) meta.maxDeclaredCompressedEntryBytes = compSize;
    if (uncompSize > meta.maxDeclaredUncompressedEntryBytes) meta.maxDeclaredUncompressedEntryBytes = uncompSize;
    if (compSize > 0) {
      const ratio = uncompSize / compSize;
      if (ratio > meta.maxObservedCompressionRatio) meta.maxObservedCompressionRatio = Math.round(ratio * 100) / 100;
    }
    if (uncompSize > limits.maxSingleUncompressed) {
      meta.entriesOverCurrentPerEntryLimit += 1;
      meta.entrySizeRejectCategory = "TMC_SIZE_PER_ENTRY";
    }
    const pathKey = classified.path;
    if (seen.has(pathKey) || seenFold.has(pathKey.toLowerCase())) {
      meta.duplicateEntryCount += 1;
    } else {
      seen.add(pathKey);
      seenFold.add(pathKey.toLowerCase());
    }
    const ext = String(pathKey).toLowerCase().match(/\.([a-z0-9]+)$/);
    const extKey = ext ? ext[1] : "none";
    meta.fileExtSummary[extKey] = (meta.fileExtSummary[extKey] || 0) + 1;
    offset = dataStart + Math.min(compSize, Math.max(0, buf.length - dataStart));
  }

  if (meta.declaredUncompressedTotalBytes > limits.maxUncompressedTotal) {
    meta.totalOverCurrentUncompressedLimit = true;
    if (!meta.entrySizeRejectCategory) meta.entrySizeRejectCategory = "TMC_SIZE_TOTAL_UNCOMPRESSED";
  }
  if (meta.entriesOverCurrentPerEntryLimit > 0 && !meta.entrySizeRejectCategory) {
    meta.entrySizeRejectCategory = "TMC_SIZE_PER_ENTRY";
  }
  return meta;
}

function assertNoSymlinksInCentral(buf) {
  // Unix symlink mode in external attrs high 16 bits: 0120000 (0o120000) → 0xA000
  let offset = 0;
  while (offset + 46 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== CENTRAL_SIG) {
      offset += 1;
      continue;
    }
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const externalAttrs = buf.readUInt32LE(offset + 38);
    const mode = (externalAttrs >>> 16) & 0xffff;
    if ((mode & 0xf000) === 0xa000) {
      throw Object.assign(new Error("tmc_zip_symlink"), { code: "TMC_ZIP_SYMLINK" });
    }
    // Reject DOS volume / device-ish oddities when unix mode marks fifo/chr/blk
    if ((mode & 0xf000) === 0x1000 || (mode & 0xf000) === 0x2000 || (mode & 0xf000) === 0x6000) {
      throw Object.assign(new Error("tmc_zip_special_file"), { code: "TMC_ZIP_SPECIAL" });
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
}

/**
 * @param {Buffer} buf
 * @param {{ limits?: Partial<typeof DEFAULT_ZIP_LIMITS> }} [opts]
 * @returns {{ name: string, data: Buffer }[] & { diagnostics?: object }}
 */
export function safeUnzipEntries(buf, opts = {}) {
  const limits = { ...DEFAULT_ZIP_LIMITS, ...(opts.limits || {}) };
  if (!Buffer.isBuffer(buf) || buf.length < 4) {
    throw Object.assign(new Error("tmc_zip_empty"), { code: "TMC_ZIP_EMPTY" });
  }
  if (buf.length > limits.maxCompressedTotal) {
    throw Object.assign(new Error("tmc_zip_too_large"), { code: "TMC_ZIP_TOO_LARGE" });
  }
  if (!isZipMagic(buf)) {
    throw Object.assign(new Error("tmc_zip_magic"), { code: "TMC_ZIP_MAGIC" });
  }

  assertNoSymlinksInCentral(buf);

  const out = [];
  let offset = 0;
  let uncompressedTotal = 0;
  let centralEntryCount = 0;
  let directoryEntryCount = 0;
  const pathRejectCounts = Object.create(null);
  const seen = new Set();
  const seenFold = new Set();
  const fileExtSummary = Object.create(null);

  // Count central-directory entries for sanitized diagnostics (no names).
  {
    let cOff = 0;
    while (cOff + 46 <= buf.length) {
      const sig = buf.readUInt32LE(cOff);
      if (sig !== CENTRAL_SIG) {
        cOff += 1;
        continue;
      }
      centralEntryCount += 1;
      const nameLen = buf.readUInt16LE(cOff + 28);
      const extraLen = buf.readUInt16LE(cOff + 30);
      const commentLen = buf.readUInt16LE(cOff + 32);
      cOff += 46 + nameLen + extraLen + commentLen;
    }
  }

  function bumpReject(cat) {
    pathRejectCounts[cat] = (pathRejectCounts[cat] || 0) + 1;
  }

  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== LOCAL_SIG) break;
    if (out.length + directoryEntryCount >= limits.maxEntries) {
      throw Object.assign(new Error("tmc_zip_too_many_entries"), { code: "TMC_ZIP_TOO_MANY" });
    }
    const method = buf.readUInt16LE(offset + 8);
    const flags = buf.readUInt16LE(offset + 6);
    const compSize = buf.readUInt32LE(offset + 18);
    const uncompSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    if (nameLen > limits.maxNameLen || dataStart + compSize > buf.length) {
      throw Object.assign(new Error("tmc_zip_truncated"), { code: "TMC_ZIP_TRUNCATED" });
    }
    if (flags & 0x1) {
      throw Object.assign(new Error("tmc_zip_encrypted"), { code: "TMC_ZIP_ENCRYPTED" });
    }
    let nameRaw;
    try {
      nameRaw = buf.slice(nameStart, nameStart + nameLen).toString("utf8");
    } catch (_) {
      const err = Object.assign(new Error("tmc_zip_bad_path"), {
        code: "TMC_ZIP_BAD_PATH",
        pathRejectCategory: TMC_PATH_REJECT.UNSUPPORTED_ENCODING,
      });
      bumpReject(TMC_PATH_REJECT.UNSUPPORTED_ENCODING);
      throw err;
    }
    const classified = classifyZipPath(nameRaw, {
      maxDepth: limits.maxPathDepth,
      maxNameLen: limits.maxNameLen,
    });
    if (!classified.ok) {
      const err = Object.assign(new Error("tmc_zip_bad_path"), {
        code: "TMC_ZIP_BAD_PATH",
        pathRejectCategory: classified.category || TMC_PATH_REJECT.OTHER,
        isDirectoryEntry: classified.isDirectory === true,
        pathDiagnostics: {
          pathRejectCategory: classified.category || TMC_PATH_REJECT.OTHER,
          pathRejectCounts: {
            ...(pathRejectCounts || {}),
            [classified.category || TMC_PATH_REJECT.OTHER]:
              (pathRejectCounts[classified.category || TMC_PATH_REJECT.OTHER] || 0) + 1,
          },
          isDirectoryEntry: classified.isDirectory === true,
          directoryEntryCount,
          fileEntryCount: out.length,
          centralEntryCount,
          fileExtSummary,
          safeDirectoryEntriesAllowed: true,
        },
      });
      bumpReject(classified.category || TMC_PATH_REJECT.OTHER);
      throw err;
    }

    // Safe directory entries: skip extraction, do not count as file payload.
    if (classified.isDirectory) {
      directoryEntryCount += 1;
      if (uncompSize !== 0 || compSize !== 0) {
        // Directory with payload is unexpected — fail closed.
        const err = Object.assign(new Error("tmc_zip_bad_path"), {
          code: "TMC_ZIP_BAD_PATH",
          pathRejectCategory: TMC_PATH_REJECT.OTHER,
          isDirectoryEntry: true,
        });
        bumpReject(TMC_PATH_REJECT.OTHER);
        throw err;
      }
      offset = dataStart + compSize;
      continue;
    }

    const name = classified.path;
    if (seen.has(name)) {
      const err = Object.assign(new Error("tmc_zip_bad_path"), {
        code: "TMC_ZIP_BAD_PATH",
        pathRejectCategory: TMC_PATH_REJECT.DUPLICATE,
      });
      bumpReject(TMC_PATH_REJECT.DUPLICATE);
      throw err;
    }
    const fold = name.toLowerCase();
    if (seenFold.has(fold)) {
      const err = Object.assign(new Error("tmc_zip_bad_path"), {
        code: "TMC_ZIP_BAD_PATH",
        pathRejectCategory: TMC_PATH_REJECT.DUPLICATE,
      });
      bumpReject(TMC_PATH_REJECT.DUPLICATE);
      throw err;
    }
    seen.add(name);
    seenFold.add(fold);

    if (uncompSize > limits.maxSingleUncompressed) {
      const meta = inspectZipDeclaredMetadata(buf, { limits });
      throw Object.assign(new Error("tmc_zip_entry_too_large"), {
        code: "TMC_ZIP_ENTRY_TOO_LARGE",
        entrySizeRejectCategory: "TMC_SIZE_PER_ENTRY",
        pathDiagnostics: meta,
        zipMetadata: meta,
      });
    }
    if (compSize > 0 && uncompSize / compSize > limits.maxCompressionRatio) {
      throw Object.assign(new Error("tmc_zip_ratio"), { code: "TMC_ZIP_RATIO" });
    }
    uncompressedTotal += uncompSize;
    if (uncompressedTotal > limits.maxUncompressedTotal) {
      throw Object.assign(new Error("tmc_zip_bomb"), { code: "TMC_ZIP_BOMB" });
    }

    const compressed = buf.slice(dataStart, dataStart + compSize);
    let data;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressed, { maxOutputLength: limits.maxSingleUncompressed });
    } else {
      throw Object.assign(new Error("tmc_zip_method"), { code: "TMC_ZIP_METHOD", method });
    }
    if (uncompSize > 0 && data.length !== uncompSize) {
      if (uncompSize !== 0) {
        throw Object.assign(new Error("tmc_zip_size_mismatch"), { code: "TMC_ZIP_SIZE_MISMATCH" });
      }
    }
    if (isZipMagic(data) || isGzipMagic(data)) {
      throw Object.assign(new Error("tmc_zip_nested_archive"), { code: "TMC_ZIP_NESTED" });
    }
    const ext = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    const extKey = ext ? ext[1] : "none";
    fileExtSummary[extKey] = (fileExtSummary[extKey] || 0) + 1;
    out.push({ name, data });
    offset = dataStart + compSize;
  }

  if (!out.length) {
    throw Object.assign(new Error("tmc_zip_no_entries"), {
      code: "TMC_ZIP_NO_ENTRIES",
      pathDiagnostics: {
        centralEntryCount,
        directoryEntryCount,
        fileEntryCount: 0,
        pathRejectCounts,
        fileExtSummary,
      },
    });
  }
  out.diagnostics = {
    centralEntryCount: centralEntryCount || out.length + directoryEntryCount,
    directoryEntryCount,
    fileEntryCount: out.length,
    pathRejectCounts,
    fileExtSummary,
    safeDirectoryEntriesAllowed: true,
  };
  return out;
}

/**
 * Build a minimal stored (method 0) ZIP for fixtures/tests.
 * @param {{ name: string, data: Buffer|string }[]} files
 */
export function buildStoredZip(files) {
  const chunks = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(String(f.name), "utf8");
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

/**
 * Build a minimal DEFLATE (method 8) ZIP for fixtures/tests.
 * `inflatePad` appends NUL-free padding (0x41) after `data` before compress so
 * declared uncompressed size can exceed peek budgets without huge source fixtures.
 * @param {{ name: string, data: Buffer|string, inflatePad?: number }[]} files
 */
export function buildDeflatedZip(files) {
  const chunks = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(String(f.name), "utf8");
    const head = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), "utf8");
    const pad = Math.max(0, Math.floor(Number(f.inflatePad) || 0));
    const raw = pad > 0 ? Buffer.concat([head, Buffer.alloc(pad, 0x41)]) : head;
    const compressed = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(8, 10); // DEFLATE
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

function parseFromZipEntries(entries, opts) {
  const jsonCandidates = entries.filter(
    (e) => /\.json$/i.test(e.name) || /^\s*\{/.test(e.data.toString("utf8").slice(0, 32))
  );
  for (const e of jsonCandidates) {
    try {
      return parseTmcTablePayload(e.data.toString("utf8"), opts);
    } catch (_) {
      /* try next */
    }
  }
  const textCandidates = entries.filter(
    (e) => /\.(txt|csv|dat|points)$/i.test(e.name) || /points/i.test(e.name)
  );
  for (const e of textCandidates.length ? textCandidates : entries) {
    const text = e.data.toString("utf8");
    if (!text.trim() || text.includes("\0")) continue;
    try {
      const table = parseTmcTablePayload(text, opts);
      if (table && table.points && Object.keys(table.points).length) return table;
    } catch (_) {
      /* try next */
    }
  }
  throw Object.assign(new Error("tmc_zip_no_parseable_payload"), { code: "TMC_ZIP_NO_PAYLOAD" });
}

/**
 * Merge caller zip limits onto DEFAULT_ZIP_LIMITS.
 * DATEX maxResponseBytes must NEVER clamp TMC unzip / gzip ceilings
 * (real NDIC TMC ~332 MiB declared uncompressed; DATEX body cap is ≤96 MiB).
 * @param {{ limits?: object }} [opts]
 */
export function resolveTmcParseLimits(opts = {}) {
  const limits = { ...DEFAULT_ZIP_LIMITS };
  const incoming = opts.limits || {};
  for (const key of Object.keys(DEFAULT_ZIP_LIMITS)) {
    if (incoming[key] != null && Number.isFinite(Number(incoming[key])) && Number(incoming[key]) > 0) {
      limits[key] = Number(incoming[key]);
    }
  }
  return limits;
}

/**
 * Parse TMC table from download bytes (ZIP / GZIP / plain) with optional Content-Encoding hint.
 * JSON / simple delimited only — SP08001 DAT archives use loadTmcTableFromDownload.
 * @param {Buffer|string} input
 * @param {{ version?: string, limits?: object, contentEncoding?: string }} [opts]
 */
export function parseTmcTableFromDownload(input, opts = {}) {
  const limits = resolveTmcParseLimits(opts);

  let body;
  if (Buffer.isBuffer(input)) {
    const unwrapped = unwrapTmcTransportLayers(input, {
      contentEncoding: opts.contentEncoding,
      limits,
    });
    body = unwrapped.body;
  } else {
    body = Buffer.from(String(input || ""), "utf8");
  }

  if (isZipMagic(body)) {
    const entries = safeUnzipEntries(body, { limits });
    return parseFromZipEntries(entries, opts);
  }

  if (isGzipMagic(body)) {
    throw Object.assign(new Error("tmc_gzip_unresolved"), { code: "TMC_GZIP_UNRESOLVED" });
  }

  // Fail-closed on unknown binary signatures (not JSON/text)
  if (body.length >= 4) {
    const head = body.slice(0, 8);
    const printable = [...head].filter((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)).length;
    if (printable < head.length * 0.75 && !/^\s*[\[{]/.test(body.toString("utf8").slice(0, 16))) {
      throw Object.assign(new Error("tmc_unknown_signature"), { code: "TMC_UNKNOWN_SIGNATURE" });
    }
  }

  const text = body.toString("utf8");
  return parseTmcTablePayload(text, opts);
}

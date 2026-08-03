/**
 * Safe TMC download ingest (server/CI only).
 * Supports: plain JSON/text, ZIP, GZIP, GZIP→ZIP.
 * Content-Encoding: gzip — only gunzip when magic bytes still present
 * (fetch runtimes often auto-decode; never double-decompress on header alone).
 * Never logs Authorization / credentials / raw table contents.
 */
import zlib from "zlib";
import { DEFAULT_LIMITS } from "./config.mjs";
import { parseTmcTablePayload } from "./tmc-table.mjs";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;

export const DEFAULT_ZIP_LIMITS = Object.freeze({
  maxEntries: 64,
  maxUncompressedTotal: 48 * 1024 * 1024,
  maxSingleUncompressed: 32 * 1024 * 1024,
  maxCompressedTotal: 32 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxNameLen: 240,
  maxPathDepth: 8,
  maxGzipLayers: 2,
  maxGzipOutput: 48 * 1024 * 1024,
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

function normalizeZipPath(nameRaw, maxDepth) {
  const n = String(nameRaw || "").replace(/\\/g, "/");
  if (!n || n.includes("\0")) return null;
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n)) return null;
  const parts = n.split("/");
  if (parts.some((p) => p === ".." || p === "")) return null;
  if (parts.length > maxDepth) return null;
  return parts.join("/");
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
 * @returns {{ name: string, data: Buffer }[]}
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

  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== LOCAL_SIG) break;
    if (out.length >= limits.maxEntries) {
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
    // Encrypted entries (bit 0)
    if (flags & 0x1) {
      throw Object.assign(new Error("tmc_zip_encrypted"), { code: "TMC_ZIP_ENCRYPTED" });
    }
    const nameRaw = buf.slice(nameStart, nameStart + nameLen).toString("utf8");
    const name = normalizeZipPath(nameRaw, limits.maxPathDepth);
    if (!name) {
      throw Object.assign(new Error("tmc_zip_bad_path"), { code: "TMC_ZIP_BAD_PATH" });
    }
    if (uncompSize > limits.maxSingleUncompressed) {
      throw Object.assign(new Error("tmc_zip_entry_too_large"), { code: "TMC_ZIP_ENTRY_TOO_LARGE" });
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
    // Nested archives not allowed inside ZIP
    if (isZipMagic(data) || isGzipMagic(data)) {
      throw Object.assign(new Error("tmc_zip_nested_archive"), { code: "TMC_ZIP_NESTED" });
    }
    out.push({ name, data });
    offset = dataStart + compSize;
  }

  if (!out.length) {
    throw Object.assign(new Error("tmc_zip_no_entries"), { code: "TMC_ZIP_NO_ENTRIES" });
  }
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
 * Parse TMC table from download bytes (ZIP / GZIP / plain) with optional Content-Encoding hint.
 * @param {Buffer|string} input
 * @param {{ version?: string, limits?: object, contentEncoding?: string }} [opts]
 */
export function parseTmcTableFromDownload(input, opts = {}) {
  const limits = {
    ...DEFAULT_ZIP_LIMITS,
    maxUncompressedTotal: Math.min(
      DEFAULT_ZIP_LIMITS.maxUncompressedTotal,
      (opts.limits && opts.limits.maxResponseBytes) || DEFAULT_LIMITS.maxResponseBytes
    ),
    maxGzipOutput: Math.min(
      DEFAULT_ZIP_LIMITS.maxGzipOutput,
      (opts.limits && opts.limits.maxResponseBytes) || DEFAULT_LIMITS.maxResponseBytes
    ),
  };

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

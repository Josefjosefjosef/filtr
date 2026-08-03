/**
 * Safe TMC ZIP ingest (server/CI only).
 * - Zip-bomb limits (entry count, uncompressed bytes, compression ratio)
 * - Path traversal blocked
 * - Prefer JSON table payload; fall back to delimited POINTS-like text
 * - Never logs Authorization / credentials
 */
import zlib from "zlib";
import { DEFAULT_LIMITS } from "./config.mjs";
import { parseTmcTablePayload } from "./tmc-table.mjs";

const LOCAL_SIG = 0x04034b50;
const DEFAULT_ZIP_LIMITS = Object.freeze({
  maxEntries: 64,
  maxUncompressedTotal: 48 * 1024 * 1024,
  maxSingleUncompressed: 32 * 1024 * 1024,
  maxCompressedTotal: 32 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxNameLen: 240,
});

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
  if (buf.readUInt32LE(0) !== LOCAL_SIG && !(buf[0] === 0x50 && buf[1] === 0x4b)) {
    throw Object.assign(new Error("tmc_zip_magic"), { code: "TMC_ZIP_MAGIC" });
  }

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
    const compSize = buf.readUInt32LE(offset + 18);
    const uncompSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    if (nameLen > limits.maxNameLen || dataStart + compSize > buf.length) {
      throw Object.assign(new Error("tmc_zip_truncated"), { code: "TMC_ZIP_TRUNCATED" });
    }
    const nameRaw = buf.slice(nameStart, nameStart + nameLen).toString("utf8");
    const name = normalizeZipPath(nameRaw);
    if (!name) {
      throw Object.assign(new Error("tmc_zip_bad_path"), { code: "TMC_ZIP_BAD_PATH", path: nameRaw });
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
      // Some producers leave sizes 0 when data descriptor follows; accept inflate length within cap.
      if (uncompSize !== 0) {
        throw Object.assign(new Error("tmc_zip_size_mismatch"), { code: "TMC_ZIP_SIZE_MISMATCH" });
      }
    }
    out.push({ name, data });
    offset = dataStart + compSize;
  }

  if (!out.length) {
    throw Object.assign(new Error("tmc_zip_no_entries"), { code: "TMC_ZIP_NO_ENTRIES" });
  }
  return out;
}

function normalizeZipPath(nameRaw) {
  const n = String(nameRaw || "").replace(/\\/g, "/");
  if (!n || n.includes("\0")) return null;
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n)) return null;
  const parts = n.split("/");
  if (parts.some((p) => p === "..")) return null;
  return parts.filter(Boolean).join("/");
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
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14); // crc optional for tests
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
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
 * Parse TMC table from ZIP bytes or raw JSON/text.
 * @param {Buffer|string} input
 * @param {{ version?: string, limits?: object }} [opts]
 */
export function parseTmcTableFromDownload(input, opts = {}) {
  if (Buffer.isBuffer(input) && input.length >= 4 && input[0] === 0x50 && input[1] === 0x4b) {
    const entries = safeUnzipEntries(input, {
      limits: {
        maxUncompressedTotal: Math.min(
          DEFAULT_ZIP_LIMITS.maxUncompressedTotal,
          (opts.limits && opts.limits.maxResponseBytes) || DEFAULT_LIMITS.maxResponseBytes
        ),
      },
    });
    // Prefer JSON payloads
    const jsonCandidates = entries.filter((e) => /\.json$/i.test(e.name) || /^\s*\{/.test(e.data.toString("utf8").slice(0, 32)));
    for (const e of jsonCandidates) {
      try {
        return parseTmcTablePayload(e.data.toString("utf8"), opts);
      } catch (_) {
        /* try next */
      }
    }
    // Delimited POINTS-like text
    const textCandidates = entries.filter((e) => /\.(txt|csv|dat|points)$/i.test(e.name) || /points/i.test(e.name));
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
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : String(input || "");
  return parseTmcTablePayload(text, opts);
}

export { DEFAULT_ZIP_LIMITS };

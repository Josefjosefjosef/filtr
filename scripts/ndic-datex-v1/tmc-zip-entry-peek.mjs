/**
 * Bounded streaming ZIP entry peek (STORE / DEFLATE).
 * Never allocates full compressed or uncompressed entry buffers.
 * Never uses inflateRawSync. Never emits basenames or raw headers.
 */
import fs from "node:fs";
import zlib from "node:zlib";

export const PEEK_STATUS = Object.freeze({
  OK: "peek_ok",
  EMPTY_ENTRY: "peek_empty_entry",
  TRUNCATED_AT_LIMIT: "peek_truncated_at_limit",
  DECOMPRESSION_ERROR: "peek_decompression_error",
  TIMEOUT: "peek_timeout",
  UNSUPPORTED_METHOD: "peek_unsupported_method",
  ENCRYPTED_REJECTED: "peek_encrypted_rejected",
  STRUCTURAL_ERROR: "peek_structural_error",
});

/** Compressed read chunk — bounded; never size of whole entry. */
export const PEEK_COMPRESSED_READ_CHUNK = 64 * 1024;
/** Inflate highWaterMark — bounded stream buffer. */
export const PEEK_INFLATE_HIGH_WATER = 16 * 1024;

const LOCAL_SIG = 0x04034b50;

/**
 * @param {string} zipPath
 * @param {{ localOffset: number, method: number, flags: number, comp: number, uncomp: number }} target
 * @param {number} maxOut
 * @param {{ timeoutMs?: number, signal?: AbortSignal, startedAt?: number }} [opts]
 * @returns {Promise<{ status: string, buf: Buffer, bytesRead: number }>}
 */
export function peekZipEntryBytesStreaming(zipPath, target, maxOut, opts = {}) {
  const max = Math.max(1, Math.floor(Number(maxOut) || 1));
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 120_000;
  const startedAt = opts.startedAt || Date.now();
  const signal = opts.signal || null;

  if (!target || typeof target !== "object") {
    return Promise.resolve({ status: PEEK_STATUS.STRUCTURAL_ERROR, buf: Buffer.alloc(0), bytesRead: 0 });
  }
  if (target.flags & 0x1) {
    return Promise.resolve({ status: PEEK_STATUS.ENCRYPTED_REJECTED, buf: Buffer.alloc(0), bytesRead: 0 });
  }
  const method = Number(target.method);
  if (method !== 0 && method !== 8) {
    return Promise.resolve({ status: PEEK_STATUS.UNSUPPORTED_METHOD, buf: Buffer.alloc(0), bytesRead: 0 });
  }

  let fd;
  try {
    fd = fs.openSync(zipPath, "r");
  } catch {
    return Promise.resolve({ status: PEEK_STATUS.STRUCTURAL_ERROR, buf: Buffer.alloc(0), bytesRead: 0 });
  }

  try {
    const lh = Buffer.alloc(30);
    const n = fs.readSync(fd, lh, 0, 30, target.localOffset);
    if (n < 30 || lh.readUInt32LE(0) !== LOCAL_SIG) {
      fs.closeSync(fd);
      fd = null;
      return Promise.resolve({ status: PEEK_STATUS.STRUCTURAL_ERROR, buf: Buffer.alloc(0), bytesRead: 0 });
    }
    const nameLen = lh.readUInt16LE(26);
    const extraLen = lh.readUInt16LE(28);
    if (nameLen > 512 || extraLen > 1024) {
      fs.closeSync(fd);
      fd = null;
      return Promise.resolve({ status: PEEK_STATUS.STRUCTURAL_ERROR, buf: Buffer.alloc(0), bytesRead: 0 });
    }
    const dataStart = target.localOffset + 30 + nameLen + extraLen;
    const compSize = Math.max(0, Number(target.comp) || 0);
    const uncompSize = Math.max(0, Number(target.uncomp) || 0);

    if (method === 0) {
      const want = Math.min(max, uncompSize > 0 ? uncompSize : max);
      if (want === 0) {
        fs.closeSync(fd);
        fd = null;
        return Promise.resolve({ status: PEEK_STATUS.EMPTY_ENTRY, buf: Buffer.alloc(0), bytesRead: 0 });
      }
      if (Date.now() - startedAt > timeoutMs || (signal && signal.aborted)) {
        fs.closeSync(fd);
        fd = null;
        return Promise.resolve({ status: PEEK_STATUS.TIMEOUT, buf: Buffer.alloc(0), bytesRead: 0 });
      }
      const buf = Buffer.alloc(want);
      const got = fs.readSync(fd, buf, 0, want, dataStart);
      fs.closeSync(fd);
      fd = null;
      const out = buf.subarray(0, got);
      if (got === 0) return Promise.resolve({ status: PEEK_STATUS.EMPTY_ENTRY, buf: Buffer.alloc(0), bytesRead: 0 });
      if (uncompSize > got || got >= max) {
        return Promise.resolve({
          status: got >= max ? PEEK_STATUS.TRUNCATED_AT_LIMIT : PEEK_STATUS.OK,
          buf: out,
          bytesRead: got,
        });
      }
      return Promise.resolve({ status: PEEK_STATUS.OK, buf: out, bytesRead: got });
    }

    // DEFLATE: stream compressed bytes from file in bounded chunks → createInflateRaw → cap output.
    fs.closeSync(fd);
    fd = null;
    return peekDeflateStreaming(zipPath, dataStart, compSize, max, {
      timeoutMs,
      startedAt,
      signal,
    });
  } catch {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch (_) {}
    }
    return Promise.resolve({ status: PEEK_STATUS.STRUCTURAL_ERROR, buf: Buffer.alloc(0), bytesRead: 0 });
  }
}

/**
 * @param {string} zipPath
 * @param {number} dataStart
 * @param {number} compSize
 * @param {number} maxOut
 * @param {{ timeoutMs: number, startedAt: number, signal: AbortSignal|null }} opts
 */
function peekDeflateStreaming(zipPath, dataStart, compSize, maxOut, opts) {
  return new Promise((resolve) => {
    if (compSize <= 0) {
      resolve({ status: PEEK_STATUS.EMPTY_ENTRY, buf: Buffer.alloc(0), bytesRead: 0 });
      return;
    }

    const chunks = [];
    let outLen = 0;
    let done = false;
    let intentionalTruncation = false;
    let timedOut = false;
    let decompressErr = false;

    const finish = (status) => {
      if (done) return;
      done = true;
      try {
        rs.destroy();
      } catch (_) {}
      try {
        infl.destroy();
      } catch (_) {}
      if (timer) clearTimeout(timer);
      if (opts.signal) {
        try {
          opts.signal.removeEventListener("abort", onAbort);
        } catch (_) {}
      }
      const buf = outLen ? Buffer.concat(chunks, outLen) : Buffer.alloc(0);
      resolve({ status, buf, bytesRead: outLen });
    };

    const onAbort = () => {
      timedOut = true;
      finish(PEEK_STATUS.TIMEOUT);
    };

    let timer = null;
    const remaining = Math.max(1, opts.timeoutMs - (Date.now() - opts.startedAt));
    timer = setTimeout(() => {
      timedOut = true;
      finish(PEEK_STATUS.TIMEOUT);
    }, remaining);

    if (opts.signal) {
      if (opts.signal.aborted) {
        finish(PEEK_STATUS.TIMEOUT);
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    const end = dataStart + compSize - 1;
    const rs = fs.createReadStream(zipPath, {
      start: dataStart,
      end,
      highWaterMark: PEEK_COMPRESSED_READ_CHUNK,
    });
    const infl = zlib.createInflateRaw({
      highWaterMark: PEEK_INFLATE_HIGH_WATER,
    });

    infl.on("data", (chunk) => {
      if (done) return;
      if (!chunk || !chunk.length) return;
      if (outLen >= maxOut) {
        intentionalTruncation = true;
        finish(PEEK_STATUS.TRUNCATED_AT_LIMIT);
        return;
      }
      const take = Math.min(chunk.length, maxOut - outLen);
      chunks.push(take === chunk.length ? chunk : chunk.subarray(0, take));
      outLen += take;
      if (outLen >= maxOut) {
        intentionalTruncation = true;
        finish(PEEK_STATUS.TRUNCATED_AT_LIMIT);
      }
    });

    infl.on("error", (err) => {
      if (done || intentionalTruncation) return;
      // Z_BUF_ERROR / premature end after intentional destroy — ignore
      const msg = err && err.message ? String(err.message) : "";
      if (/unexpected end|buffer error/i.test(msg) && outLen > 0 && intentionalTruncation) return;
      decompressErr = true;
      finish(PEEK_STATUS.DECOMPRESSION_ERROR);
    });

    infl.on("end", () => {
      if (done) return;
      if (timedOut) return;
      if (outLen === 0) finish(PEEK_STATUS.EMPTY_ENTRY);
      else if (outLen >= maxOut) finish(PEEK_STATUS.TRUNCATED_AT_LIMIT);
      else finish(PEEK_STATUS.OK);
    });

    rs.on("error", () => {
      if (done || intentionalTruncation) return;
      finish(PEEK_STATUS.STRUCTURAL_ERROR);
    });

    rs.pipe(infl);
  });
}

/**
 * Extract first complete SP08001 logical record line (CRLF) from a peek buffer.
 * Does not return the raw line to callers that serialize reports — only status + field parse helpers.
 * @param {Buffer} buf
 * @param {{ maxHeaderBytes?: number, maxFields?: number }} [opts]
 */
export function extractFirstLogicalHeaderLine(buf, opts = {}) {
  const maxHeaderBytes = opts.maxHeaderBytes != null ? opts.maxHeaderBytes : 1024;
  const maxFields = opts.maxFields != null ? opts.maxFields : 64;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.alloc(0);
  if (!b.length) {
    return { status: "empty", complete: false, lineEnding: "none", fieldCount: 0, hasNul: false };
  }
  let hasNul = false;
  const n = Math.min(b.length, maxHeaderBytes + 2);
  for (let i = 0; i < n; i++) {
    if (b[i] === 0) {
      hasNul = true;
      break;
    }
  }
  if (hasNul) {
    return { status: "binary_rejected", complete: false, lineEnding: "none", fieldCount: 0, hasNul: true };
  }

  let inQuotes = false;
  let i = 0;
  // Skip UTF-8 BOM only (UNDEFINED_BY_SP08001 — tolerated as stream marker, not required).
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;

  let sawCr = false;
  for (; i < b.length && i < maxHeaderBytes + 4; i++) {
    const ch = b[i];
    if (ch === 0x22) {
      // double quote — toggle unless escaped ""
      if (inQuotes && i + 1 < b.length && b[i + 1] === 0x22) {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === 0x0d) {
      sawCr = true;
      if (i + 1 < b.length && b[i + 1] === 0x0a) {
        const lineBuf = b.subarray(b[0] === 0xef ? 3 : 0, i);
        if (lineBuf.length === 0) {
          return { status: "empty_line", complete: false, lineEnding: "crlf", fieldCount: 0, hasNul: false };
        }
        if (lineBuf.length > maxHeaderBytes) {
          return { status: "header_too_long", complete: false, lineEnding: "crlf", fieldCount: 0, hasNul: false };
        }
        // field count via semicolon outside quotes (no raw emission)
        let fields = 1;
        let q = false;
        for (let j = 0; j < lineBuf.length; j++) {
          const c = lineBuf[j];
          if (c === 0x22) {
            if (q && j + 1 < lineBuf.length && lineBuf[j + 1] === 0x22) {
              j += 1;
              continue;
            }
            q = !q;
            continue;
          }
          if (!q && c === 0x3b) fields += 1;
        }
        if (fields > maxFields) {
          return { status: "too_many_fields", complete: true, lineEnding: "crlf", fieldCount: fields, hasNul: false };
        }
        return {
          status: "complete_crlf",
          complete: true,
          lineEnding: "crlf",
          fieldCount: fields,
          hasNul: false,
          headerByteLength: lineBuf.length,
        };
      }
      // CR without LF yet — may be chunk boundary if buffer ends
      if (i + 1 >= b.length) {
        return { status: "incomplete_cr_boundary", complete: false, lineEnding: "cr", fieldCount: 0, hasNul: false };
      }
      return { status: "lf_only_or_broken", complete: false, lineEnding: "cr_without_lf", fieldCount: 0, hasNul: false };
    }
    if (!inQuotes && ch === 0x0a && !sawCr) {
      return { status: "lf_only", complete: false, lineEnding: "lf", fieldCount: 0, hasNul: false };
    }
  }
  if (b.length >= maxHeaderBytes) {
    return { status: "header_too_long", complete: false, lineEnding: "none", fieldCount: 0, hasNul: false };
  }
  return { status: "incomplete_no_crlf", complete: false, lineEnding: "none", fieldCount: 0, hasNul: false };
}

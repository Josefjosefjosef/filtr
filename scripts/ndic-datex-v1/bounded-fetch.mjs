/**
 * Bounded HTTP body ingest for NDIC DATEX/TMC (server/CI only).
 *
 * - Streams Response body to an isolated temp file
 * - Enforces maxBytes on Content-Length (advisory) AND actual received bytes
 * - Aborts immediately on oversize; always cleans up on error/abort
 * - Never logs URLs, credentials, or raw payload bytes
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";

/**
 * Documented DATEX snapshot ceiling for the Czech NDIC VPS (1 GiB RAM / 10 GiB disk).
 *
 * Observed real shadow body ≈ 56_252_428 B (~53.7 MiB).
 * Chosen hard limit: 80 MiB = 83_886_080 B
 *   - headroom vs current ≈ +49% (growth / encoding / headers)
 *   - disk peak: one DATEX temp ≤ 80 MiB + TMC ZIP ≤ ~32 MiB compressed + report ≪ 1 MiB
 *   - memory peak (after unlink): UTF-16 JS string ≈ 2× file + DOM tree (bounded by maxElements/depth)
 *     worst-case planning budget ≈ 80 + 160 + ~250 ≈ 490 MiB ≪ 1 GiB with OS/runtime reserve
 */
export const DATEX_MAX_RESPONSE_BYTES = 80 * 1024 * 1024;
/** Previous hard-coded shadow probe ceiling (for regression docs). */
export const DATEX_PREV_RESPONSE_BYTES = 32 * 1024 * 1024;

/**
 * @param {number} maxBytes
 * @param {string} [prefix]
 * @param {{ baseDir?: string }} [opts] — when set, temp lives under task-owned base (not os.tmpdir()).
 */
export function createBoundedTempPath(prefix = "ndic-body-", opts = {}) {
  const base =
    (opts && opts.baseDir) ||
    process.env.IU_NDIC_SHADOW_WORK_DIR ||
    process.env.RUNNER_TEMP ||
    null;
  const parent = base ? base : os.tmpdir();
  if (base) {
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  }
  const dir = fs.mkdtempSync(path.join(parent, prefix));
  try {
    fs.chmodSync(dir, 0o700);
  } catch (_) {}
  return { dir, file: path.join(dir, "body.bin"), baseDir: parent };
}

/**
 * Transform that counts bytes and fails closed when maxBytes exceeded.
 * @param {number} maxBytes
 */
export function createByteLimitTransform(maxBytes) {
  let received = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > maxBytes) {
        const err = Object.assign(new Error("response_too_large"), {
          code: "RESPONSE_TOO_LARGE",
          received,
          maxBytes,
        });
        cb(err);
        return;
      }
      cb(null, chunk);
    },
  });
}

/**
 * Stream a Fetch API Response body to a temp file with hard size bound.
 * @param {Response} res
 * @param {{ maxBytes: number, destFile: string, signal?: AbortSignal }} opts
 * @returns {Promise<{ bytes: number, file: string, contentLengthHeader: number|null, truncated: boolean }>}
 */
export async function streamResponseToFileBounded(res, opts) {
  const maxBytes = opts.maxBytes;
  const destFile = opts.destFile;
  const signal = opts.signal;

  const clRaw = res.headers && res.headers.get ? res.headers.get("content-length") : null;
  let contentLengthHeader = null;
  if (clRaw != null && String(clRaw).trim() !== "") {
    const n = Number(clRaw);
    if (Number.isFinite(n) && n >= 0) contentLengthHeader = n;
  }
  // Advisory only: reject early if declared size already exceeds cap.
  if (contentLengthHeader != null && contentLengthHeader > maxBytes) {
    throw Object.assign(new Error("response_too_large_content_length"), {
      code: "RESPONSE_TOO_LARGE",
      contentLengthHeader,
      maxBytes,
    });
  }

  if (!res.body) {
    // Fallback for environments without body stream
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length > maxBytes) {
      throw Object.assign(new Error("response_too_large"), {
        code: "RESPONSE_TOO_LARGE",
        received: buf.length,
        maxBytes,
      });
    }
    fs.writeFileSync(destFile, buf);
    return {
      bytes: buf.length,
      file: destFile,
      contentLengthHeader,
      truncated: false,
    };
  }

  const nodeReadable = Readable.fromWeb(res.body);
  const limiter = createByteLimitTransform(maxBytes);
  const out = fs.createWriteStream(destFile, { flags: "w", mode: 0o600 });

  const onAbort = () => {
    try {
      nodeReadable.destroy();
    } catch (_) {}
    try {
      out.destroy();
    } catch (_) {}
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    await pipeline(nodeReadable, limiter, out);
  } catch (e) {
    try {
      fs.unlinkSync(destFile);
    } catch (_) {}
    throw e;
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }

  const st = fs.statSync(destFile);
  if (st.size > maxBytes) {
    try {
      fs.unlinkSync(destFile);
    } catch (_) {}
    throw Object.assign(new Error("response_too_large"), {
      code: "RESPONSE_TOO_LARGE",
      received: st.size,
      maxBytes,
    });
  }
  return {
    bytes: st.size,
    file: destFile,
    contentLengthHeader,
    truncated: false,
  };
}

/**
 * Read bounded file into Buffer, then optionally unlink (caller owns cleanup of dir).
 * @param {string} file
 * @param {number} maxBytes
 */
export function readBoundedFile(file, maxBytes) {
  const st = fs.statSync(file);
  if (st.size > maxBytes) {
    throw Object.assign(new Error("response_too_large"), {
      code: "RESPONSE_TOO_LARGE",
      received: st.size,
      maxBytes,
    });
  }
  return fs.readFileSync(file);
}

/**
 * Wipe temp dir tree (best-effort).
 * @param {string} dir
 */
export function wipeTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

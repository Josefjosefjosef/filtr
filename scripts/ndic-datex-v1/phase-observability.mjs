/**
 * Safe NDIC phase timing / conditional-request metrics (no secrets, no raw URLs).
 * Observability only — never changes business outcomes.
 */
import crypto from "crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

export function safeEtagHash(etag) {
  if (etag == null || etag === "") return null;
  return crypto.createHash("sha256").update(String(etag)).digest("hex").slice(0, 16);
}

/**
 * @returns {{ mark: (name: string) => void, finish: (name: string) => void, snapshot: () => object, durationMs: (name: string) => number|null }}
 */
export function createPhaseTimer() {
  /** @type {Record<string, { startedAt?: string, finishedAt?: string, startedMono?: number, finishedMono?: number }>} */
  const phases = Object.create(null);

  function mark(name) {
    const key = String(name || "");
    if (!key) return;
    phases[key] = {
      startedAt: nowIso(),
      startedMono: monotonicMs(),
    };
  }

  function finish(name) {
    const key = String(name || "");
    const p = phases[key];
    if (!p) {
      phases[key] = { finishedAt: nowIso(), finishedMono: monotonicMs() };
      return;
    }
    p.finishedAt = nowIso();
    p.finishedMono = monotonicMs();
  }

  function durationMs(name) {
    const p = phases[String(name || "")];
    if (!p || p.startedMono == null || p.finishedMono == null) return null;
    return Math.max(0, p.finishedMono - p.startedMono);
  }

  function snapshot() {
    const out = {};
    for (const [k, p] of Object.entries(phases)) {
      out[k] = {
        startedAt: p.startedAt || null,
        finishedAt: p.finishedAt || null,
        durationMs:
          p.startedMono != null && p.finishedMono != null
            ? Math.max(0, p.finishedMono - p.startedMono)
            : null,
      };
    }
    return out;
  }

  return { mark, finish, snapshot, durationMs };
}

/**
 * Build redacted conditional DATEX request metrics from fetch response + request flags.
 */
export function buildDatexConditionalMetrics(opts = {}) {
  const headers = opts.headers || {};
  const etagRaw = headers.etag || headers.ETag || null;
  const lmRaw = headers["last-modified"] || headers["Last-Modified"] || null;
  const clRaw = headers["content-length"] || headers["Content-Length"] || null;
  const status = opts.status != null ? Number(opts.status) : null;
  return {
    DATEX_REQUEST_IF_MODIFIED_SINCE_SENT: opts.ifModifiedSinceSent === true ? "YES" : "NO",
    DATEX_REQUEST_IF_NONE_MATCH_SENT: opts.ifNoneMatchSent === true ? "YES" : "NO",
    DATEX_RESPONSE_STATUS: Number.isFinite(status) ? status : null,
    DATEX_RESPONSE_LAST_MODIFIED_PRESENT: lmRaw ? "YES" : "NO",
    DATEX_RESPONSE_ETAG_PRESENT: etagRaw ? "YES" : "NO",
    DATEX_RESPONSE_ETAG_HASH: safeEtagHash(etagRaw),
    DATEX_RESPONSE_CONTENT_LENGTH:
      clRaw != null && String(clRaw).trim() !== "" && Number.isFinite(Number(clRaw))
        ? Number(clRaw)
        : null,
    DATEX_NOT_MODIFIED: status === 304 ? "YES" : "NO",
    DATEX_BYTES_READ: opts.bytesRead != null ? Number(opts.bytesRead) : null,
  };
}

/**
 * Attach observability blob onto diagnostics (mutates).
 */
export function attachObservability(diagnostics, blob) {
  if (!diagnostics || typeof diagnostics !== "object") return diagnostics;
  diagnostics.observability = {
    schema: "iu-ndic-phase-observability-v1",
    ...(diagnostics.observability || {}),
    ...(blob || {}),
  };
  return diagnostics;
}

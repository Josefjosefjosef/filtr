/**
 * Ephemeral ingest rate limit — Worker isolate memory only.
 * Keyed by CF-Connecting-IP for the window; never written to D1 / KV / Cache API.
 * Not a visitor ID, fingerprint, or cross-session tracker.
 */

export const INGEST_RATE_WINDOW_MS = 60_000;
/** Legitimate max ≈ 3 POSTs/page × ~15 hard reloads/min; margin for ads + PWA ACK. */
export const INGEST_RATE_MAX_REQUESTS = 60;
/** ~20 tiny allowlisted events ≪ 16 KiB; blocks oversized JSON abuse. */
export const INGEST_MAX_BODY_BYTES = 16_384;

type Bucket = { count: number; windowStart: number };

/** Isolate-local only. Cleared on Worker recycle — acceptable for abuse throttle. */
const buckets = new Map<string, Bucket>();

const MAX_BUCKETS = 5_000;

export function resetIngestRateLimitForTests(): void {
  buckets.clear();
}

export function clientKeyFromRequest(req: Request): string {
  const ip = String(req.headers.get("CF-Connecting-IP") || "").trim();
  if (ip && ip.length <= 64 && !/[\r\n]/.test(ip)) return "ip:" + ip;
  // Dev / missing edge header: coarse short UA prefix (not stored, not returned).
  const ua = String(req.headers.get("User-Agent") || "").slice(0, 48);
  return "ua:" + ua;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Sliding fixed window per key. Fail-open only if Map ops throw (should not).
 */
export function checkIngestRateLimit(key: string, now = Date.now()): RateLimitResult {
  try {
    if (buckets.size > MAX_BUCKETS) {
      // Opportunistic prune of expired windows to bound memory.
      for (const [k, b] of buckets) {
        if (now - b.windowStart >= INGEST_RATE_WINDOW_MS) buckets.delete(k);
      }
      if (buckets.size > MAX_BUCKETS) buckets.clear();
    }

    const cur = buckets.get(key);
    if (!cur || now - cur.windowStart >= INGEST_RATE_WINDOW_MS) {
      buckets.set(key, { count: 1, windowStart: now });
      return { ok: true };
    }
    if (cur.count >= INGEST_RATE_MAX_REQUESTS) {
      const retryAfterSec = Math.max(1, Math.ceil((INGEST_RATE_WINDOW_MS - (now - cur.windowStart)) / 1000));
      return { ok: false, retryAfterSec };
    }
    cur.count += 1;
    return { ok: true };
  } catch {
    // Analytics must not 500 the site path; allow request if limiter faults.
    return { ok: true };
  }
}

export function assertIngestBodyByteLength(byteLength: number): { ok: true } | { ok: false; error: "body_too_large" } {
  if (!Number.isFinite(byteLength) || byteLength < 0) return { ok: false, error: "body_too_large" };
  if (byteLength > INGEST_MAX_BODY_BYTES) return { ok: false, error: "body_too_large" };
  return { ok: true };
}

export function assertIngestContentLengthHeader(req: Request): { ok: true } | { ok: false; error: "body_too_large" } {
  const cl = req.headers.get("Content-Length");
  if (cl == null || cl === "") return { ok: true };
  const n = Number(cl);
  if (!Number.isFinite(n) || n < 0) return { ok: true };
  return assertIngestBodyByteLength(n);
}

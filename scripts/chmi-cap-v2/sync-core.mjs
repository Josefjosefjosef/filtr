/**
 * Sync core — testable without production CHMI endpoints.
 * Shadow mode never replaces the active production snapshot.
 */
import crypto from "crypto";
import { DEFAULT_BACKOFF_MINUTES, getChmiCapV2Config } from "./config.mjs";
import { buildCapIdentity } from "./identity.mjs";
import { parseCapAlertXml } from "./parse-cap.mjs";
import { buildRevisionRecord, emptyRevisionStore, putRevision } from "./revisions.mjs";
import { createGeoRegistry, mapHazardGeography } from "./geo-registry.mjs";

export const SYNC_STATUSES = Object.freeze([
  "healthy",
  "not_modified",
  "degraded",
  "stale",
  "failed",
  "locked",
  "quarantined",
]);

export function createSyncState(endpoint = "fixture://cap") {
  return {
    endpoint,
    etag: null,
    lastModified: null,
    bodyHash: null,
    last_checked_at: null,
    last_success_at: null,
    last_changed_at: null,
    consecutive_errors: 0,
    backoff_until: null,
    status: "healthy",
    last_http_status: null,
    last_error: null,
  };
}

export function createLockState() {
  return {
    locked: false,
    runId: null,
    startedAt: null,
    expiresAt: null,
  };
}

export function tryAcquireLock(lock, opts = {}) {
  const now = opts.nowMs || Date.now();
  const ttlMs = opts.ttlMs || 10 * 60 * 1000;
  if (lock.locked && lock.expiresAt && now < lock.expiresAt) {
    return { ok: false, reason: "locked", lock };
  }
  const runId = opts.runId || crypto.randomBytes(8).toString("hex");
  lock.locked = true;
  lock.runId = runId;
  lock.startedAt = new Date(now).toISOString();
  lock.expiresAt = now + ttlMs;
  return { ok: true, runId, lock };
}

export function releaseLock(lock, runId) {
  if (lock.runId && runId && lock.runId !== runId) return { ok: false, reason: "run_mismatch" };
  lock.locked = false;
  lock.runId = null;
  lock.startedAt = null;
  lock.expiresAt = null;
  return { ok: true };
}

export function nextBackoffUntil(consecutiveErrors, opts = {}) {
  const table = opts.backoffMinutes || DEFAULT_BACKOFF_MINUTES;
  const idx = Math.min(Math.max(consecutiveErrors - 1, 0), table.length - 1);
  const minutes = table[idx] || 80;
  const now = opts.nowMs || Date.now();
  return new Date(now + minutes * 60 * 1000).toISOString();
}

export function parseRetryAfter(headerValue, nowMs = Date.now()) {
  if (headerValue == null || headerValue === "") return null;
  const s = String(headerValue).trim();
  if (/^\d+$/.test(s)) return new Date(nowMs + Number(s) * 1000).toISOString();
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return null;
}

/**
 * @param {{ status: number, headers?: Record<string,string>, body?: string|null }} response
 * @param {object} syncState
 */
export function applyConditionalResult(response, syncState, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  syncState.last_checked_at = nowIso;
  syncState.last_http_status = response.status;
  if (response.status === 304) {
    syncState.status = "not_modified";
    syncState.consecutive_errors = 0;
    syncState.backoff_until = null;
    syncState.last_success_at = nowIso;
    return { action: "not_modified", syncState };
  }
  if (response.status === 429 || response.status === 503) {
    const ra = parseRetryAfter(response.headers && (response.headers["retry-after"] || response.headers["Retry-After"]));
    syncState.consecutive_errors += 1;
    syncState.status = "degraded";
    syncState.backoff_until = ra || nextBackoffUntil(syncState.consecutive_errors, opts);
    syncState.last_error = `http_${response.status}`;
    return { action: "backoff", syncState };
  }
  if (response.status < 200 || response.status >= 300) {
    syncState.consecutive_errors += 1;
    syncState.status = response.status >= 500 ? "degraded" : "failed";
    syncState.backoff_until = nextBackoffUntil(syncState.consecutive_errors, opts);
    syncState.last_error = `http_${response.status}`;
    return { action: "error", syncState };
  }
  const body = response.body == null ? "" : String(response.body);
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  const etag = (response.headers && (response.headers.etag || response.headers.ETag)) || null;
  const lm = (response.headers && (response.headers["last-modified"] || response.headers["Last-Modified"])) || null;
  if (syncState.bodyHash && syncState.bodyHash === hash) {
    syncState.status = "not_modified";
    syncState.consecutive_errors = 0;
    syncState.backoff_until = null;
    syncState.last_success_at = nowIso;
    if (etag) syncState.etag = etag;
    if (lm) syncState.lastModified = lm;
    return { action: "hash_unchanged", syncState };
  }
  syncState.etag = etag;
  syncState.lastModified = lm;
  syncState.bodyHash = hash;
  syncState.last_success_at = nowIso;
  syncState.last_changed_at = nowIso;
  syncState.consecutive_errors = 0;
  syncState.backoff_until = null;
  syncState.status = "healthy";
  syncState.last_error = null;
  return { action: "process", syncState, body, hash };
}

export function suspiciousDrop(prevActiveCount, nextActiveCount, opts = {}) {
  const minPrev = opts.minPrev == null ? 3 : opts.minPrev;
  const ratio = opts.ratio == null ? 0.4 : opts.ratio;
  if (prevActiveCount < minPrev) return false;
  if (nextActiveCount >= prevActiveCount) return false;
  return nextActiveCount / prevActiveCount < ratio;
}

/**
 * Process one or more CAP XML documents into revision store + geo mapping (no publish).
 */
export function processCapDocuments(xmlDocs, opts = {}) {
  const config = opts.config || getChmiCapV2Config({ IU_CHMI_CAP_V2_MODE: "shadow" });
  const registry = opts.registry || createGeoRegistry();
  const store = opts.store || emptyRevisionStore();
  const knownThreads = opts.knownThreads || new Map();
  const receivedAt = opts.receivedAt || new Date().toISOString();
  const report = {
    loaded: 0,
    valid: 0,
    rejected: 0,
    duplicates: 0,
    newThreads: 0,
    updates: 0,
    cancels: 0,
    quarantine: [],
    errors: [],
    revisions: [],
  };

  for (const doc of xmlDocs) {
    report.loaded += 1;
    try {
      const alert = parseCapAlertXml(doc.xml, { limits: config.limits, sourceUrl: doc.sourceUrl || null });
      const identity = buildCapIdentity(alert, { knownThreads });
      knownThreads.set(identity.cap_message_id, identity.alert_thread_id);
      const prevId = (store.byThreadId.get(identity.alert_thread_id) || []).slice(-1)[0];
      const previousRevision = prevId ? store.byMessageId.get(prevId) : null;
      const revision = buildRevisionRecord(alert, identity, {
        receivedAt,
        previousRevision,
        validationStatus: "valid",
      });
      const put = putRevision(store, revision);
      if (put.duplicate) {
        report.duplicates += 1;
        continue;
      }
      report.valid += 1;
      report.revisions.push(revision);
      if (revision.change_type === "new") report.newThreads += 1;
      if (revision.change_type === "cancel") report.cancels += 1;
      if (revision.change_type !== "new" && revision.change_type !== "cancel") report.updates += 1;

      for (const h of identity.hazards) {
        const geo = mapHazardGeography(h, registry);
        h.geo = geo;
        for (const q of geo.quarantine) report.quarantine.push(q);
      }
    } catch (e) {
      report.rejected += 1;
      report.errors.push({
        code: e && e.code ? e.code : "PROCESS_ERROR",
        message: String(e && e.message ? e.message : e),
        sourceUrl: doc.sourceUrl || null,
      });
    }
  }

  const status =
    report.quarantine.length && report.valid
      ? "quarantined"
      : report.rejected && !report.valid
        ? "failed"
        : report.rejected
          ? "degraded"
          : "healthy";

  return { store, knownThreads, report, status, registryVersion: registry.version };
}

/**
 * Atomic publish gate: only when mode=active AND validation passed.
 * Shadow always returns publish=false and keeps lastKnownGood.
 */
export function atomicPublishDecision(opts) {
  const {
    mode = "shadow",
    validationOk = false,
    suspicious = false,
    candidateSnapshot = null,
    lastKnownGood = null,
  } = opts || {};
  if (mode !== "active") {
    return {
      publish: false,
      reason: "shadow_or_off",
      activeSnapshot: lastKnownGood,
      shadowSnapshot: candidateSnapshot,
    };
  }
  if (!validationOk || suspicious || !candidateSnapshot) {
    return {
      publish: false,
      reason: suspicious ? "suspicious_drop" : "validation_failed",
      activeSnapshot: lastKnownGood,
      shadowSnapshot: candidateSnapshot,
    };
  }
  return {
    publish: true,
    reason: "ok",
    activeSnapshot: candidateSnapshot,
    shadowSnapshot: null,
  };
}

/** Pluggable discovery — production adapter must be confirmed before wiring. */
export function createFixtureDiscovery(files) {
  return {
    type: "fixture",
    async listLatest() {
      return (files || []).map((f) => ({ url: f.url || f.name, name: f.name }));
    },
    async fetchBody(url, _conditional) {
      const f = (files || []).find((x) => (x.url || x.name) === url || x.name === url);
      if (!f) return { status: 404, headers: {}, body: null };
      return {
        status: 200,
        headers: { etag: f.etag || `"${f.name}"`, "content-type": "application/xml", "last-modified": f.lastModified || "Wed, 01 Jul 2026 10:00:00 GMT" },
        body: f.xml,
      };
    },
  };
}

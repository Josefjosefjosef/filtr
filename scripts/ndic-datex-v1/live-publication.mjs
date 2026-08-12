/**
 * Direct live publication client (Worker → R2) + local LKG mirror.
 * Shadow mode: validate + write local staging only (PRODUCTION_WRITE=NO).
 *
 * Bounded retries for transient Worker/edge failures (429/502/503/504).
 * Semantic content skip avoids republishing when only volatile metadata changed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { defaultLiveRoot, writeJsonAtomic, readJsonSafe, generationPointerPath } from "./live-health.mjs";
import { evaluateLiveAnomalyGuard } from "./live-anomaly-guard.mjs";

export const LIVE_SNAPSHOT_OBJECT_KEY = "current/traffic_offline_snapshot.json";
export const LIVE_META_OBJECT_KEY = "current/meta.json";
export const LIVE_PUBLISH_PATH = "/projects/data/info_events/ndic_datex_v1/__iu_live_publish";

/** Bounded publish retry budget (must fit inside ~60s poll without queueing). */
export const PUBLISH_MAX_ATTEMPTS = 4;
export const PUBLISH_MAX_RETRY_WINDOW_MS = 25000;
export const PUBLISH_RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export function snapshotLkgPath(root = defaultLiveRoot()) {
  return path.join(root, "lkg", "traffic_offline_snapshot.json");
}

export function snapshotStagingPath(root = defaultLiveRoot()) {
  return path.join(root, "staging", "traffic_offline_snapshot.json");
}

export function summarizeSnapshot(snapshot) {
  const cards = Array.isArray(snapshot && snapshot.cards) ? snapshot.cards : [];
  let active = 0;
  let future = 0;
  let ended = 0;
  let resolved = 0;
  let unresolved = 0;
  let road = 0;
  let timeline = 0;
  for (const c of cards) {
    const s = String((c && c.lifecycleStatus) || "");
    if (s === "ACTIVE") active += 1;
    else if (s === "FUTURE") future += 1;
    else if (s === "ENDED") ended += 1;
    if (c && c.preciseLocationVerified) resolved += 1;
    else unresolved += 1;
    if (c && (c.road || c.roadClassLabel)) road += 1;
    if (c && (c.validityLine || c.timelineField)) timeline += 1;
  }
  return {
    cardCount: cards.length,
    TOTAL_RECORDS: cards.length,
    ACTIVE_COUNT: active,
    FUTURE_COUNT: future,
    ENDED_COUNT: ended,
    RESOLVED_COUNT: resolved,
    UNRESOLVED_COUNT: unresolved,
    ROAD_PRESENT_COUNT: road,
    TIMELINE_PRESENT_COUNT: timeline,
    schema: snapshot && snapshot.schema,
    generatedAt: snapshot && snapshot.generatedAt,
    snapshotVersion: snapshot && snapshot.snapshotVersion,
  };
}

export function checksumBody(body) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

/**
 * Content identity for publication skip — excludes volatile rebuild metadata
 * (generatedAt / snapshotVersion / dataAge) so LM-only churn does not force R2 writes.
 */
export function semanticContentChecksum(snapshot) {
  const cards = Array.isArray(snapshot && snapshot.cards) ? snapshot.cards : [];
  const payload = JSON.stringify({
    schema: snapshot && snapshot.schema,
    cardCount: snapshot && snapshot.cardCount != null ? snapshot.cardCount : cards.length,
    eventCount: snapshot && snapshot.eventCount,
    feedCount: snapshot && snapshot.feedCount,
    cards,
    feed: snapshot && snapshot.feed,
    historyItems: snapshot && snapshot.historyItems,
    filterIndexes: snapshot && snapshot.filterIndexes,
    projections: snapshot && snapshot.projections,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function sleepMs(ms, sleepImpl = (n) => new Promise((r) => setTimeout(r, n))) {
  const n = Math.max(0, Number(ms) || 0);
  return sleepImpl(n);
}

export function parseRetryAfterMs(headerValue, nowMs = Date.now()) {
  if (headerValue == null || headerValue === "") return null;
  const raw = String(headerValue).trim();
  if (/^\d+$/.test(raw)) {
    return Math.max(0, Number(raw) * 1000);
  }
  const when = Date.parse(raw);
  if (!Number.isFinite(when)) return null;
  return Math.max(0, when - nowMs);
}

export function computePublishBackoffMs({
  attempt,
  retryAfterHeader,
  elapsedMs,
  maxWindowMs = PUBLISH_MAX_RETRY_WINDOW_MS,
  random = Math.random,
} = {}) {
  const remaining = Math.max(0, maxWindowMs - (elapsedMs || 0));
  if (remaining <= 0) return 0;
  let delay = Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), 8000);
  const ra = parseRetryAfterMs(retryAfterHeader);
  if (ra != null) {
    delay = Math.min(Math.max(ra, 200), 15000);
  }
  delay = Math.min(delay, remaining);
  const jitter = 0.8 + random() * 0.4;
  return Math.floor(delay * jitter);
}

export function isRetryablePublishFailure(status, networkError = false) {
  if (networkError) return true;
  return PUBLISH_RETRYABLE_STATUS.has(Number(status));
}

/**
 * Publish validated snapshot.
 * modes: shadow | active
 */
export async function publishLiveTrafficSnapshot({
  snapshot,
  mode = "shadow",
  generation,
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleepImpl,
  random,
  nowMs = () => Date.now(),
} = {}) {
  const root = defaultLiveRoot(env);
  const summary = summarizeSnapshot(snapshot);
  const body = JSON.stringify(snapshot);
  const checksum = checksumBody(body);
  const semanticChecksum = semanticContentChecksum(snapshot);
  const payloadBytes = Buffer.byteLength(body, "utf8");
  const prevPtr = readJsonSafe(generationPointerPath(root), null);
  const prevSnap = readJsonSafe(snapshotLkgPath(root), null);
  const prevSummary = prevSnap ? summarizeSnapshot(prevSnap) : prevPtr && prevPtr.summary;

  const anomaly = evaluateLiveAnomalyGuard({
    previous: prevSummary,
    candidate: summary,
    nowIso: generation && generation.processedAt,
  });
  if (!anomaly.ok) {
    return {
      ok: false,
      reason: "ANOMALY_GUARD_BLOCKED",
      anomaly,
      PRODUCTION_WRITE: "NO",
      LAST_KNOWN_GOOD_PROTECTED: "YES",
      PAYLOAD_BYTES: payloadBytes,
      MAX_CONCURRENT_PUBLISHERS: 1,
    };
  }

  // Idempotence: same source LM + full body checksum
  if (
    prevPtr &&
    generation &&
    prevPtr.sourceLastModified &&
    generation.sourceLastModified &&
    prevPtr.sourceLastModified === generation.sourceLastModified &&
    prevPtr.checksum === checksum
  ) {
    return {
      ok: true,
      reason: "UNCHANGED_CONTENT_PUBLICATION_SKIPPED",
      UNCHANGED_CONTENT_PUBLICATION_SKIPPED: "YES",
      PRODUCTION_WRITE: "NO",
      generationId: prevPtr.generationId,
      summary,
      PAYLOAD_BYTES: payloadBytes,
      semanticChecksum,
      MAX_CONCURRENT_PUBLISHERS: 1,
    };
  }

  // Semantic skip: cards/content unchanged even if Last-Modified / generatedAt moved
  if (prevPtr && prevPtr.semanticChecksum && prevPtr.semanticChecksum === semanticChecksum) {
    return {
      ok: true,
      reason: "UNCHANGED_CONTENT_PUBLICATION_SKIPPED",
      UNCHANGED_CONTENT_PUBLICATION_SKIPPED: "YES",
      PRODUCTION_WRITE: "NO",
      generationId: prevPtr.generationId,
      summary,
      PAYLOAD_BYTES: payloadBytes,
      semanticChecksum,
      SEMANTIC_SKIP: "YES",
      MAX_CONCURRENT_PUBLISHERS: 1,
    };
  }

  // Write staging always
  const staging = snapshotStagingPath(root);
  fs.mkdirSync(path.dirname(staging), { recursive: true });
  const tmp = staging + ".new";
  fs.writeFileSync(tmp, body, "utf8");
  // verify staging
  const reRead = JSON.parse(fs.readFileSync(tmp, "utf8"));
  if (!reRead || reRead.schema !== "iu-traffic-offline-snapshot-v1") {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return { ok: false, reason: "STAGING_VERIFY_FAILED", PRODUCTION_WRITE: "NO", PAYLOAD_BYTES: payloadBytes };
  }
  fs.renameSync(tmp, staging);

  const meta = {
    schema: "iu-ndic-live-generation-v1",
    generationId: generation.generationId,
    sourceLastModified: generation.sourceLastModified || null,
    sourceDownloadedAt: generation.sourceDownloadedAt || null,
    processedAt: generation.processedAt || null,
    publishedAt: new Date().toISOString(),
    checksum,
    semanticChecksum,
    summary,
    mode,
  };

  if (mode !== "active") {
    writeJsonAtomic(path.join(root, "staging", "meta.json"), meta);
    return {
      ok: true,
      reason: "SHADOW_STAGED",
      PRODUCTION_WRITE: "NO",
      ATOMIC_PUBLICATION_PASS: "YES_STAGING_ONLY",
      generationId: meta.generationId,
      summary,
      anomaly,
      checksum,
      semanticChecksum,
      PAYLOAD_BYTES: payloadBytes,
      MAX_CONCURRENT_PUBLISHERS: 1,
    };
  }

  const publishUrl = String(env.IU_NDIC_LIVE_PUBLISH_URL || "").trim();
  const token = String(env.IU_NDIC_LIVE_PUBLISH_TOKEN || "").trim();
  if (!publishUrl || !token) {
    return {
      ok: false,
      reason: "LIVE_PUBLISH_CREDENTIALS_MISSING",
      PRODUCTION_WRITE: "NO",
      LAST_KNOWN_GOOD_PROTECTED: "YES",
      PAYLOAD_BYTES: payloadBytes,
    };
  }

  const requestBody = JSON.stringify({ meta, snapshot });
  const started = nowMs();
  let attempt = 0;
  let lastStatus = 0;
  let lastDetail = "";
  let retryAfterSupported = "NO";
  let recoveredByRetry = false;
  const attemptLog = [];

  while (attempt < PUBLISH_MAX_ATTEMPTS) {
    attempt += 1;
    const attemptStarted = nowMs();
    let res;
    try {
      res = await fetchImpl(publishUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + token,
          "x-iu-ndic-generation-id": meta.generationId,
          "x-iu-ndic-source-last-modified": meta.sourceLastModified || "",
          "x-iu-ndic-checksum": checksum,
          "x-iu-ndic-semantic-checksum": semanticChecksum,
        },
        body: requestBody,
      });
    } catch (e) {
      lastStatus = 0;
      lastDetail = String((e && e.message) || e).slice(0, 200);
      attemptLog.push({
        attempt,
        status: 0,
        durationMs: nowMs() - attemptStarted,
        networkError: true,
      });
      const elapsed = nowMs() - started;
      if (attempt >= PUBLISH_MAX_ATTEMPTS || elapsed >= PUBLISH_MAX_RETRY_WINDOW_MS) break;
      const delay = computePublishBackoffMs({
        attempt,
        elapsedMs: elapsed,
        random,
      });
      if (delay <= 0) break;
      await sleepMs(delay, sleepImpl);
      continue;
    }

    lastStatus = res.status;
    const retryAfterHeader = res.headers.get("retry-after");
    if (retryAfterHeader) retryAfterSupported = "YES";
    const text = await res.text().catch(() => "");
    lastDetail = String(text).slice(0, 200);
    attemptLog.push({
      attempt,
      status: res.status,
      durationMs: nowMs() - attemptStarted,
      retryAfterPresent: Boolean(retryAfterHeader),
      bodyLen: String(text).length,
    });

    if (res.ok) {
      if (attempt > 1) recoveredByRetry = true;
      // Promote local LKG after successful remote publish
      const lkg = snapshotLkgPath(root);
      fs.mkdirSync(path.dirname(lkg), { recursive: true });
      fs.copyFileSync(staging, lkg);
      writeJsonAtomic(generationPointerPath(root), meta);

      // Cleanup staging.tmp leftovers if any
      try {
        fs.unlinkSync(staging + ".new");
      } catch {
        /* ignore */
      }

      return {
        ok: true,
        reason: "PUBLISHED",
        PRODUCTION_WRITE: "YES",
        ATOMIC_PUBLICATION_PASS: "YES",
        generationId: meta.generationId,
        summary,
        anomaly,
        checksum,
        semanticChecksum,
        publishedAt: meta.publishedAt,
        PAYLOAD_BYTES: payloadBytes,
        PUBLICATION_ATTEMPTS: attempt,
        PUBLICATION_RETRY_COUNT: attempt - 1,
        PUBLICATION_RECOVERED_BY_RETRY: recoveredByRetry ? "YES" : "NO",
        RETRY_AFTER_SUPPORTED: retryAfterSupported,
        RETRY_POLICY: "bounded_exponential_jitter",
        MAX_RETRY_ATTEMPTS: PUBLISH_MAX_ATTEMPTS,
        MAX_RETRY_WINDOW_MS: PUBLISH_MAX_RETRY_WINDOW_MS,
        MAX_CONCURRENT_PUBLISHERS: 1,
        IDEMPOTENT_PUBLICATION_RETRY_PASS: "YES",
        LAST_PUBLICATION_HTTP_STATUS: res.status,
        attemptLog,
      };
    }

    // Non-retryable (auth/validation/stale)
    if (!isRetryablePublishFailure(res.status)) {
      return {
        ok: false,
        reason: "LIVE_PUBLISH_HTTP_" + res.status,
        detail: lastDetail,
        PRODUCTION_WRITE: "NO",
        LAST_KNOWN_GOOD_PROTECTED: "YES",
        PAYLOAD_BYTES: payloadBytes,
        PUBLICATION_ATTEMPTS: attempt,
        PUBLICATION_RETRY_COUNT: attempt - 1,
        RETRY_AFTER_SUPPORTED: retryAfterSupported,
        LAST_PUBLICATION_HTTP_STATUS: res.status,
        MAX_CONCURRENT_PUBLISHERS: 1,
        attemptLog,
      };
    }

    const elapsed = nowMs() - started;
    if (attempt >= PUBLISH_MAX_ATTEMPTS || elapsed >= PUBLISH_MAX_RETRY_WINDOW_MS) break;
    const delay = computePublishBackoffMs({
      attempt,
      retryAfterHeader,
      elapsedMs: elapsed,
      random,
    });
    if (delay <= 0) break;
    await sleepMs(delay, sleepImpl);
  }

  // Cleanup .new leftover after exhaustion
  try {
    fs.unlinkSync(staging + ".new");
  } catch {
    /* ignore */
  }

  return {
    ok: false,
    reason: "LIVE_PUBLISH_HTTP_" + (lastStatus || "NETWORK"),
    detail: lastDetail,
    PRODUCTION_WRITE: "NO",
    LAST_KNOWN_GOOD_PROTECTED: "YES",
    PUBLISH_503_LKG_PASS: "YES",
    PAYLOAD_BYTES: payloadBytes,
    PUBLICATION_ATTEMPTS: attempt,
    PUBLICATION_RETRY_COUNT: Math.max(0, attempt - 1),
    PUBLICATION_RECOVERED_BY_RETRY: "NO",
    RETRY_AFTER_SUPPORTED: retryAfterSupported,
    RETRY_POLICY: "bounded_exponential_jitter",
    MAX_RETRY_ATTEMPTS: PUBLISH_MAX_ATTEMPTS,
    MAX_RETRY_WINDOW_MS: PUBLISH_MAX_RETRY_WINDOW_MS,
    LAST_PUBLICATION_HTTP_STATUS: lastStatus || null,
    MAX_CONCURRENT_PUBLISHERS: 1,
    attemptLog,
  };
}

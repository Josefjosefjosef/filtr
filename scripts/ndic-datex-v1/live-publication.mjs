/**
 * Direct live publication client (Worker → R2) + local LKG mirror.
 * Shadow mode: validate + write local staging only (PRODUCTION_WRITE=NO).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { defaultLiveRoot, writeJsonAtomic, readJsonSafe, generationPointerPath } from "./live-health.mjs";
import { evaluateLiveAnomalyGuard } from "./live-anomaly-guard.mjs";

export const LIVE_SNAPSHOT_OBJECT_KEY = "current/traffic_offline_snapshot.json";
export const LIVE_META_OBJECT_KEY = "current/meta.json";
export const LIVE_PUBLISH_PATH = "/projects/data/info_events/ndic_datex_v1/__iu_live_publish";

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
 * Publish validated snapshot.
 * modes: shadow | active
 */
export async function publishLiveTrafficSnapshot({
  snapshot,
  mode = "shadow",
  generation,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const root = defaultLiveRoot(env);
  const summary = summarizeSnapshot(snapshot);
  const body = JSON.stringify(snapshot);
  const checksum = checksumBody(body);
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
    };
  }

  // Idempotence: same source generation → skip
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
    return { ok: false, reason: "STAGING_VERIFY_FAILED", PRODUCTION_WRITE: "NO" };
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
    };
  }

  const res = await fetchImpl(publishUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + token,
      "x-iu-ndic-generation-id": meta.generationId,
      "x-iu-ndic-source-last-modified": meta.sourceLastModified || "",
      "x-iu-ndic-checksum": checksum,
    },
    body: JSON.stringify({ meta, snapshot }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      reason: "LIVE_PUBLISH_HTTP_" + res.status,
      detail: String(text).slice(0, 200),
      PRODUCTION_WRITE: "NO",
      LAST_KNOWN_GOOD_PROTECTED: "YES",
    };
  }

  // Promote local LKG after successful remote publish
  const lkg = snapshotLkgPath(root);
  fs.mkdirSync(path.dirname(lkg), { recursive: true });
  fs.copyFileSync(staging, lkg);
  writeJsonAtomic(generationPointerPath(root), meta);

  return {
    ok: true,
    reason: "PUBLISHED",
    PRODUCTION_WRITE: "YES",
    ATOMIC_PUBLICATION_PASS: "YES",
    generationId: meta.generationId,
    summary,
    anomaly,
    checksum,
    publishedAt: meta.publishedAt,
  };
}

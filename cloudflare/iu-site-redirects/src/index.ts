/**
 * Legacy /projects/* → root permanent redirects (301).
 * Pass-through: /projects/data/*, /projects/version.json
 *
 * Live traffic overlay (optional R2):
 *   GET  .../ndic_datex_v1/traffic_offline_snapshot.json → R2 current when LIVE_TRAFFIC_ENABLED
 *   POST .../ndic_datex_v1/__iu_live_publish → authenticated atomic publish to R2
 */
const TRAFFIC_SNAPSHOT_PATH =
  "/projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json";
const LIVE_PUBLISH_PATH = "/projects/data/info_events/ndic_datex_v1/__iu_live_publish";
const R2_SNAPSHOT_KEY = "current/traffic_offline_snapshot.json";
const R2_META_KEY = "current/meta.json";
const R2_STAGING_SNAPSHOT_KEY = "staging/traffic_offline_snapshot.json";
const R2_STAGING_META_KEY = "staging/meta.json";
/** Body = pre-serialized snapshot JSON; meta in x-iu-ndic-meta (avoids Worker JSON.parse of ~8MiB). */
const LIVE_PUBLISH_WIRE_RAW = "snapshot-raw-v1";

export type Env = {
  TRAFFIC_LIVE?: R2Bucket;
  LIVE_TRAFFIC_ENABLED?: string;
  LIVE_PUBLISH_TOKEN?: string;
};

function hasOfflineSnapshotSchema(snapBody: string): boolean {
  return (
    snapBody.includes('"schema":"iu-traffic-offline-snapshot-v1"') ||
    snapBody.includes('"schema": "iu-traffic-offline-snapshot-v1"')
  );
}

function isDataOrVersionPath(pathname: string): boolean {
  if (pathname === "/projects/version.json") return true;
  if (pathname.startsWith("/projects/data/")) return true;
  return false;
}

function redirectTarget(pathname: string): string | null {
  if (pathname === "/projects" || pathname === "/projects/") return "/";
  if (pathname === "/projects/manifest.json") return "/manifest.json";
  if (pathname.startsWith("/projects/icons/")) {
    return "/icons/" + pathname.slice("/projects/icons/".length);
  }
  if (pathname.startsWith("/projects/")) {
    const rest = pathname.slice("/projects/".length);
    if (!rest) return "/";
    return "/" + rest;
  }
  return null;
}

function liveEnabled(env: Env): boolean {
  return String(env.LIVE_TRAFFIC_ENABLED || "").toLowerCase() === "true";
}

async function serveLiveSnapshot(env: Env, request: Request): Promise<Response | null> {
  if (!liveEnabled(env) || !env.TRAFFIC_LIVE) return null;
  const obj = await env.TRAFFIC_LIVE.get(R2_SNAPSHOT_KEY);
  if (!obj) return null;
  const headers = new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-iu-ndic-live-source", "r2");
  const meta = await env.TRAFFIC_LIVE.get(R2_META_KEY);
  if (meta) {
    try {
      const m = JSON.parse(await meta.text());
      if (m && m.generationId) headers.set("x-iu-ndic-generation-id", String(m.generationId));
      if (m && m.sourceLastModified) headers.set("x-iu-ndic-source-last-modified", String(m.sourceLastModified));
    } catch {
      /* ignore */
    }
  }
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}

async function handleLivePublish(env: Env, request: Request): Promise<Response> {
  if (!env.TRAFFIC_LIVE) {
    return json({ ok: false, reason: "R2_NOT_BOUND" }, 503);
  }
  const token = String(env.LIVE_PUBLISH_TOKEN || "");
  if (!token) return json({ ok: false, reason: "TOKEN_NOT_CONFIGURED" }, 503);
  const auth = request.headers.get("authorization") || "";
  if (auth !== "Bearer " + token) return json({ ok: false, reason: "UNAUTHORIZED" }, 401);

  const wire = String(request.headers.get("x-iu-ndic-publish-wire") || "").trim();
  let meta: Record<string, unknown>;
  let snapBody: string;
  let publishWire = "legacy-envelope";

  if (wire === LIVE_PUBLISH_WIRE_RAW) {
    // Prefer path for production ~8MiB snapshots: no JSON.parse of the snapshot body.
    publishWire = LIVE_PUBLISH_WIRE_RAW;
    const metaHdr = String(request.headers.get("x-iu-ndic-meta") || "");
    try {
      meta = JSON.parse(metaHdr);
    } catch {
      return json({ ok: false, reason: "INVALID_META_HEADER" }, 400);
    }
    if (!meta || typeof meta !== "object") {
      return json({ ok: false, reason: "MISSING_META_OR_SNAPSHOT" }, 400);
    }
    try {
      snapBody = await request.text();
    } catch {
      return json({ ok: false, reason: "BODY_READ_FAILED" }, 400);
    }
    if (!snapBody || !hasOfflineSnapshotSchema(snapBody)) {
      return json({ ok: false, reason: "INVALID_SNAPSHOT_SCHEMA" }, 400);
    }
  } else {
    // Legacy envelope {meta,snapshot} — fine for small fixtures; avoid in production.
    let rawText: string;
    try {
      rawText = await request.text();
    } catch {
      return json({ ok: false, reason: "BODY_READ_FAILED" }, 400);
    }
    let payload: { meta?: Record<string, unknown>; snapshot?: Record<string, unknown> };
    try {
      payload = JSON.parse(rawText);
    } catch {
      return json({ ok: false, reason: "INVALID_JSON" }, 400);
    }
    const snapshot = payload.snapshot;
    meta = payload.meta as Record<string, unknown>;
    if (!meta || !snapshot || typeof snapshot !== "object") {
      return json({ ok: false, reason: "MISSING_META_OR_SNAPSHOT" }, 400);
    }
    const schema = String((snapshot as { schema?: string }).schema || "");
    if (schema !== "iu-traffic-offline-snapshot-v1") {
      return json({ ok: false, reason: "INVALID_SNAPSHOT_SCHEMA" }, 400);
    }
    snapBody = JSON.stringify(snapshot);
  }

  const incomingSemantic = String(
    meta.semanticChecksum || request.headers.get("x-iu-ndic-semantic-checksum") || ""
  );
  const incomingChecksum = String(meta.checksum || request.headers.get("x-iu-ndic-checksum") || "");

  // Stale writer protection vs current meta
  const currentMetaObj = await env.TRAFFIC_LIVE.get(R2_META_KEY);
  if (currentMetaObj) {
    try {
      const cur = JSON.parse(await currentMetaObj.text());
      const incomingLm = String(meta.sourceLastModified || "");
      const currentLm = String(cur.sourceLastModified || "");
      if (incomingLm && currentLm) {
        const a = Date.parse(incomingLm);
        const b = Date.parse(currentLm);
        if (Number.isFinite(a) && Number.isFinite(b) && a < b) {
          return json({ ok: false, reason: "STALE_WRITER_REJECTED", STALE_WRITER_PROTECTION_PASS: "YES" }, 409);
        }
        if (
          (incomingLm === currentLm && incomingChecksum && incomingChecksum === String(cur.checksum || "")) ||
          (incomingSemantic && incomingSemantic === String(cur.semanticChecksum || ""))
        ) {
          return json({
            ok: true,
            reason: "UNCHANGED_CONTENT_PUBLICATION_SKIPPED",
            UNCHANGED_CONTENT_PUBLICATION_SKIPPED: "YES",
            generationId: cur.generationId,
          });
        }
      }
    } catch {
      /* ignore parse errors — continue publish */
    }
  }

  const metaBody = JSON.stringify(meta);
  if (!hasOfflineSnapshotSchema(snapBody)) {
    return json({ ok: false, reason: "STAGING_SCHEMA_VERIFY_FAILED" }, 500);
  }

  // staging → size verify → current (no full-body re-read of staging)
  const stagedSnap = await env.TRAFFIC_LIVE.put(R2_STAGING_SNAPSHOT_KEY, snapBody, {
    httpMetadata: { contentType: "application/json" },
  });
  await env.TRAFFIC_LIVE.put(R2_STAGING_META_KEY, metaBody, {
    httpMetadata: { contentType: "application/json" },
  });
  if (!stagedSnap || !(stagedSnap.size > 0)) {
    return json({ ok: false, reason: "STAGING_VERIFY_FAILED" }, 500);
  }

  await env.TRAFFIC_LIVE.put(R2_SNAPSHOT_KEY, snapBody, {
    httpMetadata: { contentType: "application/json" },
  });
  await env.TRAFFIC_LIVE.put(R2_META_KEY, metaBody, {
    httpMetadata: { contentType: "application/json" },
  });

  return json({
    ok: true,
    reason: "PUBLISHED",
    ATOMIC_PUBLICATION_PASS: "YES",
    generationId: meta.generationId,
    publishedAt: meta.publishedAt,
    payloadBytes: snapBody.length,
    publishWire,
  });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === LIVE_PUBLISH_PATH && request.method === "POST") {
      try {
        return await handleLivePublish(env, request);
      } catch (err) {
        return json(
          {
            ok: false,
            reason: "WORKER_PUBLISH_THROW",
            detail: String((err && (err as Error).message) || err).slice(0, 120),
          },
          500
        );
      }
    }

    if (
      pathname === TRAFFIC_SNAPSHOT_PATH &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const live = await serveLiveSnapshot(env, request);
      if (live) return live;
      // fall through to origin Pages
      return fetch(request);
    }

    if (isDataOrVersionPath(pathname)) {
      return fetch(request);
    }

    const destPath = redirectTarget(pathname);
    if (!destPath) {
      return fetch(request);
    }

    const dest = new URL(url.toString());
    dest.pathname = destPath;
    return Response.redirect(dest.toString(), 301);
  },
};

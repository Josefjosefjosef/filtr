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

export type Env = {
  TRAFFIC_LIVE?: R2Bucket;
  LIVE_TRAFFIC_ENABLED?: string;
  LIVE_PUBLISH_TOKEN?: string;
};

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

  let payload: { meta?: Record<string, unknown>; snapshot?: Record<string, unknown> };
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, reason: "INVALID_JSON" }, 400);
  }
  const meta = payload.meta;
  const snapshot = payload.snapshot;
  if (!meta || !snapshot || typeof snapshot !== "object") {
    return json({ ok: false, reason: "MISSING_META_OR_SNAPSHOT" }, 400);
  }
  if (String((snapshot as { schema?: string }).schema || "") !== "iu-traffic-offline-snapshot-v1") {
    return json({ ok: false, reason: "INVALID_SNAPSHOT_SCHEMA" }, 400);
  }

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
        if (incomingLm === currentLm && String(meta.checksum || "") === String(cur.checksum || "")) {
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

  const snapBody = JSON.stringify(snapshot);
  const metaBody = JSON.stringify(meta);
  // staging → verify → current (atomic pointer pair)
  await env.TRAFFIC_LIVE.put(R2_STAGING_SNAPSHOT_KEY, snapBody, {
    httpMetadata: { contentType: "application/json" },
  });
  await env.TRAFFIC_LIVE.put(R2_STAGING_META_KEY, metaBody, {
    httpMetadata: { contentType: "application/json" },
  });
  const verify = await env.TRAFFIC_LIVE.get(R2_STAGING_SNAPSHOT_KEY);
  if (!verify) return json({ ok: false, reason: "STAGING_VERIFY_FAILED" }, 500);
  const verifyText = await verify.text();
  if (!verifyText.includes('"schema":"iu-traffic-offline-snapshot-v1"') && !verifyText.includes('"schema": "iu-traffic-offline-snapshot-v1"')) {
    return json({ ok: false, reason: "STAGING_SCHEMA_VERIFY_FAILED" }, 500);
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
      return handleLivePublish(env, request);
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

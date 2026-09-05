/**
 * Legacy /projects/* → root permanent redirects (301).
 * Pass-through: /projects/data/*, /projects/version.json
 *
 * HTML CSP edge (XSS-CSP-01/02):
 *   Promote document meta CSP → HTTP Content-Security-Policy so the browser
 *   enforces CSP before any script runs (closes pre-meta execution window).
 *   Canonical policy source remains HTML meta (+ hash apply script).
 *
 * Live traffic overlay (optional R2):
 *   GET  .../ndic_datex_v1/traffic_offline_snapshot.json → R2 current when LIVE_TRAFFIC_ENABLED
 *   POST .../ndic_datex_v1/__iu_live_publish → authenticated atomic publish to R2
 */
import { isHtmlDocumentPath, promoteHtmlCsp } from "./csp-promote";

const TRAFFIC_SNAPSHOT_PATH =
  "/projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json";
const TRAFFIC_LIVE_META_PATH =
  "/projects/data/info_events/ndic_datex_v1/traffic_live_meta.json";
const LIVE_PUBLISH_PATH = "/projects/data/info_events/ndic_datex_v1/__iu_live_publish";
const R2_SNAPSHOT_KEY = "current/traffic_offline_snapshot.json";
const R2_SNAPSHOT_HEAD_KEY = "current/traffic_offline_snapshot_head.json";
const R2_META_KEY = "current/meta.json";
const R2_STAGING_SNAPSHOT_KEY = "staging/traffic_offline_snapshot.json";
const R2_STAGING_META_KEY = "staging/meta.json";
/** Body = pre-serialized snapshot JSON; meta in x-iu-ndic-meta (avoids Worker JSON.parse of ~8MiB). */
const LIVE_PUBLISH_WIRE_RAW = "snapshot-raw-v1";
/** First-paint / pagination head size (cards). Covers several PAGE_SIZE=50 windows. */
const TRAFFIC_HEAD_CARD_CAP = 200;

export type Env = {
  TRAFFIC_LIVE?: R2Bucket;
  LIVE_TRAFFIC_ENABLED?: string;
  LIVE_PUBLISH_TOKEN?: string;
};

async function fetchOrigin(request: Request): Promise<Response> {
  return fetch(request);
}

async function fetchOriginMaybePromoteCsp(request: Request, pathname: string): Promise<Response> {
  if (!isHtmlDocumentPath(pathname)) return fetchOrigin(request);
  if (request.method !== "GET" && request.method !== "HEAD") return fetchOrigin(request);

  try {
    // Origin HEAD bodies are often empty — GET to read meta CSP, then shape HEAD if needed.
    const originReq =
      request.method === "HEAD"
        ? new Request(request.url, {
            method: "GET",
            headers: request.headers,
            redirect: "manual",
          })
        : request;
    const res = await fetchOrigin(originReq);
    const promoted = await promoteHtmlCsp(res, pathname);
    if (request.method === "HEAD") {
      return new Response(null, {
        status: promoted.status,
        statusText: promoted.statusText,
        headers: promoted.headers,
      });
    }
    return promoted;
  } catch {
    return fetchOrigin(request);
  }
}

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

function cardSortMs(card: Record<string, unknown> | null | undefined): number {
  const iso = String(
    (card && (card.lastMeaningfulChangeAt || card.sourceUpdatedAt || card.downloadedAt)) || ""
  );
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function orderTrafficCardsNewestFirst(cards: Record<string, unknown>[]): Record<string, unknown>[] {
  const ordered = cards.slice();
  ordered.sort((a, b) => {
    const d = cardSortMs(b) - cardSortMs(a);
    if (d !== 0) return d;
    return String((a && a.publicEventId) || "").localeCompare(String((b && b.publicEventId) || ""));
  });
  return ordered;
}

/** Slim snapshot for first paint / offset pagination (history dropped). */
export function slimTrafficSnapshotForEdge(
  data: Record<string, unknown>,
  offset: number,
  limit: number
): Record<string, unknown> {
  const cardsRaw = Array.isArray(data.cards)
    ? (data.cards as Record<string, unknown>[])
    : Array.isArray(data.projections)
      ? (data.projections as Record<string, unknown>[])
      : [];
  const ordered = orderTrafficCardsNewestFirst(cardsRaw);
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  const limRaw = Math.floor(Number(limit) || 0);
  const lim = limRaw > 0 ? Math.min(Math.max(limRaw, 1), TRAFFIC_HEAD_CARD_CAP) : TRAFFIC_HEAD_CARD_CAP;
  const kept = ordered.slice(off, off + lim);
  const total = data.cardCount != null ? Number(data.cardCount) : cardsRaw.length;
  return {
    schema: data.schema || "iu-traffic-offline-snapshot-v1",
    snapshotVersion: data.snapshotVersion || null,
    schemaVersion: data.schemaVersion || data.schema || null,
    generatedAt: data.generatedAt || null,
    sourceFreshness: data.sourceFreshness || null,
    eventCount: data.eventCount != null ? data.eventCount : null,
    feedCount: data.feedCount != null ? data.feedCount : null,
    cardCount: Number.isFinite(total) ? total : cardsRaw.length,
    publicationEnabled: data.publicationEnabled === true,
    publicApiEnabled: data.publicApiEnabled === true,
    trafficUiEnabled: data.trafficUiEnabled !== false,
    cards: kept,
    projections: [],
    historyItems: [],
    historyCount: 0,
    cardsCappedTo: lim,
    cardsOffset: off,
    edgeSlim: true,
  };
}

async function attachLiveMetaHeaders(env: Env, headers: Headers): Promise<void> {
  if (!env.TRAFFIC_LIVE) return;
  const meta = await env.TRAFFIC_LIVE.get(R2_META_KEY);
  if (!meta) return;
  try {
    const m = JSON.parse(await meta.text());
    if (m && m.generationId) headers.set("x-iu-ndic-generation-id", String(m.generationId));
    if (m && m.sourceLastModified) headers.set("x-iu-ndic-source-last-modified", String(m.sourceLastModified));
    if (m && m.publishedAt) headers.set("x-iu-ndic-published-at", String(m.publishedAt));
    if (m && m.summary && m.summary.cardCount != null) {
      headers.set("x-iu-ndic-card-count", String(m.summary.cardCount));
    }
  } catch {
    /* ignore */
  }
}

function liveJsonHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-iu-ndic-live-source", "r2");
  if (extra) {
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  }
  return headers;
}

async function writeSnapshotHeadFromFullBody(env: Env, snapBody: string): Promise<boolean> {
  if (!env.TRAFFIC_LIVE || !snapBody) return false;
  try {
    const data = JSON.parse(snapBody) as Record<string, unknown>;
    if (!data || typeof data !== "object") return false;
    const head = slimTrafficSnapshotForEdge(data, 0, TRAFFIC_HEAD_CARD_CAP);
    await env.TRAFFIC_LIVE.put(R2_SNAPSHOT_HEAD_KEY, JSON.stringify(head), {
      httpMetadata: { contentType: "application/json" },
    });
    return true;
  } catch {
    return false;
  }
}

async function serveLiveMeta(env: Env, request: Request): Promise<Response | null> {
  if (!liveEnabled(env) || !env.TRAFFIC_LIVE) return null;
  const meta = await env.TRAFFIC_LIVE.get(R2_META_KEY);
  if (!meta) return null;
  const headers = liveJsonHeaders({ "x-iu-ndic-meta": "1" });
  await attachLiveMetaHeaders(env, headers);
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  // Public observability only — meta already excludes pull secrets.
  return new Response(meta.body, { status: 200, headers });
}

async function serveLiveSnapshot(env: Env, request: Request): Promise<Response | null> {
  if (!liveEnabled(env) || !env.TRAFFIC_LIVE) return null;
  const url = new URL(request.url);
  const wantHead =
    url.searchParams.get("iu_head") === "1" ||
    url.searchParams.get("head") === "1";
  const limitParam = Number(url.searchParams.get("limit") || 0);
  const offsetParam = Math.max(0, Math.floor(Number(url.searchParams.get("offset") || 0) || 0));
  const wantPage = Number.isFinite(limitParam) && limitParam > 0;

  // Fast path: precomputed head (no multi‑MiB transfer to browser).
  if (wantHead || (wantPage && offsetParam === 0)) {
    const lim = wantPage
      ? Math.min(Math.max(Math.floor(limitParam), 1), TRAFFIC_HEAD_CARD_CAP)
      : TRAFFIC_HEAD_CARD_CAP;
    let headObj = await env.TRAFFIC_LIVE.get(R2_SNAPSHOT_HEAD_KEY);
    if (!headObj) {
      const full = await env.TRAFFIC_LIVE.get(R2_SNAPSHOT_KEY);
      if (full) {
        const text = await full.text();
        await writeSnapshotHeadFromFullBody(env, text);
        headObj = await env.TRAFFIC_LIVE.get(R2_SNAPSHOT_HEAD_KEY);
      }
    }
    if (headObj) {
      const headers = liveJsonHeaders({ "x-iu-ndic-snapshot-kind": "head" });
      await attachLiveMetaHeaders(env, headers);
      if (request.method === "HEAD") return new Response(null, { status: 200, headers });
      if (lim < TRAFFIC_HEAD_CARD_CAP) {
        try {
          const parsed = JSON.parse(await headObj.text()) as Record<string, unknown>;
          const cards = Array.isArray(parsed.cards) ? (parsed.cards as unknown[]) : [];
          parsed.cards = cards.slice(0, lim);
          parsed.cardsCappedTo = lim;
          parsed.cardsOffset = 0;
          parsed.edgeSlim = true;
          return new Response(JSON.stringify(parsed), { status: 200, headers });
        } catch {
          /* fall through to raw head body */
        }
      }
      return new Response(headObj.body, { status: 200, headers });
    }
  }

  // Offset page beyond head: parse full once (rare — client should hydrate after head).
  if (wantPage && offsetParam > 0) {
    const full = await env.TRAFFIC_LIVE.get(R2_SNAPSHOT_KEY);
    if (!full) return null;
    const headers = liveJsonHeaders({ "x-iu-ndic-snapshot-kind": "page" });
    await attachLiveMetaHeaders(env, headers);
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    try {
      const data = JSON.parse(await full.text()) as Record<string, unknown>;
      const slim = slimTrafficSnapshotForEdge(data, offsetParam, limitParam);
      return new Response(JSON.stringify(slim), { status: 200, headers });
    } catch {
      return null;
    }
  }

  const obj = await env.TRAFFIC_LIVE.get(R2_SNAPSHOT_KEY);
  if (!obj) return null;
  const headers = liveJsonHeaders({ "x-iu-ndic-snapshot-kind": "full" });
  await attachLiveMetaHeaders(env, headers);
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
  // First-paint head (≤200 cards) — browsers must not download the full multi‑MiB catalog.
  const headOk = await writeSnapshotHeadFromFullBody(env, snapBody);

  return json({
    ok: true,
    reason: "PUBLISHED",
    ATOMIC_PUBLICATION_PASS: "YES",
    generationId: meta.generationId,
    publishedAt: meta.publishedAt,
    payloadBytes: snapBody.length,
    publishWire,
    headWritten: headOk === true,
    headCardCap: TRAFFIC_HEAD_CARD_CAP,
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
      pathname === TRAFFIC_LIVE_META_PATH &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const liveMeta = await serveLiveMeta(env, request);
      if (liveMeta) return liveMeta;
      return fetchOrigin(request);
    }

    if (
      pathname === TRAFFIC_SNAPSHOT_PATH &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const live = await serveLiveSnapshot(env, request);
      if (live) return live;
      // fall through to origin Pages
      return fetchOrigin(request);
    }

    if (isDataOrVersionPath(pathname)) {
      return fetchOrigin(request);
    }

    const destPath = redirectTarget(pathname);
    if (!destPath) {
      return fetchOriginMaybePromoteCsp(request, pathname);
    }

    const dest = new URL(url.toString());
    dest.pathname = destPath;
    return Response.redirect(dest.toString(), 301);
  },
};

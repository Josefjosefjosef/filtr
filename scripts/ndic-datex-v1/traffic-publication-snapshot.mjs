/**
 * Atomic offline publication snapshot (never activates live publication).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PUBLICATION_LAYER_FLAGS,
  PUBLICATION_ERROR,
} from "./traffic-publication-constants.mjs";
import { scanPublicationCanaries } from "./traffic-publication-projection.mjs";

export const SNAPSHOT_SCHEMA_VERSION = "iu-traffic-offline-snapshot-v1";
/**
 * Live NDIC UI snapshot cap.
 * Raised 8→12 MiB after prod freeze at 8383448/8388608 (PUB_SNAPSHOT_TOO_LARGE → stale R2).
 * Raised 12→16 MiB after SituationRecord expansion (~14.7 MiB compact cards body, OVER_BY≈2.1 MiB).
 */
export const DEFAULT_MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

function utf8Bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/**
 * Section byte breakdown for forensic size audits (no payloads retained).
 */
export function measureSnapshotSizeBreakdown(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return { ok: false, rejectCode: "SNAP_INVALID_OBJECT" };
  }
  const metadata = {
    schema: snapshot.schema,
    snapshotVersion: snapshot.snapshotVersion,
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.generatedAt,
    sourceFreshness: snapshot.sourceFreshness,
    eventCount: snapshot.eventCount,
    feedCount: snapshot.feedCount,
    cardCount: snapshot.cardCount,
    historyCount: snapshot.historyCount,
    dataAge: snapshot.dataAge,
    publicationEnabled: snapshot.publicationEnabled,
    publicApiEnabled: snapshot.publicApiEnabled,
    trafficUiEnabled: snapshot.trafficUiEnabled,
  };
  const sections = {
    metadata: utf8Bytes(metadata),
    projections: utf8Bytes(snapshot.projections || []),
    feed: utf8Bytes(snapshot.feed || null),
    cards: utf8Bytes(snapshot.cards || []),
    historyItems: utf8Bytes(snapshot.historyItems || []),
    filterIndexes: utf8Bytes(snapshot.filterIndexes || {}),
  };
  let cardsMapLink = 0;
  let cardsText = 0;
  let cardsProvenance = 0;
  for (const c of snapshot.cards || []) {
    if (!c || typeof c !== "object") continue;
    cardsMapLink += utf8Bytes(c.mapTarget || null);
    cardsText += utf8Bytes({
      impact: c.impact,
      location: c.location,
      section: c.section,
      road: c.road,
      feed: c.feed,
      locationDisclosureCs: c.locationDisclosureCs,
    });
    cardsProvenance += utf8Bytes(c.fieldProvenance || {});
  }
  const full = utf8Bytes(snapshot);
  return {
    ok: true,
    ...sections,
    cardsMapLink,
    cardsText,
    cardsProvenance,
    duplicateStack: sections.projections + sections.feed + sections.cards,
    FULL_SNAPSHOT: full,
    LIMIT_DEFAULT: DEFAULT_MAX_SNAPSHOT_BYTES,
    OVER_BY: Math.max(0, full - DEFAULT_MAX_SNAPSHOT_BYTES),
  };
}

/**
 * Compact UI-hosted snapshot: cards + metadata only.
 * Drops duplicate projections/feed/history/filterIndexes and empty fieldProvenance.
 * Does not change publication-layer projection/card builders.
 */
export function compactTrafficUiSnapshotPayload(payload, opts = {}) {
  const cardsIn = Array.isArray(payload && payload.cards) ? payload.cards : [];
  const cards = cardsIn.map((c) => {
    if (!c || typeof c !== "object") return c;
    // Keep schema-compatible empty provenance object (UI tolerates {}).
    const next = { ...c, fieldProvenance: {} };
    return next;
  });
  const nowIso = opts.nowIso || (payload && payload.generatedAt) || new Date().toISOString();
  return {
    sourceFreshness: (payload && payload.sourceFreshness) || "UNKNOWN",
    dataAge: payload && payload.dataAge != null ? payload.dataAge : null,
    // Counts reflect source layer; compact body omits duplicate arrays.
    projections: [],
    feed: {
      schema: "iu-traffic-publication-feed-v1",
      publicationEnabled: false,
      trafficUiEnabled: PUBLICATION_LAYER_FLAGS.TRAFFIC_UI_ENABLED === true,
      itemCount: 0,
      items: [],
      builtAt: nowIso,
    },
    cards,
    historyItems: [],
    filterIndexes: {},
    eventCountHint:
      payload && Array.isArray(payload.projections) ? payload.projections.length : cards.length,
  };
}

/**
 * Finalize snapshot atomically under workDir. publicationEnabled always false.
 */
export function buildOfflinePublicationSnapshot(payload, opts = {}) {
  if (PUBLICATION_LAYER_FLAGS.PUBLICATION_ENABLED === true) {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_ENABLED_FORBIDDEN };
  }
  if (opts.forcePartial === true) {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_PARTIAL_SNAPSHOT };
  }
  if (!payload || typeof payload !== "object") {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_INPUT_INVALID };
  }

  const useCompact = opts.uiCompact === true;
  const source = useCompact ? compactTrafficUiSnapshotPayload(payload, opts) : payload;
  const cardCount = (source.cards || []).length;
  const eventCount =
    useCompact && source.eventCountHint != null
      ? source.eventCountHint
      : (source.projections || []).length;

  const snapshot = {
    schema: SNAPSHOT_SCHEMA_VERSION,
    snapshotVersion: opts.snapshotVersion || crypto.randomBytes(8).toString("hex"),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: opts.nowIso || new Date().toISOString(),
    sourceFreshness: source.sourceFreshness || "UNKNOWN",
    eventCount,
    feedCount: source.feed && source.feed.itemCount != null ? source.feed.itemCount : 0,
    cardCount,
    historyCount: (source.historyItems || []).length,
    dataAge: source.dataAge || null,
    publicationEnabled: false,
    publicApiEnabled: false,
    trafficUiEnabled: PUBLICATION_LAYER_FLAGS.TRAFFIC_UI_ENABLED === true,
    projections: source.projections || [],
    feed: source.feed || null,
    cards: source.cards || [],
    historyItems: source.historyItems || [],
    filterIndexes: source.filterIndexes || {},
  };

  const canary = scanPublicationCanaries(snapshot);
  if (!canary.ok) {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_SECURITY_CANARY_DETECTED, hits: canary.hits };
  }

  const body = Buffer.from(JSON.stringify(snapshot), "utf8");
  const maxBytes =
    opts.maxSnapshotBytes != null ? opts.maxSnapshotBytes : DEFAULT_MAX_SNAPSHOT_BYTES;
  if (body.length > maxBytes) {
    const breakdown = measureSnapshotSizeBreakdown(snapshot);
    return {
      ok: false,
      rejectCode: PUBLICATION_ERROR.PUB_SNAPSHOT_TOO_LARGE,
      bytes: body.length,
      maxBytes,
      sizeBreakdown: breakdown,
    };
  }

  const sizeBreakdown = measureSnapshotSizeBreakdown(snapshot);

  if (!opts.workDir) {
    return {
      ok: true,
      snapshot,
      bytes: body.length,
      sizeBreakdown,
      uiCompact: useCompact,
      activated: false,
      publicationEnabled: false,
    };
  }

  const workDir = opts.workDir;
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const staging = path.join(workDir, "snapshot.partial.json");
  const finalPath = path.join(workDir, "snapshot.json");
  fs.writeFileSync(staging, body, { mode: 0o600 });
  // Atomic replace
  try {
    if (fs.existsSync(finalPath)) fs.rmSync(finalPath, { force: true });
  } catch (_) {}
  fs.renameSync(staging, finalPath);

  return {
    ok: true,
    snapshot,
    bytes: body.length,
    sizeBreakdown,
    uiCompact: useCompact,
    pathCategory: "task_owned",
    activated: false,
    publicationEnabled: false,
    finalBasename: "snapshot.json",
  };
}

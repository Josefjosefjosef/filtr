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

  const snapshot = {
    schema: SNAPSHOT_SCHEMA_VERSION,
    snapshotVersion: opts.snapshotVersion || crypto.randomBytes(8).toString("hex"),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: opts.nowIso || new Date().toISOString(),
    sourceFreshness: payload.sourceFreshness || "UNKNOWN",
    eventCount: (payload.projections || []).length,
    feedCount: payload.feed && payload.feed.itemCount != null ? payload.feed.itemCount : 0,
    cardCount: (payload.cards || []).length,
    historyCount: (payload.historyItems || []).length,
    dataAge: payload.dataAge || null,
    publicationEnabled: false,
    publicApiEnabled: false,
    trafficUiEnabled: PUBLICATION_LAYER_FLAGS.TRAFFIC_UI_ENABLED === true,
    projections: payload.projections || [],
    feed: payload.feed || null,
    cards: payload.cards || [],
    historyItems: payload.historyItems || [],
    filterIndexes: payload.filterIndexes || {},
  };

  const canary = scanPublicationCanaries(snapshot);
  if (!canary.ok) {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_SECURITY_CANARY_DETECTED, hits: canary.hits };
  }

  const body = Buffer.from(JSON.stringify(snapshot), "utf8");
  const maxBytes = opts.maxSnapshotBytes != null ? opts.maxSnapshotBytes : 8 * 1024 * 1024;
  if (body.length > maxBytes) {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_SNAPSHOT_TOO_LARGE };
  }

  if (!opts.workDir) {
    return {
      ok: true,
      snapshot,
      bytes: body.length,
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
    pathCategory: "task_owned",
    activated: false,
    publicationEnabled: false,
    finalBasename: "snapshot.json",
  };
}

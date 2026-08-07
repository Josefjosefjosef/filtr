/**
 * Persist offline traffic UI snapshot when TRAFFIC_UI_ENABLED.
 * Does not flip PUBLICATION_ENABLED (inverted kill switch stays false).
 * Does not call parser / importer / resolver — consumes already-gated feed items only.
 */
import fs from "node:fs";
import path from "node:path";
import { opaqueHash } from "./traffic-event-model.mjs";
import { RESOLVER_STATUS } from "./datex-tmc-resolver-constants.mjs";
import { PUBLICATION_LAYER_FLAGS } from "./traffic-publication-constants.mjs";
import { runTrafficPublicationLayer } from "./traffic-publication-layer.mjs";

export const TRAFFIC_UI_SNAPSHOT_REL =
  path.join("projects", "data", "info_events", "ndic_datex_v1", "traffic_offline_snapshot.json");

function prov(value, source, ts, status) {
  return {
    value: value == null ? null : value,
    source: source || "feed",
    sourceTimestamp: ts || null,
    lastChangedAt: ts || null,
    validationStatus: status || "validated",
    confidenceClass: "VERIFIED_SOURCE_FIELD",
  };
}

/**
 * Map a gate-passed NDIC feed item → publication-layer normalized event.
 * Fail-closed: precise geo only when localizationTrust is verified.
 */
export function feedItemToPublicationEvent(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || item.publicEventId || "").trim();
  if (!id) return null;
  const trust = String(item.localizationTrust || "none");
  const precise =
    trust === "tmc" || trust === "openlr" || trust === "coordinates";
  const ts =
    item.lastChangedAt ||
    item.updatedAt ||
    item.publishedAt ||
    item.publishedAtSource ||
    null;
  const road = item.roadNumber || item.road || null;
  const km = precise && (item.km != null || item.kilometer != null) ? (item.km != null ? item.km : item.kilometer) : null;
  const direction = precise && item.direction != null ? item.direction : null;
  const eventIdHash = opaqueHash("evt:" + id);
  const locations = [];
  if (precise && (road || (item.lat != null && item.lon != null))) {
    locations.push({
      inputReferenceType: trust === "openlr" ? "openlr" : "alert_c_point",
      direction: direction ? { value: direction } : null,
      road: road ? { roadNumber: road } : null,
      primaryLocation: null,
      secondaryLocation: null,
      coordinates:
        item.lat != null && item.lon != null
          ? { lat: item.lat, lon: item.lon }
          : null,
      administrativeArea: item.region || item.locality || null,
      kilometerStatus: km != null ? { value: km } : null,
      offsets: null,
      tmcImportRunId: null,
      freshness: "FRESH",
    });
  }
  return Object.freeze({
    schema: "iu-normalized-traffic-event-v1",
    eventIdHash,
    locationPublishable: precise && locations.length > 0,
    locationResolutionStatus: precise
      ? RESOLVER_STATUS.RESOLVED_BASIC
      : RESOLVER_STATUS.UNRESOLVED_MISSING_REFERENCE,
    locations: Object.freeze(locations),
    quarantine: item.quarantine === true,
    quarantineReason: item.quarantineReason || null,
    fields: Object.freeze({
      status: prov(item.status || "aktivni", "feed", ts),
      trafficCategory: prov(item.eventType || item.category || "ostatni", "feed", ts),
      severity: prov(item.importance != null ? String(item.importance) : "medium", "feed", ts),
      titleSafe: prov(item.title || "Dopravní událost", "feed", ts),
      summarySafe: prov(item.description || item.title || "", "feed", ts),
      validFrom: prov(item.startsAt || item.validFrom || ts, "feed", ts),
      validTo: prov(item.endsAt || item.validTo || null, "feed", ts),
      roadNumber: precise && road ? prov(road, "feed", ts, "validated") : prov(null, "feed", ts, "not_public"),
      direction:
        precise && direction
          ? prov(direction, "feed", ts, "validated")
          : prov(null, "feed", ts, "not_public"),
      kilometer:
        precise && km != null
          ? prov(km, "feed", ts, "validated")
          : prov(null, "feed", ts, "not_public"),
      administrativeArea: prov(
        item.locality || (item.region && item.region.name) || null,
        "feed",
        ts
      ),
      lastMeaningfulChangeAt: prov(ts, "feed", ts),
    }),
  });
}

/**
 * Build + atomically write hosted offline snapshot for TRAFFIC_UI.
 * @returns {{ ok: boolean, rejectCode?: string, path?: string, cardCount?: number, trafficUiEnabled?: boolean }}
 */
export function persistTrafficUiOfflineSnapshot(feedItems, opts = {}) {
  if (PUBLICATION_LAYER_FLAGS.TRAFFIC_UI_ENABLED !== true) {
    return { ok: false, rejectCode: "TRAFFIC_UI_DISABLED" };
  }
  if (PUBLICATION_LAYER_FLAGS.PUBLICATION_ENABLED === true) {
    return { ok: false, rejectCode: "PUB_ENABLED_FORBIDDEN" };
  }
  const list = Array.isArray(feedItems) ? feedItems : [];
  const events = [];
  for (const it of list) {
    const ev = feedItemToPublicationEvent(it);
    if (ev) events.push(ev);
  }
  const layer = runTrafficPublicationLayer(events, {
    nowIso: opts.nowIso,
    sourceFreshness: opts.sourceFreshness || "FRESH",
    dataAge: opts.dataAge || null,
    maxSnapshotBytes: opts.maxSnapshotBytes,
  });
  if (!layer.ok || !layer.snapshot) {
    return { ok: false, rejectCode: layer.rejectCode || "PUB_LAYER_FAILED" };
  }
  const repoRoot = opts.repoRoot || process.cwd();
  const rel = opts.relPath || TRAFFIC_UI_SNAPSHOT_REL;
  const dest = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o755 });
  const tmp = dest + ".partial";
  const body = JSON.stringify(layer.snapshot);
  fs.writeFileSync(tmp, body, { encoding: "utf8", mode: 0o644 });
  try {
    if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  } catch (_) {}
  fs.renameSync(tmp, dest);
  return {
    ok: true,
    path: dest,
    cardCount: (layer.cards || []).length,
    trafficUiEnabled: layer.trafficUiEnabled === true,
    publicationEnabled: false,
  };
}

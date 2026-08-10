/**
 * Persist offline traffic UI snapshot when TRAFFIC_UI_ENABLED.
 * Does not flip PUBLICATION_ENABLED (inverted kill switch stays false).
 * Does not call parser / importer / resolver — consumes already-gated feed items only.
 *
 * Hosted write sequence (fail-closed, no delete-first window without last-good):
 *  1) build+validate via publication layer (schema/canary/cards)
 *  2) serialize body
 *  3) write same-dir temp (.new)
 *  4) re-read temp + validateBeforeCommit
 *  5) if live dest exists → copy to .last-good.json (preserve LKG)
 *  6) replace live: on win32 unlink dest only AFTER LKG exists, then rename temp→dest
 *  7) on any replace failure → restore last-good → dest when needed
 */
import fs from "node:fs";
import path from "node:path";
import { opaqueHash } from "./traffic-event-model.mjs";
import { RESOLVER_STATUS } from "./datex-tmc-resolver-constants.mjs";
import { PUBLICATION_LAYER_FLAGS } from "./traffic-publication-constants.mjs";
import { runTrafficPublicationLayer } from "./traffic-publication-layer.mjs";
import { scanPublicationCanaries } from "./traffic-publication-projection.mjs";
import { validatePublicationSchemas } from "./traffic-publication-schema.mjs";
import { SNAPSHOT_SCHEMA_VERSION } from "./traffic-publication-snapshot.mjs";
import {
  classifyRoadNumber,
  extractLocalityFromOfficialComment,
  humanDirectionOrNull,
  pickRsdTimelineTimestamp,
} from "./traffic-card-content-v1.mjs";

export const TRAFFIC_UI_SNAPSHOT_REL = path.join(
  "projects",
  "data",
  "info_events",
  "ndic_datex_v1",
  "traffic_offline_snapshot.json"
);

/** Filename under info_events/ndic_datex_v1/ (candidate or live shared state). */
export const TRAFFIC_UI_SNAPSHOT_BASENAME = "traffic_offline_snapshot.json";

/**
 * Canonical dest for offline snapshot.
 * When infoEventsDir is set (prep sandbox / IU_INFO_EVENTS_DATA_DIR), write into that tree
 * so the candidate artifact includes the REQUIRED snapshot (ACTIVE incident 31257122613).
 */
export function resolveTrafficUiSnapshotDestPath({ repoRoot, infoEventsDir } = {}) {
  if (infoEventsDir) {
    return path.join(
      path.resolve(infoEventsDir),
      "ndic_datex_v1",
      TRAFFIC_UI_SNAPSHOT_BASENAME
    );
  }
  const root = repoRoot || process.cwd();
  return path.join(path.resolve(root), TRAFFIC_UI_SNAPSHOT_REL);
}

export const TRAFFIC_UI_SNAPSHOT_LAST_GOOD_SUFFIX = ".last-good.json";
export const TRAFFIC_UI_SNAPSHOT_TEMP_SUFFIX = ".new";

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
  const precise = trust === "tmc" || trust === "openlr" || trust === "coordinates";
  const timeline = pickRsdTimelineTimestamp({
    versionTime: item.lastUpdatedBySource || item.versionTime || null,
    creationTime: item.publishedAtSource || item.publishedAt || item.createdAt || null,
    publicationTime: item.publicationTime || null,
    downloadedAt: item.firstSeenByInfoUzel || item.downloadedAt || null,
    allowDownloadFallback: true,
  });
  const ts = timeline.iso;
  const road = item.roadNumber || item.road || null;
  const roadClass = road ? classifyRoadNumber(road) : "UNKNOWN";
  const km =
    precise && (item.km != null || item.kilometer != null)
      ? item.km != null
        ? item.km
        : item.kilometer
      : null;
  const directionRaw = precise && item.direction != null ? item.direction : null;
  const direction = humanDirectionOrNull(directionRaw);
  const summaryFullRaw = String(
    item.summaryFull || item.commentFull || item.summary || item.description || ""
  ).trim();
  const officialSummary = String(item.summary || item.description || "").trim();
  // Prefer untruncated source comment for locality extraction when available.
  const locBits = extractLocalityFromOfficialComment(summaryFullRaw || officialSummary);
  const regionName =
    (item.region && (item.region.name || item.region.summary)) || item.locality || null;
  const adminLabel =
    locBits.municipality ||
    (regionName && !/^česká republika$/i.test(String(regionName)) ? regionName : null) ||
    (locBits.district ? "okres " + locBits.district : null);
  const sourceSeverity =
    item.severity != null && String(item.severity).trim() !== ""
      ? String(item.severity).trim()
      : null;
  const ndic = item.ndicV1 && typeof item.ndicV1 === "object" ? item.ndicV1 : {};
  const eventIdHash = opaqueHash("evt:" + id);
  const locations = [];
  if (precise && (road || (item.lat != null && item.lon != null))) {
    locations.push({
      inputReferenceType: trust === "openlr" ? "openlr" : "alert_c_point",
      direction: direction ? { value: direction } : null,
      road: road ? { roadNumber: road, roadClass } : null,
      primaryLocation: null,
      secondaryLocation: null,
      coordinates:
        item.lat != null && item.lon != null ? { lat: item.lat, lon: item.lon } : null,
      administrativeArea: adminLabel || item.region || item.locality || null,
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
    sourceTimestamps: Object.freeze({
      datexUpdatedAt: item.lastUpdatedBySource || null,
      datexCreatedAt: item.publishedAtSource || item.publishedAt || null,
      datexDownloadedAt: item.firstSeenByInfoUzel || null,
      datexMeasuredAt: null,
      timelineField: timeline.field,
      timelineSemantics: timeline.semantics,
    }),
    stableIdentity: Object.freeze({
      situationId: item.sourceSituationId || ndic.situationId || null,
      recordId: ndic.recordId || null,
      revisionKey: item.revisionKey || null,
      feedItemId: id,
    }),
    quarantine: item.quarantine === true,
    quarantineReason: item.quarantineReason || null,
    fields: Object.freeze({
      status: prov(item.status || "aktivni", "feed", ts),
      trafficCategory: prov(item.eventType || item.category || "ostatni", "feed", ts),
      // Never invent severity — only persist when source provides it.
      severity: sourceSeverity
        ? prov(sourceSeverity, "feed", ts)
        : prov(null, "feed", ts, "not_public"),
      titleSafe: prov(item.title || "Dopravní událost", "feed", ts),
      summarySafe: prov(officialSummary || "", "feed", ts),
      summaryFull: prov(summaryFullRaw || officialSummary || "", "feed", ts),
      validFrom: prov(item.startsAt || item.validFrom || null, "feed", ts),
      validTo: prov(item.endsAt || item.validTo || null, "feed", ts),
      roadNumber: road ? prov(road, "feed", ts, "validated") : prov(null, "feed", ts, "not_public"),
      roadClass: road ? prov(roadClass, "feed", ts, "validated") : prov(null, "feed", ts, "not_public"),
      direction: direction
        ? prov(direction, "feed", ts, "validated")
        : prov(null, "feed", ts, "not_public"),
      kilometer:
        precise && km != null
          ? prov(km, "feed", ts, "validated")
          : prov(null, "feed", ts, "not_public"),
      administrativeArea: adminLabel
        ? prov(adminLabel, "feed", ts, "validated")
        : prov(null, "feed", ts, "not_public"),
      district: locBits.district
        ? prov(locBits.district, "feed", ts, "validated")
        : prov(null, "feed", ts, "not_public"),
      municipality: locBits.municipality
        ? prov(locBits.municipality, "feed", ts, "validated")
        : prov(null, "feed", ts, "not_public"),
      lastMeaningfulChangeAt: prov(ts, "feed", ts),
      changeTimeSource: prov(timeline.changeTimeSource, "feed", ts),
      timelineField: prov(timeline.field, "feed", ts),
    }),
  });
}

export function trafficUiSnapshotPaths(destPath) {
  const dest = path.resolve(destPath);
  const dir = path.dirname(dest);
  const base = path.basename(dest, path.extname(dest));
  // last-good: traffic_offline_snapshot.last-good.json (sibling, same filesystem)
  const lastGood = path.join(dir, base + TRAFFIC_UI_SNAPSHOT_LAST_GOOD_SUFFIX);
  const temp = dest + TRAFFIC_UI_SNAPSHOT_TEMP_SUFFIX;
  return { dest, dir, lastGood, temp };
}

/**
 * Validate a parsed snapshot object before it may become live.
 */
export function validateTrafficUiSnapshotBeforeCommit(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return { ok: false, rejectCode: "SNAP_INVALID_OBJECT" };
  }
  if (snapshot.schema !== SNAPSHOT_SCHEMA_VERSION && snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return { ok: false, rejectCode: "SNAP_SCHEMA_MISMATCH" };
  }
  if (snapshot.publicationEnabled === true) {
    return { ok: false, rejectCode: "PUB_ENABLED_FORBIDDEN" };
  }
  if (PUBLICATION_LAYER_FLAGS.PUBLICATION_ENABLED === true) {
    return { ok: false, rejectCode: "PUB_ENABLED_FORBIDDEN" };
  }
  if (snapshot.publicApiEnabled === true) {
    return { ok: false, rejectCode: "PUBLIC_API_FORBIDDEN" };
  }
  const canary = scanPublicationCanaries(snapshot);
  if (!canary.ok) {
    return { ok: false, rejectCode: "PUB_SECURITY_CANARY_DETECTED", hits: canary.hits };
  }
  const schemaCheck = validatePublicationSchemas({
    projections: snapshot.projections || [],
    feed: snapshot.feed || { items: [] },
    cards: snapshot.cards || [],
    historyItems: snapshot.historyItems || [],
  });
  if (!schemaCheck.ok) {
    return { ok: false, rejectCode: "PUB_SCHEMA_VIOLATION", schemaErrors: schemaCheck.errors };
  }
  return { ok: true };
}

function tryUnlink(p) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  } catch (_) {}
}

function copyFileSafe(src, dest) {
  fs.copyFileSync(src, dest);
  try {
    const fd = fs.openSync(dest, "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    /* fsync optional on some FS */
  }
}

/**
 * Restore last-good over dest when live is missing/invalid.
 * @returns {{ ok: boolean, restored: boolean, rejectCode?: string }}
 */
export function restoreTrafficUiSnapshotFromLastGood(destPath) {
  const { dest, lastGood } = trafficUiSnapshotPaths(destPath);
  if (!fs.existsSync(lastGood)) {
    return { ok: false, restored: false, rejectCode: "LAST_GOOD_MISSING" };
  }
  try {
    const raw = fs.readFileSync(lastGood, "utf8");
    const parsed = JSON.parse(raw);
    const v = validateTrafficUiSnapshotBeforeCommit(parsed);
    if (!v.ok) return { ok: false, restored: false, rejectCode: v.rejectCode || "LAST_GOOD_INVALID" };
    copyFileSafe(lastGood, dest);
    return { ok: true, restored: true };
  } catch (e) {
    return { ok: false, restored: false, rejectCode: "LAST_GOOD_RESTORE_FAILED" };
  }
}

/**
 * Build + safely write hosted offline snapshot for TRAFFIC_UI.
 * @returns {{ ok: boolean, rejectCode?: string, path?: string, lastGoodPath?: string, cardCount?: number, trafficUiEnabled?: boolean, publicationEnabled?: boolean, writeSequence?: string[] }}
 */
export function persistTrafficUiOfflineSnapshot(feedItems, opts = {}) {
  const writeSequence = [];
  if (PUBLICATION_LAYER_FLAGS.TRAFFIC_UI_ENABLED !== true) {
    return { ok: false, rejectCode: "TRAFFIC_UI_DISABLED", writeSequence };
  }
  if (PUBLICATION_LAYER_FLAGS.PUBLICATION_ENABLED === true) {
    return { ok: false, rejectCode: "PUB_ENABLED_FORBIDDEN", writeSequence };
  }
  if (opts.forceTempWriteFail === true) {
    writeSequence.push("TEMP_WRITE_FORCED_FAIL");
    return { ok: false, rejectCode: "TEMP_WRITE_FAILED", writeSequence };
  }

  const list = Array.isArray(feedItems) ? feedItems : [];
  const events = [];
  for (const it of list) {
    const ev = feedItemToPublicationEvent(it);
    if (ev) events.push(ev);
  }
  writeSequence.push("LAYER_BUILD");
  const layer = runTrafficPublicationLayer(events, {
    nowIso: opts.nowIso,
    sourceFreshness: opts.sourceFreshness || "FRESH",
    dataAge: opts.dataAge || null,
    maxSnapshotBytes: opts.maxSnapshotBytes,
    // Compact cards-only body for hosted UI (drops duplicate projections/feed/history/indexes).
    uiCompact: opts.uiCompact !== false,
  });
  if (!layer.ok || !layer.snapshot) {
    return {
      ok: false,
      rejectCode: layer.rejectCode || "PUB_LAYER_FAILED",
      writeSequence,
      sizeBreakdown: layer.sizeBreakdown || null,
      bytes: layer.bytes || 0,
    };
  }

  writeSequence.push("VALIDATE_IN_MEMORY");
  const pre = validateTrafficUiSnapshotBeforeCommit(layer.snapshot);
  if (!pre.ok || opts.forceValidationFail === true) {
    return {
      ok: false,
      rejectCode: opts.forceValidationFail === true ? "VALIDATION_FORCED_FAIL" : pre.rejectCode,
      writeSequence,
      hits: pre.hits,
    };
  }

  const repoRoot = opts.repoRoot || process.cwd();
  const rel = opts.relPath || TRAFFIC_UI_SNAPSHOT_REL;
  const destPath = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
  const { dest, dir, lastGood, temp } = trafficUiSnapshotPaths(destPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });

  // Same-filesystem temp (sibling of dest).
  if (path.dirname(temp) !== dir) {
    return { ok: false, rejectCode: "TEMP_NOT_SAME_FILESYSTEM_DIR", writeSequence };
  }

  const body = JSON.stringify(layer.snapshot);
  writeSequence.push("TEMP_WRITE");
  try {
    fs.writeFileSync(temp, body, { encoding: "utf8", mode: 0o644 });
    try {
      const fd = fs.openSync(temp, "r+");
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch (_) {}
  } catch (_) {
    tryUnlink(temp);
    return { ok: false, rejectCode: "TEMP_WRITE_FAILED", writeSequence };
  }

  writeSequence.push("VALIDATE_TEMP_ON_DISK");
  let diskSnap;
  try {
    diskSnap = JSON.parse(fs.readFileSync(temp, "utf8"));
  } catch (_) {
    tryUnlink(temp);
    return { ok: false, rejectCode: "TEMP_READBACK_FAILED", writeSequence };
  }
  const diskVal = validateTrafficUiSnapshotBeforeCommit(diskSnap);
  if (!diskVal.ok) {
    tryUnlink(temp);
    return { ok: false, rejectCode: diskVal.rejectCode || "TEMP_VALIDATION_FAILED", writeSequence };
  }

  const hadLive = fs.existsSync(dest);
  if (hadLive) {
    writeSequence.push("PRESERVE_LAST_GOOD");
    try {
      // Prefer validating current live before promoting to LKG; if live is already bad, keep prior LKG.
      let promote = true;
      try {
        const liveParsed = JSON.parse(fs.readFileSync(dest, "utf8"));
        promote = validateTrafficUiSnapshotBeforeCommit(liveParsed).ok === true;
      } catch (_) {
        promote = false;
      }
      if (promote) {
        copyFileSafe(dest, lastGood);
      } else if (!fs.existsSync(lastGood)) {
        // No valid live and no LKG — do not invent LKG from invalid live.
        writeSequence.push("LIVE_INVALID_NO_LKG");
      }
    } catch (_) {
      tryUnlink(temp);
      return { ok: false, rejectCode: "LAST_GOOD_PRESERVE_FAILED", writeSequence };
    }
  }

  if (opts.forceReplaceFail === true) {
    writeSequence.push("REPLACE_FORCED_FAIL");
    tryUnlink(temp);
    // Live untouched (or LKG already preserved). Never leave missing live without restore attempt.
    if (hadLive && !fs.existsSync(dest) && fs.existsSync(lastGood)) {
      restoreTrafficUiSnapshotFromLastGood(dest);
    }
    return {
      ok: false,
      rejectCode: "REPLACE_FAILED",
      writeSequence,
      lastGoodPath: fs.existsSync(lastGood) ? lastGood : null,
    };
  }

  writeSequence.push("ATOMIC_REPLACE");
  try {
    // Windows cannot rename over existing file. Only unlink dest AFTER last-good exists (or first write).
    if (fs.existsSync(dest)) {
      if (!fs.existsSync(lastGood)) {
        // Safety: never delete live without LKG.
        copyFileSafe(dest, lastGood);
        writeSequence.push("LAST_GOOD_CREATED_BEFORE_UNLINK");
      }
      fs.rmSync(dest, { force: true });
      writeSequence.push("UNLINK_LIVE_AFTER_LKG");
    }
    fs.renameSync(temp, dest);
    writeSequence.push("RENAME_TEMP_TO_LIVE");
  } catch (_) {
    writeSequence.push("REPLACE_FAILED");
    tryUnlink(temp);
    if (!fs.existsSync(dest) && fs.existsSync(lastGood)) {
      const restored = restoreTrafficUiSnapshotFromLastGood(dest);
      writeSequence.push(restored.ok ? "RESTORED_FROM_LAST_GOOD" : "RESTORE_FAILED");
    }
    return {
      ok: false,
      rejectCode: "REPLACE_FAILED",
      writeSequence,
      lastGoodPath: fs.existsSync(lastGood) ? lastGood : null,
    };
  }

  // Final live re-validate; if somehow poison, restore LKG.
  try {
    const live = JSON.parse(fs.readFileSync(dest, "utf8"));
    const liveVal = validateTrafficUiSnapshotBeforeCommit(live);
    if (!liveVal.ok) {
      writeSequence.push("LIVE_POST_VALIDATE_FAIL");
      tryUnlink(dest);
      const restored = restoreTrafficUiSnapshotFromLastGood(dest);
      return {
        ok: false,
        rejectCode: "LIVE_INVALID_AFTER_REPLACE",
        writeSequence,
        restored: restored.ok === true,
        lastGoodPath: lastGood,
      };
    }
  } catch (_) {
    writeSequence.push("LIVE_POST_READ_FAIL");
    tryUnlink(dest);
    restoreTrafficUiSnapshotFromLastGood(dest);
    return { ok: false, rejectCode: "LIVE_READ_AFTER_REPLACE_FAILED", writeSequence };
  }

  return {
    ok: true,
    path: dest,
    lastGoodPath: fs.existsSync(lastGood) ? lastGood : null,
    cardCount: (layer.snapshot && layer.snapshot.cardCount) || (layer.cards || []).length,
    bytes: layer.snapshotBytes || 0,
    sizeBreakdown: layer.sizeBreakdown || null,
    uiCompact: layer.uiCompact === true,
    trafficUiEnabled: layer.trafficUiEnabled === true,
    publicationEnabled: false,
    writeSequence,
    deleteBeforeRenameWithoutLastGood: false,
  };
}

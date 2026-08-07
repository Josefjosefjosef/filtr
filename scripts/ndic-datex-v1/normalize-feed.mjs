/**
 * Normalize parsed DATEX situations → info_events feed items (source-neutral shape).
 */
import path from "path";
import { fileURLToPath } from "url";
import {
  NDIC_SOURCE_ID,
  NDIC_ADAPTER_OWNER,
  NDIC_ATTRIBUTION_SHORT,
  NDIC_ATTRIBUTION_FULL,
  NDIC_PUBLIC_PORTAL_URL,
  PARSER_VERSION,
} from "./config.mjs";
import { buildSituationIdentity, contentFingerprint } from "./identity.mjs";
import { classifyTrafficLifecycle, classifyChangeSignificance, compareRevisions } from "./lifecycle.mjs";
import { localizeFromTmc } from "./tmc-localize.mjs";
import { chooseLocationProfileBucket, chooseNoSignalSubtype } from "./location-forensic-probe.mjs";
import { resolveOpenlrLocation } from "./openlr-resolve.mjs";
import { OPENLR_STATUS } from "./openlr-constants.mjs";
import { SUPPLEMENTARY_CLASS } from "./supplementary-location.mjs";
import { buildTrafficTitle, buildTrafficSummary } from "./title.mjs";
import {
  attachLegalProvenance,
  canPublishFromSource,
  loadLegalRegistry,
  loadSourceRegistry,
} from "../iu-info-events-legal-registry-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = path.resolve(__dirname, "../..");

export function isPublishableNdicItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.publishable === false) return false;
  if (item.quarantine === true) return false;
  const st = String(item.status || "");
  return st === "aktivni" || st === "naplanovano";
}

/**
 * @param {object} situation — parseDatex output situation
 * @param {{ tmcTable?: object|null, nowIso?: string, geoRegistry?: object|null, firstSeenMap?: Map|object }} [opts]
 */
export function situationToFeedItem(situation, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const identity = buildSituationIdentity(situation);
  const primary = (situation.records && situation.records[0]) || {};
  const validity = primary.validity || {};
  let loc = localizeFromTmc(primary.tmcRefs || [], opts.tmcTable || null, {
    coordinates: primary.coordinates || null,
    roadNumber: primary.roadNumber,
    roadName: primary.roadName,
    geoRegistry: opts.geoRegistry || null,
  });
  const openlr = primary.openlrExtract ? resolveOpenlrLocation(primary.openlrExtract) : null;
  if (
    openlr &&
    openlr.status === OPENLR_STATUS.RESOLVED &&
    ["text", "national_fallback", "none"].includes(loc.trust)
  ) {
    loc = {
      ...loc,
      lat: openlr.lat,
      lon: openlr.lon,
      trust: "openlr",
      region: { ...loc.region, confidence: "openlr" },
      forensic: { ...loc.forensic, trustAfterResolver: "openlr" },
    };
  }

  const presence = {
    hasAlertCPoint: false,
    hasAlertCLinear: false,
    hasSpecificLocation: false,
    hasPointCoordinates: false,
    pointCoordinatesValid: false,
    hasOpenLR: false,
    hasGmlPoint: false,
    hasGmlLineString: false,
    hasGmlPolygon: false,
    hasNetworkLocation: false,
    hasSupplementaryPositionalDescription: false,
    ...(primary.locationPresence || {}),
  };
  if (primary.coordinateProbe && primary.coordinateProbe.valid) {
    presence.pointCoordinatesValid = true;
    presence.hasPointCoordinates = true;
  }
  const locationProfileBucket = chooseLocationProfileBucket(presence, loc.trust);
  const supplementary = primary.supplementary || { present: false, classification: SUPPLEMENTARY_CLASS.ABSENT };
  const noSignalSubtype =
    locationProfileBucket === "no_localization_signal" ? chooseNoSignalSubtype(presence) : null;
  const forensic = {
    ...presence,
    locationProfileBucket,
    coordinateProbe: primary.coordinateProbe || { present: false, parsed: false, valid: false },
    openlr: openlr ? {
      status: openlr.status, type: openlr.type, lrpCount: openlr.lrpCount,
      directionDocumented: openlr.directionDocumented, failureReason: openlr.failureReason,
      publicationEligible: openlr.publicationEligible,
    } : null,
    supplementary: supplementary.present
      ? {
          classification: supplementary.classification,
          hasRoadNumber: supplementary.hasRoadNumber === true,
          hasRoadName: supplementary.hasRoadName === true,
          hasCarriageway: supplementary.hasCarriageway === true,
          hasNamedArea: supplementary.hasNamedArea === true,
          hasLocationDescriptor: supplementary.hasLocationDescriptor === true,
          hasLane: supplementary.hasLane === true,
        }
      : null,
    noSignalSubtype,
    ...(loc.forensic || {}),
  };
  const life = classifyTrafficLifecycle({
    validFrom: validity.overallStartTime || primary.createdAt,
    validTo: validity.overallEndTime,
    openEnded: validity.openEnded,
    validityStatus: validity.validityStatus,
    nowIso,
  });

  const title = buildTrafficTitle({
    labelCs: primary.category && primary.category.labelCs,
    roadNumber: loc.roadNumber || primary.roadNumber,
    locationLabel: loc.locationLabel,
    direction: loc.direction,
  });
  const summary = buildTrafficSummary(primary.comment || primary.cause || "");

  // Fail-closed quarantine: unknown type without trustworthy base fields
  let quarantine = false;
  let quarantineReason = "";
  if (!primary.rawTypeKnown && !summary && !loc.roadNumber && loc.trust === "national_fallback") {
    quarantine = true;
    quarantineReason = "unknown_type_insufficient_fields";
  }
  if (!identity.situationId) {
    quarantine = true;
    quarantineReason = "missing_identity";
  }

  const firstSeen =
    (opts.firstSeenMap &&
      (opts.firstSeenMap.get
        ? opts.firstSeenMap.get(identity.itemId)
        : opts.firstSeenMap[identity.itemId])) ||
    nowIso;

  const item = {
    id: identity.itemId,
    sourceId: NDIC_SOURCE_ID,
    sourceLabel: "NDIC",
    adapterOwner: NDIC_ADAPTER_OWNER,
    sectionId: "doprava",
    lane: "doprava",
    eventType: (primary.category && primary.category.category) || "doprava",
    title,
    summary,
    url: NDIC_PUBLIC_PORTAL_URL,
    originalUrl: NDIC_PUBLIC_PORTAL_URL,
    publishedAt: primary.createdAt || situation.publicationTime || nowIso,
    publishedAtSource: primary.createdAt || situation.publicationTime || null,
    lastUpdatedBySource: primary.versionTime || situation.publicationTime || null,
    firstSeenByInfoUzel: firstSeen,
    lastProcessedAt: nowIso,
    lastConfirmedAt: nowIso,
    sortAt: primary.versionTime || primary.createdAt || situation.publicationTime || nowIso,
    validFrom: validity.overallStartTime || null,
    validTo: validity.overallEndTime || null,
    openEnded: Boolean(life.openEnded),
    status: life.status,
    lifecycle: life.lifecycle,
    temporalState: life.temporalState,
    badge: life.badge,
    publishable: quarantine ? false : life.publishable,
    quarantine,
    quarantineReason: quarantine ? quarantineReason : "",
    importance: (primary.category && primary.category.importance) || 2,
    severity: primary.severity || "",
    region: loc.region,
    roadNumber: loc.roadNumber || primary.roadNumber || "",
    direction: loc.direction || "",
    tmcLocationCodes: loc.region.tmcCodes || [],
    lat: loc.lat,
    lon: loc.lon,
    attribution: NDIC_ATTRIBUTION_SHORT,
    attributionFull: NDIC_ATTRIBUTION_FULL,
    sourceSystem: identity.sourceSystem,
    sourceSituationId: identity.situationId,
    revisionKey: identity.revisionKey,
    parserVersion: PARSER_VERSION,
    categoryMapVersion: primary.category && primary.category.mapVersion,
    categoryKnown: Boolean(primary.rawTypeKnown),
    recordType: primary.recordType || "",
    localizationTrust: loc.trust,
    ndicV1: {
      situationId: identity.situationId,
      situationVersion: situation.situationVersion || "",
      recordId: primary.recordId || "",
      recordVersion: primary.recordVersion || "",
      recordType: primary.recordType || "",
      tmcOk: loc.tmcOk,
      tmcMiss: loc.tmcMiss,
      trust: loc.trust,
      openlrStatus: openlr ? openlr.status : null,
      forensic,
    },
  };

  item.contentHash = contentFingerprint({
    category: item.eventType,
    title: item.title,
    summary: item.summary,
    roadNumber: item.roadNumber,
    direction: item.direction,
    validFrom: item.validFrom,
    validTo: item.validTo,
    lifecycle: item.lifecycle,
    status: item.status,
    tmcLocationCodes: item.tmcLocationCodes,
    lat: item.lat,
    lon: item.lon,
    severity: item.severity,
  });

  return item;
}

/**
 * @param {object[]} situations
 * @param {object} [opts]
 */
export function situationsToFeedItems(situations, opts = {}) {
  const items = [];
  const quarantine = [];
  for (const sit of situations || []) {
    try {
      const item = situationToFeedItem(sit, opts);
      if (item.quarantine || !item.publishable) quarantine.push(item);
      else items.push(item);
    } catch (e) {
      quarantine.push({
        id: null,
        quarantine: true,
        quarantineReason: String(e && e.message),
        sourceId: NDIC_SOURCE_ID,
      });
    }
  }
  return { items, quarantine };
}

/**
 * Merge snapshot items with previous NDIC set: identity, out-of-order, soft-missing.
 * @param {object[]} prevItems
 * @param {object[]} nextItems
 * @param {{ nowIso?: string }} [opts]
 */
export function mergeNdicRevisions(prevItems, nextItems, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const prev = new Map();
  for (const it of prevItems || []) {
    if (it && it.id) prev.set(String(it.id), it);
  }
  const seen = new Set();
  const out = [];
  const stats = { new: 0, updated: 0, unchanged: 0, ended: 0, skippedOlder: 0, softMissing: 0 };

  for (const it of nextItems || []) {
    if (!it || !it.id) continue;
    seen.add(String(it.id));
    const old = prev.get(String(it.id));
    if (!old) {
      stats.new += 1;
      out.push(it);
      continue;
    }
    const cmp = compareRevisions(old.lastUpdatedBySource || old.revisionKey, it.lastUpdatedBySource || it.revisionKey);
    if (cmp === "older") {
      stats.skippedOlder += 1;
      out.push(old);
      continue;
    }
    const ch = classifyChangeSignificance(old, it);
    if (!ch.significant && old.contentHash && it.contentHash && old.contentHash === it.contentHash) {
      stats.unchanged += 1;
      out.push({
        ...old,
        lastConfirmedAt: nowIso,
        lastProcessedAt: nowIso,
        firstSeenByInfoUzel: old.firstSeenByInfoUzel || it.firstSeenByInfoUzel,
      });
      continue;
    }
    stats.updated += 1;
    out.push({
      ...it,
      firstSeenByInfoUzel: old.firstSeenByInfoUzel || it.firstSeenByInfoUzel,
      // Significant update may refresh sortAt; technical keep previous sortAt
      sortAt: ch.significant ? it.sortAt || nowIso : old.sortAt || it.sortAt,
      previousRevisionKey: old.revisionKey || null,
      changeKind: ch.kind,
    });
  }

  // Soft-missing handling for items absent from snapshot
  for (const [id, old] of prev.entries()) {
    if (seen.has(id)) continue;
    if (String(old.sourceId) !== NDIC_SOURCE_ID) continue;
    const streak = (Number(old.missingStreak) || 0) + 1;
    const life = classifyTrafficLifecycle({
      validFrom: old.validFrom,
      validTo: old.validTo,
      openEnded: old.openEnded,
      missingFromSnapshot: true,
      missingStreak: streak,
      nowIso,
    });
    if (!life.publishable) {
      stats.ended += 1;
      out.push({
        ...old,
        status: life.status,
        lifecycle: life.lifecycle,
        publishable: false,
        badge: life.badge,
        missingStreak: streak,
        lastProcessedAt: nowIso,
        resolvedAt: nowIso,
      });
    } else {
      stats.softMissing += 1;
      out.push({
        ...old,
        missingStreak: streak,
        lastProcessedAt: nowIso,
        lifecycle: life.lifecycle,
      });
    }
  }

  return { items: out.filter(isPublishableNdicItem), all: out, stats };
}

/**
 * Attach legal provenance + enforce publish gate.
 */
export function applyNdicPublishGate(items, opts = {}) {
  const repo = opts.repoRoot || DEFAULT_REPO;
  let legal;
  let sources;
  try {
    legal = opts.legalRegistry || loadLegalRegistry(repo);
    sources = opts.sourceRegistry || loadSourceRegistry(repo);
  } catch (e) {
    return {
      items: [],
      rejected: (items || []).map((i) => ({ ...i, publishable: false, quarantine: true, quarantineReason: "legal_registry_load_failed" })),
      gateOk: false,
      reason: String(e && e.message),
    };
  }
  const src = (sources.entries || []).find((e) => e && e.id === NDIC_SOURCE_ID);
  const gate = canPublishFromSource(src, legal);
  if (!gate.ok) {
    return {
      items: [],
      rejected: items || [],
      gateOk: false,
      reason: gate.reason,
    };
  }
  const out = [];
  for (const it of items || []) {
    const withProv = attachLegalProvenance(it, src, gate.legal, legal);
    // Force NDIC attribution strings (license condition)
    withProv.attribution = NDIC_ATTRIBUTION_SHORT;
    withProv.attributionFull = NDIC_ATTRIBUTION_FULL;
    withProv.sourceLabel = "NDIC";
    out.push(withProv);
  }
  return { items: out, rejected: [], gateOk: true, reason: gate.reason };
}

export function loadNdicFirstSeenById(prevItems) {
  const m = new Map();
  for (const it of prevItems || []) {
    if (it && it.id && it.firstSeenByInfoUzel) m.set(String(it.id), it.firstSeenByInfoUzel);
  }
  return m;
}

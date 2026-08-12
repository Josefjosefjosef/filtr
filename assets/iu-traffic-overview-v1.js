/**
 * Traffic overview bridge for Můj přehled dne (InfoUzel.cz).
 *
 * Architecture rules (final integration):
 * - NO separate traffic home / settings / filters / localities UI
 * - Shared settings rails only: Témata → Doprava, Zdroje → ŘSD/NDIC, Lokalita
 * - Shared filterEvents + shared locality model + shared timeline
 * - Traffic feed is INTERNAL (ordering/badges/history), never a separate screen
 * - PUBLICATION_ENABLED / live NDIC remain false (inverted kill switches)
 * - TRAFFIC_UI_ENABLED is the single feature flag; flip to false for instant rollback
 * - NDIC cards come from traffic_offline_snapshot.json (not from multi‑MB feed.json)
 */
import { fetchTrafficSnapshotSlimOffMainThread, eventMatchesLocationFilter } from "./iu-info-system-core-v1.js?v=ndic-catalog-cap-fix-v1-20260811";
import {
  buildTrafficCardPresentation,
  expandTrafficAbbreviationsCs,
  isTrafficCardInformative,
  TRAFFIC_MAP_DOT_CSS_VAR,
} from "./iu-traffic-card-presenter-v1.js?v=ndic-parking-registry-v1-20260812";
export const TRAFFIC_OVERVIEW_FLAGS = Object.freeze({
  PUBLICATION_ENABLED: false,
  PUBLIC_API_ENABLED: false,
  LIVE_NDIC_INGEST: false,
  TRAFFIC_UI_ENABLED: true,
  TRAFFIC_CARDS_RENDER: true,
  SEPARATE_TRAFFIC_HOME: false,
  SEPARATE_TRAFFIC_SETTINGS: false,
  SEPARATE_TRAFFIC_FILTERS: false,
  SEPARATE_TRAFFIC_LOCALITIES: false,
  PRODUCTION_DEPLOY: false,
});

/**
 * Catalog card limit for offline snapshot → feed conversion.
 * 0 / non-positive = no silent truncation (full catalog available; DOM bounded by shared PAGE_SIZE).
 * Positive values remain available for tests/debug hard-caps only.
 */
export const TRAFFIC_UI_INITIAL_CARD_CAP = 0;

/** NOVÁ badge: only when source publication/version time is within this age (not merely ACTIVE). */
export const TRAFFIC_UI_NEW_BADGE_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/** Resolve optional hard cap; null means unlimited catalog availability. */
export function resolveTrafficCardCap(maxCardsOpt) {
  const raw = maxCardsOpt != null ? Number(maxCardsOpt) : TRAFFIC_UI_INITIAL_CARD_CAP;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
}

function trafficCardSortMs(card) {
  const iso = String(
    (card && (card.lastMeaningfulChangeAt || card.sourceUpdatedAt || card.downloadedAt)) || ""
  );
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Newest publication/version first — deterministic before any optional windowing. */
export function orderTrafficCardsNewestFirst(cards) {
  const list = Array.isArray(cards) ? cards.slice() : [];
  list.sort((a, b) => {
    const d = trafficCardSortMs(b) - trafficCardSortMs(a);
    if (d !== 0) return d;
    return String((a && a.publicEventId) || "").localeCompare(String((b && b.publicEventId) || ""));
  });
  return list;
}

export function isTrafficNewBadgeEligible(trafficV1, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const iso = String(
    (trafficV1 && (trafficV1.lastMeaningfulChangeAt || trafficV1.sourceUpdatedAt)) || ""
  );
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  return age >= 0 && age <= TRAFFIC_UI_NEW_BADGE_MAX_AGE_MS;
}

function trafficValidityEndMs(trafficV1) {
  const v = trafficV1 && trafficV1.validity;
  const iso = String(
    (v && (v.actualEnd || v.expectedEnd || v.validTo)) ||
      (trafficV1 && trafficV1.validTo) ||
      ""
  );
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

function trafficValidityStartMs(trafficV1) {
  const v = trafficV1 && trafficV1.validity;
  const iso = String((v && v.validFrom) || (trafficV1 && trafficV1.validFrom) || "");
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Runtime lifecycle for main overview (snapshot labels can lag between NDIC syncs).
 * Boundary: validTo < now ⇒ ENDED (same as classifyTrafficLifecycle).
 */
export function resolveTrafficOverviewLifecycle(trafficV1, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!trafficV1 || typeof trafficV1 !== "object") return "UNKNOWN";
  const labeled = String(trafficV1.lifecycleStatus || "");
  const change = String((trafficV1.feed && trafficV1.feed.feedChangeType) || "");
  const status = String(trafficV1.status || "").toLowerCase();
  if (
    labeled === "CANCELLED" ||
    change === "EVENT_CANCELLED" ||
    status === "zruseno" ||
    status === "zrušeno"
  ) {
    return "CANCELLED";
  }
  if (labeled === "ENDED" || change === "EVENT_ENDED" || status === "ukonceno" || status === "ukončeno") {
    return "ENDED";
  }
  const endMs = trafficValidityEndMs(trafficV1);
  if (Number.isFinite(endMs) && endMs < now) return "ENDED";
  const fromMs = trafficValidityStartMs(trafficV1);
  if (Number.isFinite(fromMs) && fromMs > now) return "FUTURE";
  if (labeled === "FUTURE") return "FUTURE";
  if (labeled === "ACTIVE") return "ACTIVE";
  if (labeled) return "UNKNOWN";
  if (Number.isFinite(fromMs) || Number.isFinite(endMs)) return "ACTIVE";
  return "UNKNOWN";
}

/** Main traffic overview = ACTIVE + FUTURE only (ENDED/CANCELLED/UNKNOWN excluded). */
export function isTrafficMainOverviewVisible(trafficV1, nowMs) {
  const life = resolveTrafficOverviewLifecycle(trafficV1, nowMs);
  return life === "ACTIVE" || life === "FUTURE";
}

/** Hosted offline snapshot (fail-closed if missing / poison). */
export const TRAFFIC_UI_SNAPSHOT_URL =
  "/projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json";

/** Internal publication-layer enums (not separate UI). Mapped via shared prefs. */
export const TRAFFIC_SPATIAL = Object.freeze({
  MY_SELECTION: "MY_SELECTION",
  MY_ROUTES: "MY_ROUTES",
  NEAR_ME: "NEAR_ME",
  WHOLE_CZ: "WHOLE_CZ",
});

export const TRAFFIC_TEMPORAL = Object.freeze({
  NOW: "NOW",
  TODAY: "TODAY",
  TOMORROW: "TOMORROW",
  WEEKEND: "WEEKEND",
  CUSTOM_DATETIME: "CUSTOM_DATETIME",
});

export const TRAFFIC_TYPE = Object.freeze({
  ALL: "ALL",
  CLOSURES: "CLOSURES",
  RESTRICTIONS: "RESTRICTIONS",
  ACCIDENTS: "ACCIDENTS",
  ROADWORKS: "ROADWORKS",
  QUEUES: "QUEUES",
  ROAD_AND_WEATHER: "ROAD_AND_WEATHER",
  FUTURE: "FUTURE",
  ENDED: "ENDED",
  SEVERE: "SEVERE",
});

const LS_OFFLINE_SNAPSHOT = "iu.trafficOverview.offlineSnapshot.v1";
export const LS_TRAFFIC_FOLLOW = "iu.trafficFollow.v1";
const FORBIDDEN_NEEDLES = Object.freeze([
  "locationCode",
  "<Situation",
  "PES_LEV",
  "RNLT",
  "Bearer ",
  "IU_NDIC_PULL_PASS",
  "At line:",
  "C:\\\\Users",
  "C:/Users",
  "/home/",
]);

const TRAFFIC_UI_REGRESSION_NEEDLES = Object.freeze([
  "Čerstvost: UNKNOWN",
  "Historie: nová",
  "směr záporný směr",
  "směr kladný směr",
  "záporný směr",
  "kladný směr",
]);

const TECH_DIRECTION = /^(kladný směr|záporný směr|positive|negative|pos|neg)$/i;

const EVENT_TYPE_LABEL_CS = Object.freeze({
  nehoda: "Nehoda",
  prekazka: "Překážka",
  prace: "Práce na silnici",
  uzavirka: "Uzávěrka",
  kolona: "Kolona",
  pozar: "Požár",
  omezeni: "Omezení",
  objizdka: "Objížďka",
  sjizdnost: "Sjízdnost",
  doprava: "Doprava",
});

const ROAD_CLASS_LABEL_CS = Object.freeze({
  MOTORWAY: "Dálnice",
  CLASS_I: "Silnice I. třídy",
  CLASS_II: "Silnice II. třídy",
  CLASS_III: "Silnice III. třídy",
  E_ROAD: "Evropský tah",
  LOCAL: "Místní komunikace",
  UNKNOWN: "Komunikace",
});

const ALLOWED_CARD_KEYS = Object.freeze([
  "publicEventId",
  "lifecycleStatus",
  "changeStatus",
  "eventType",
  "category",
  "severity",
  "road",
  "roadClass",
  "roadClassLabel",
  "kilometer",
  "section",
  "direction",
  "location",
  "municipality",
  "district",
  "validity",
  "validityLine",
  "impact",
  "impactFull",
  "impactSource",
  "illustrationKey",
  "freshness",
  "source",
  "mapTarget",
  "feed",
  "fieldProvenance",
  "publicationEligibility",
  "changeTimeSource",
  "lastMeaningfulChangeAt",
  "downloadedAt",
  "measurementTime",
  "sourceUpdatedAt",
  "timelineField",
  "delayAvailable",
  "delayMinutes",
  "stableSituationId",
  "stableRecordId",
  "locationPresentationLevel",
  "subjectScopeVerified",
  "preciseLocationVerified",
  "subjectScopeKind",
  "subjectScopeLabel",
  "locationDisclosureCs",
  "routeMatchMode",
  "parkingAvailableSpaces",
  "parkingCapacity",
  "parkingOccupancy",
  "freeSpaces",
  "motorVehicleRoadConfirmed",
  "isMotorVehicleRoad",
  "motorVehicleRoadStatus",
  "motorVehicleRoadSource",
  "roadFacilityType",
  "queueLengthKm",
  "queueLengthMeters",
]);

function humanDirectionOrNull(raw) {
  const d = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!d) return null;
  if (TECH_DIRECTION.test(d)) return null;
  if (/^(unknown|n\/a|null|undefined|neuvedeno)$/i.test(d)) return null;
  if (/^oba směry$/i.test(d)) return "oba směry";
  if (/^[A-Za-zÁ-Žá-ž0-9 ./-]{2,40}$/.test(d)) return d;
  return null;
}

function normalizeFreshness(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s.toUpperCase() === "UNKNOWN") return null;
  return s;
}

function importanceFromSeverity(severity) {
  if (severity == null || String(severity).trim() === "") return 0;
  const s = String(severity).toLowerCase();
  if (s === "high" || s === "severe") return 5;
  if (s === "medium") return 4;
  if (s === "low") return 2;
  return 0;
}

function eventTypeLabelCs(eventType) {
  const t = String(eventType || "")
    .trim()
    .toLowerCase();
  return EVENT_TYPE_LABEL_CS[t] || "";
}

function readFollowStore() {
  if (typeof localStorage === "undefined") return { items: {} };
  try {
    const raw = localStorage.getItem(LS_TRAFFIC_FOLLOW);
    if (!raw) return { items: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { items: {} };
    const items = parsed.items && typeof parsed.items === "object" ? parsed.items : {};
    return { items };
  } catch (_) {
    return { items: {} };
  }
}

function writeFollowStore(store) {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(LS_TRAFFIC_FOLLOW, JSON.stringify({ items: store.items || {} }));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Map shared InfoUzel prefs → internal spatial mode (no parallel settings store).
 * WHOLE_CZ = no locality restriction in shared Lokalita rail.
 * NEAR_ME / selection = shared localities / home / favorites regions.
 * MY_SELECTION = favoritesOnly or favoriteSourceIds including rsd/ndic.
 */
export function deriveSpatialModeFromSharedPrefs(prefs) {
  const f = prefs || {};
  if (f.favoritesOnly === true) return TRAFFIC_SPATIAL.MY_SELECTION;
  const hasLoc =
    !!f.myRegionOnly ||
    !!(f.localities && f.localities.length) ||
    !!f.homeKraj ||
    !!f.homeOkres ||
    !!f.homeObec ||
    !!f.localityQuery;
  if (hasLoc) return TRAFFIC_SPATIAL.NEAR_ME;
  return TRAFFIC_SPATIAL.WHOLE_CZ;
}

export function scanTrafficUiCanaries(obj) {
  const s = JSON.stringify(obj);
  const hits = [];
  for (const n of FORBIDDEN_NEEDLES) {
    if (s.includes(n)) hits.push(n);
  }
  if (/"locationCode"\s*:/.test(s)) hits.push("locationCode_field");
  return { ok: hits.length === 0, hits };
}

function clip(s, n) {
  if (s == null) return null;
  const t = String(s);
  return t.length > n ? t.slice(0, n) : t;
}

/**
 * Map audited card/projection → overview feed item with trafficV1.
 * Region fields use the SHARED locality shape so filterEvents applies.
 */
export function trafficProjectionToFeedItem(cardOrProj, opts = {}) {
  if (TRAFFIC_OVERVIEW_FLAGS.PUBLICATION_ENABLED === true) {
    return { ok: false, rejectCode: "PUBLICATION_MUST_STAY_OFF" };
  }
  if (TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_SETTINGS === true) {
    return { ok: false, rejectCode: "SEPARATE_TRAFFIC_SETTINGS_FORBIDDEN" };
  }
  if (!cardOrProj || typeof cardOrProj !== "object") {
    return { ok: false, rejectCode: "INVALID_INPUT" };
  }
  const c = cardOrProj;
  const publicEventId = String(c.publicEventId || "").trim();
  if (!/^iu-te-[a-f0-9]{32}$/.test(publicEventId)) {
    return { ok: false, rejectCode: "INVALID_PUBLIC_EVENT_ID" };
  }
  const feed = c.feed || {};
  const mapTarget = c.mapTarget || {
    mapLinkType: c.mapLinkType || "NONE",
    safeMapTarget: c.safeMapTarget || null,
  };
  const validity = c.validity || {
    validFrom: c.validFrom || null,
    expectedEnd: c.expectedEnd || null,
    actualEnd: c.actualEnd || null,
  };
  const admin = c.administrativeArea != null ? c.administrativeArea : null;
  const locLabel =
    c.location != null ? c.location : c.locationLabel != null ? c.locationLabel : null;
  const road = c.road != null ? c.road : c.roadNumber != null ? c.roadNumber : null;
  const precise = c.preciseLocationVerified === true;
  const level = String(c.locationPresentationLevel || (precise ? "PRECISE" : "NONE"));
  const directionRaw = precise && c.direction != null ? c.direction : null;
  const direction = humanDirectionOrNull(directionRaw);
  const freshness = normalizeFreshness(
    c.freshness != null ? c.freshness : c.freshnessStatus != null ? c.freshnessStatus : null
  );
  const delayAvailable = c.delayAvailable === true;
  const delayMinutes =
    delayAvailable && c.delayMinutes != null && Number.isFinite(Number(c.delayMinutes))
      ? Number(c.delayMinutes)
      : null;

  const trafficV1 = {
    publicEventId,
    lifecycleStatus: c.lifecycleStatus || null,
    changeStatus: c.changeStatus || null,
    eventType: c.eventType || c.category || null,
    category: c.category || c.eventCategory || c.eventType || null,
    severity: c.severity != null && String(c.severity).trim() !== "" ? c.severity : null,
    road: road,
    roadClass: c.roadClass || null,
    roadClassLabel: c.roadClassLabel || null,
    // Never surface km/dir/section unless precise location verified
    kilometer: precise && c.kilometer != null ? c.kilometer : null,
    section: precise && (c.section != null || c.sectionLabel != null) ? c.section || c.sectionLabel : null,
    direction,
    location: locLabel,
    municipality: c.municipality || null,
    district: c.district || null,
    validity,
    validityLine: c.validityLine || null,
    impact: c.impact != null ? c.impact : c.impactSummary != null ? c.impactSummary : null,
    impactFull: c.impactFull || null,
    impactSource: c.impactSource || null,
    illustrationKey: c.illustrationKey || null,
    freshness,
    source: c.source != null ? c.source : c.sourceLabel != null ? c.sourceLabel : "ŘSD/NDIC",
    mapTarget: {
      mapLinkType: mapTarget.mapLinkType || "NONE",
      safeMapTarget: mapTarget.safeMapTarget || null,
    },
    feed: {
      feedHeadline: feed.feedHeadline || c.feedHeadline || null,
      feedChangeType: feed.feedChangeType || c.feedChangeType || null,
    },
    fieldProvenance: c.fieldProvenance && typeof c.fieldProvenance === "object" ? c.fieldProvenance : {},
    publicationEligibility: c.publicationEligibility || null,
    changeTimeSource: c.changeTimeSource || null,
    lastMeaningfulChangeAt: c.lastMeaningfulChangeAt || null,
    downloadedAt: c.downloadedAt || null,
    measurementTime: c.measurementTime || null,
    sourceUpdatedAt: c.sourceUpdatedAt || null,
    timelineField: c.timelineField || null,
    delayAvailable,
    delayMinutes,
    stableSituationId: c.stableSituationId || null,
    stableRecordId: c.stableRecordId || null,
    locationPresentationLevel: level,
    subjectScopeVerified: c.subjectScopeVerified === true,
    preciseLocationVerified: precise,
    subjectScopeKind: c.subjectScopeKind || null,
    subjectScopeLabel: c.subjectScopeLabel || null,
    locationDisclosureCs: c.locationDisclosureCs || null,
    routeMatchMode: c.routeMatchMode || null,
    parkingAvailableSpaces:
      c.parkingAvailableSpaces != null
        ? c.parkingAvailableSpaces
        : c.freeSpaces != null
          ? c.freeSpaces
          : null,
    parkingCapacity: c.parkingCapacity != null ? c.parkingCapacity : null,
    parkingOccupancy: c.parkingOccupancy != null ? c.parkingOccupancy : null,
    freeSpaces: c.freeSpaces != null ? c.freeSpaces : null,
    motorVehicleRoadConfirmed: c.motorVehicleRoadConfirmed === true,
    isMotorVehicleRoad: c.isMotorVehicleRoad === true,
    motorVehicleRoadStatus: c.motorVehicleRoadStatus || null,
    motorVehicleRoadSource: c.motorVehicleRoadSource || null,
    roadFacilityType: c.roadFacilityType || null,
    queueLengthKm: c.queueLengthKm != null ? c.queueLengthKm : null,
    queueLengthMeters: c.queueLengthMeters != null ? c.queueLengthMeters : null,
    publicationEnabled: false,
  };

  for (const k of Object.keys(trafficV1)) {
    if (!ALLOWED_CARD_KEYS.includes(k) && k !== "publicationEnabled") {
      delete trafficV1[k];
    }
  }

  const canary = scanTrafficUiCanaries(trafficV1);
  if (!canary.ok) {
    return { ok: false, rejectCode: "TRAFFIC_UI_SECURITY_CANARY_DETECTED", hits: canary.hits };
  }

  const headline = clip(trafficV1.feed.feedHeadline || trafficV1.impact || "Dopravní událost", 120);
  const mapUrl = resolveSafeTrafficMapUrl(trafficV1.mapTarget);
  const importance = importanceFromSeverity(trafficV1.severity);
  const life = trafficV1.lifecycleStatus;
  let status = "aktivni";
  if (life === "ENDED") status = "ukonceno";
  if (life === "CANCELLED") status = "zruseno";
  if (life === "FUTURE") status = "naplanovano";

  const regionName = String(locLabel || admin || road || "").trim();
  const publishedAt = trafficV1.lastMeaningfulChangeAt || opts.nowIso || null;
  const publishedAtSource =
    trafficV1.sourceUpdatedAt || trafficV1.lastMeaningfulChangeAt || null;
  const item = {
    id: "ie-traffic-" + publicEventId,
    sourceId: "rsd",
    sourceLabel: "ŘSD/NDIC",
    sourceGroup: "doprava",
    adapterOwner: "iu-traffic-overview-v1",
    sectionId: "doprava",
    lane: "doprava",
    eventType: "doprava",
    orgType: "transport",
    title: headline,
    summary: clip(trafficV1.impact, 280) || "",
    url: mapUrl || "",
    originalUrl: mapUrl || "",
    publishedAt,
    publishedAtSource,
    validFrom: validity.validFrom || null,
    validTo: validity.expectedEnd || validity.actualEnd || null,
    status,
    importance,
    // Shared locality shape — same keys ČHMÚ / future institutions use
    region: regionName
      ? {
          name: regionName,
          summary: regionName,
          krajName: admin ? String(admin) : null,
          level: admin ? "kraj" : "cr",
        }
      : { name: "", summary: "", level: "cr" },
    trafficV1,
    publishable: false,
    publicationEnabled: false,
  };

  const canary2 = scanTrafficUiCanaries(item);
  if (!canary2.ok) {
    return { ok: false, rejectCode: "TRAFFIC_UI_SECURITY_CANARY_DETECTED", hits: canary2.hits };
  }
  return { ok: true, item };
}

export function resolveSafeTrafficMapUrl(mapTarget) {
  if (!mapTarget || typeof mapTarget !== "object") return "";
  const t = String(mapTarget.mapLinkType || "NONE");
  const raw = mapTarget.safeMapTarget != null ? String(mapTarget.safeMapTarget).trim() : "";
  if (t === "NONE" || !raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return "";
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "dopravniinfo.cz" && !host.endsWith(".dopravniinfo.cz")) return "";
    return u.toString();
  } catch (_) {
    return "";
  }
}

export function trafficBadgeModel(trafficV1, opts) {
  const change = String((trafficV1 && trafficV1.feed && trafficV1.feed.feedChangeType) || "");
  const cat = String((trafficV1 && (trafficV1.category || trafficV1.eventType)) || "").toLowerCase();
  const life = String((trafficV1 && trafficV1.lifecycleStatus) || "");
  const nowMs = opts && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  if (life === "ENDED" || change === "EVENT_ENDED") {
    return { kind: "ended", text: "🟢 UKONČENÁ", aria: "Ukončená dopravní událost" };
  }
  if (life === "CANCELLED" || change === "EVENT_CANCELLED") {
    return { kind: "ended", text: "Zrušeno", aria: "Zrušená dopravní událost" };
  }
  if (life === "FUTURE") {
    return { kind: "future", text: "BUDOUCÍ", aria: "Budoucí dopravní událost" };
  }
  if (change === "VALIDITY_EXTENDED") {
    return { kind: "changed", text: "🟡 ZMĚNĚNÁ", aria: "Prodloužená dopravní událost" };
  }
  if (change === "VALIDITY_SHORTENED" || change === "EVENT_UPDATED" || change.indexOf("CHANGED") >= 0) {
    return { kind: "changed", text: "🟡 ZMĚNĚNÁ", aria: "Změněná dopravní událost" };
  }
  // NOVÁ badge removed for ordinary active traffic cards (EVENT_CREATED → no badge).
  // FUTURE / ENDED / ZMĚNĚNÁ remain available above.
  // No redundant "AKTIVNÍ DOPRAVA" / "DOPRAVA ŘSD" — traffic context is already clear.
  return null;
}

export function isRsdTrafficSourceEnabled(prefs) {
  const f = prefs || {};
  const ids = f.sourceIds || [];
  const groups = f.sourceGroups || [];
  if (ids.length === 1 && ids[0] === "__none__") return false;
  if (!ids.length && !groups.length) return true;
  if (ids.includes("rsd") || ids.includes("ndic")) return true;
  if (groups.includes("doprava") || groups.includes("ndic")) return true;
  return false;
}

export function isDopravaTopicEnabled(prefs) {
  const secs = (prefs && prefs.sections) || [];
  if (secs.length === 1 && secs[0] === "__none__") return false;
  if (!secs.length) return true;
  return secs.includes("doprava");
}

function acceptTrafficSnapshot(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.publicationEnabled === true) return null;
  if (parsed.trafficUiEnabled === false) return null;
  const canary = scanTrafficUiCanaries(parsed);
  if (!canary.ok) return null;
  return parsed;
}

/** In-memory snapshot cache (avoids sync JSON.parse of multi‑MB localStorage on boot/reload). */
let _trafficSnapMem = null;
/** Converted feed-item cache — full catalog must not re-project on every filteredList()/paint. */
let _trafficFeedItemsCache = { key: "", items: null };
let _trafficOverviewFilterCache = { key: "", items: null, itemsRef: null };
const LS_SNAPSHOT_MAX_CHARS = 262144; // 256 KiB — larger payloads stay memory-only

function trafficFeedItemsCacheKey(snapshot, opts, cardLen, cap) {
  return [
    String((snapshot && snapshot.generatedAt) || ""),
    String((snapshot && snapshot.snapshotVersion) || ""),
    String(cardLen),
    String(cap == null ? "all" : cap),
  ].join("|");
}

function invalidateTrafficFeedItemsCache() {
  _trafficFeedItemsCache = { key: "", items: null };
  _trafficOverviewFilterCache = { key: "", items: null, itemsRef: null };
}

/** Locality + lifecycle filter for main overview (ACTIVE/FUTURE only; preserves newest-first order). */
export function filterOfflineTrafficCandidatesForOverview(items, prefs, opts) {
  const listIn = Array.isArray(items) ? items : [];
  const f = prefs || {};
  const nowMs = opts && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const nowBucket = Math.floor(nowMs / 60000);
  const locActive = !!(
    f.myRegionOnly ||
    f.localityQuery ||
    (f.localities && f.localities.length) ||
    f.homeObec ||
    f.homeOkres ||
    f.homeKraj
  );
  const key =
    String(listIn.length) +
    "|" +
    String(nowBucket) +
    "|" +
    (locActive ? "1" : "0") +
    "|" +
    String(f.myRegionOnly ? 1 : 0) +
    "|" +
    String(f.localityQuery || "") +
    "|" +
    String(f.homeObec || "") +
    "|" +
    String(f.homeOkres || "") +
    "|" +
    String(f.homeKraj || "") +
    "|" +
    (Array.isArray(f.localities) ? f.localities.join(",") : "");
  if (
    _trafficOverviewFilterCache.itemsRef === listIn &&
    _trafficOverviewFilterCache.key === key &&
    Array.isArray(_trafficOverviewFilterCache.items)
  ) {
    return _trafficOverviewFilterCache.items;
  }
  const out = [];
  for (let i = 0; i < listIn.length; i++) {
    const ev = listIn[i];
    if (!ev) continue;
    const tv = ev.trafficV1 || ev;
    if (!isTrafficMainOverviewVisible(tv, nowMs)) continue;
    // Presentation filter: hide empty template-only cards (backend data kept).
    if (!isTrafficCardInformative(tv)) continue;
    if (locActive && !eventMatchesLocationFilter(ev, f)) continue;
    out.push(ev);
  }
  _trafficOverviewFilterCache = { key: key, items: out, itemsRef: listIn };
  return out;
}

export function loadOfflineTrafficSnapshot() {
  if (TRAFFIC_OVERVIEW_FLAGS.TRAFFIC_UI_ENABLED !== true) return null;
  if (_trafficSnapMem) return _trafficSnapMem;
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_OFFLINE_SNAPSHOT);
    if (!raw) return null;
    // Oversized LS entries block the main thread on parse — fail closed + clear.
    if (raw.length > LS_SNAPSHOT_MAX_CHARS) {
      try {
        localStorage.removeItem(LS_OFFLINE_SNAPSHOT);
      } catch (_) {}
      return null;
    }
    const snap = acceptTrafficSnapshot(JSON.parse(raw));
    if (snap) _trafficSnapMem = snap;
    return snap;
  } catch (_) {
    return null;
  }
}

/**
 * Fetch hosted offline snapshot when TRAFFIC_UI_ENABLED. Never follows redirect off-origin.
 * Returns null on any failure (fail-closed).
 */
export async function fetchHostedTrafficOfflineSnapshot(opts = {}) {
  if (TRAFFIC_OVERVIEW_FLAGS.TRAFFIC_UI_ENABLED !== true) return null;
  if (TRAFFIC_OVERVIEW_FLAGS.PUBLICATION_ENABLED === true) return null;
  const url = String(opts.url || TRAFFIC_UI_SNAPSHOT_URL);
  if (typeof fetch !== "function") return null;
  try {
    let parsed = null;
    try {
      parsed = await fetchTrafficSnapshotSlimOffMainThread(
        url,
        opts.maxCards != null ? opts.maxCards : TRAFFIC_UI_INITIAL_CARD_CAP,
        opts.signal || null
      );
    } catch (_) {
      parsed = null;
    }
    if (!parsed) {
      // Last resort (Worker unavailable): drop history; keep full card catalog (DOM paginated).
      const res = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res || !res.ok) return null;
      const full = await res.json();
      const cards = Array.isArray(full.cards)
        ? full.cards
        : Array.isArray(full.projections)
          ? full.projections
          : [];
      const ordered = orderTrafficCardsNewestFirst(cards);
      const cap = resolveTrafficCardCap(opts.maxCards != null ? opts.maxCards : TRAFFIC_UI_INITIAL_CARD_CAP);
      const kept = cap == null ? ordered : ordered.slice(0, cap);
      parsed = Object.assign({}, full, {
        cards: kept,
        historyItems: [],
        historyCount: 0,
        cardsCappedTo: cap,
        cardCount: full.cardCount != null ? full.cardCount : cards.length,
      });
    }
    const snap = acceptTrafficSnapshot(parsed);
    if (!snap) return null;
    invalidateTrafficFeedItemsCache();
    _trafficSnapMem = snap;
    if (opts.persist !== false) saveOfflineTrafficSnapshot(snap);
    return snap;
  } catch (_) {
    return null;
  }
}

export function saveOfflineTrafficSnapshot(snapshot) {
  if (TRAFFIC_OVERVIEW_FLAGS.TRAFFIC_UI_ENABLED !== true) {
    return { ok: false, rejectCode: "TRAFFIC_UI_DISABLED" };
  }
  if (!snapshot || snapshot.publicationEnabled === true) {
    return { ok: false, rejectCode: "PUBLICATION_MUST_STAY_OFF" };
  }
  const canary = scanTrafficUiCanaries(snapshot);
  if (!canary.ok) return { ok: false, rejectCode: "TRAFFIC_UI_SECURITY_CANARY_DETECTED", hits: canary.hits };
  invalidateTrafficFeedItemsCache();
  _trafficSnapMem = snapshot;
  if (typeof localStorage === "undefined") return { ok: true, persist: "memory" };
  try {
    const raw = JSON.stringify(snapshot);
    // Multi‑MB snapshots must not land in localStorage (sync parse blocks boot/reload paint).
    if (raw.length > LS_SNAPSHOT_MAX_CHARS) {
      try {
        localStorage.removeItem(LS_OFFLINE_SNAPSHOT);
      } catch (_) {}
      return { ok: true, persist: "memory" };
    }
    localStorage.setItem(LS_OFFLINE_SNAPSHOT, raw);
    return { ok: true, persist: "localStorage" };
  } catch (_) {
    return { ok: true, persist: "memory", rejectCode: "STORAGE_FAILED" };
  }
}

export function clearOfflineTrafficSnapshot() {
  invalidateTrafficFeedItemsCache();
  _trafficSnapMem = null;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LS_OFFLINE_SNAPSHOT);
  } catch (_) {}
}

/**
 * Convert offline snapshot → feed items (no parallel filtering — caller uses filterEvents).
 */
export function trafficItemsFromOfflineSnapshot(snapshot, opts = {}) {
  if (!snapshot || snapshot.publicationEnabled === true) return [];
  if (TRAFFIC_OVERVIEW_FLAGS.PUBLICATION_ENABLED === true) return [];
  const cards = Array.isArray(snapshot.cards) && snapshot.cards.length
    ? snapshot.cards
    : Array.isArray(snapshot.projections)
      ? snapshot.projections
      : [];
  const cap = resolveTrafficCardCap(opts.maxCards != null ? opts.maxCards : TRAFFIC_UI_INITIAL_CARD_CAP);
  const cacheKey = trafficFeedItemsCacheKey(snapshot, opts, cards.length, cap);
  if (_trafficFeedItemsCache.key === cacheKey && Array.isArray(_trafficFeedItemsCache.items)) {
    return _trafficFeedItemsCache.items;
  }
  const ordered = orderTrafficCardsNewestFirst(cards);
  const built = [];
  for (let i = 0; i < ordered.length; i++) {
    if (cap != null && built.length >= cap) break;
    const r = trafficProjectionToFeedItem(ordered[i], opts);
    if (r.ok) built.push(r.item);
  }
  _trafficFeedItemsCache = { key: cacheKey, items: built };
  return built;
}

/**
 * Collect offline traffic candidates for the shared overview pipeline.
 * Does NOT apply a second filter system — only topic/source gate + conversion.
 */
export function collectOfflineTrafficCandidates(prefs, opts = {}) {
  if (TRAFFIC_OVERVIEW_FLAGS.TRAFFIC_UI_ENABLED !== true) return [];
  if (TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_HOME === true) return [];
  if (TRAFFIC_OVERVIEW_FLAGS.TRAFFIC_CARDS_RENDER !== true) return [];
  if (TRAFFIC_OVERVIEW_FLAGS.PUBLICATION_ENABLED === true) return [];
  if (!isDopravaTopicEnabled(prefs) || !isRsdTrafficSourceEnabled(prefs)) return [];
  return trafficItemsFromOfflineSnapshot(opts.snapshot || loadOfflineTrafficSnapshot(), opts);
}

/**
 * Merge unique traffic candidates into a list already processed by shared filterEvents.
 * Prefer items that already passed shared filters; do not re-apply parallel traffic filters.
 */
export function mergeTrafficIntoOverview(baseItems, prefs, opts = {}) {
  const base = Array.isArray(baseItems) ? baseItems.slice() : [];
  if (!isDopravaTopicEnabled(prefs) || !isRsdTrafficSourceEnabled(prefs)) {
    return base.filter((x) => !(x && x.trafficV1));
  }
  const candidates = Array.isArray(opts.filteredTrafficItems)
    ? opts.filteredTrafficItems
    : collectOfflineTrafficCandidates(prefs, opts);
  const byId = new Map();
  for (const it of base) {
    if (it) byId.set(String(it.id), it);
  }
  for (const it of candidates) {
    if (!it || !it.trafficV1) continue;
    if (it.publicationEnabled === true) continue;
    const id = String(it.id);
    if (!byId.has(id)) byId.set(id, it);
  }
  return Array.from(byId.values());
}

export function trafficFreshnessBanner(snapshot) {
  if (!snapshot) return null;
  const generatedAt = snapshot.generatedAt || null;
  const freshnessRaw = snapshot.sourceFreshness || null;
  const freshness = normalizeFreshness(freshnessRaw);
  const freshnessPart = freshness ? " · čerstvost " + freshness : "";
  return {
    generatedAt,
    freshness,
    publicationEnabled: false,
    label: "Dopravní data (offline): " + (generatedAt || "neznámý čas") + freshnessPart,
  };
}

export function trafficHistoryLines(_trafficV1) {
  return [];
}

export function scanTrafficUserTextRegressions(text) {
  const s = String(text || "");
  const hits = [];
  for (const n of TRAFFIC_UI_REGRESSION_NEEDLES) {
    if (s.includes(n)) hits.push(n);
  }
  if (/\bUNKNOWN\b/.test(s)) hits.push("UNKNOWN");
  if (/\bNULL\b/.test(s)) hits.push("NULL");
  if (/\bundefined\b/.test(s)) hits.push("undefined");
  if (/\bN\/A\b/i.test(s)) hits.push("N/A");
  return { ok: hits.length === 0, hits };
}

export function isTrafficFollowed(publicEventId) {
  const id = String(publicEventId || "").trim();
  if (!id) return false;
  const store = readFollowStore();
  return !!(store.items && store.items[id]);
}

export function listTrafficFollowed() {
  const store = readFollowStore();
  return Object.keys(store.items || {});
}

export function toggleTrafficFollow(publicEventId, snapshotMeta) {
  const id = String(publicEventId || "").trim();
  if (!/^iu-te-[a-f0-9]{32}$/.test(id)) {
    return { ok: false, followed: false, rejectCode: "INVALID_PUBLIC_EVENT_ID" };
  }
  const store = readFollowStore();
  const items = store.items || {};
  if (items[id]) {
    delete items[id];
    writeFollowStore({ items });
    return { ok: true, followed: false };
  }
  const meta = snapshotMeta && typeof snapshotMeta === "object" ? snapshotMeta : {};
  items[id] = {
    followedAt: new Date().toISOString(),
    publicEventId: id,
    road: meta.road || null,
    eventType: meta.eventType || null,
    history: [],
  };
  writeFollowStore({ items });
  return { ok: true, followed: true };
}

export function appendTrafficFollowHistory(publicEventId, entry) {
  const id = String(publicEventId || "").trim();
  if (!id || !entry || typeof entry !== "object") {
    return { ok: false, rejectCode: "INVALID_INPUT" };
  }
  const at = entry.at != null ? String(entry.at) : "";
  const label = entry.label != null ? String(entry.label).trim() : "";
  if (!at || !label) return { ok: false, rejectCode: "INVALID_ENTRY" };
  const store = readFollowStore();
  const items = store.items || {};
  if (!items[id]) return { ok: false, rejectCode: "NOT_FOLLOWED" };
  const hist = Array.isArray(items[id].history) ? items[id].history.slice() : [];
  hist.push({ at, label });
  if (hist.length > 40) hist.splice(0, hist.length - 40);
  items[id] = Object.assign({}, items[id], { history: hist });
  writeFollowStore({ items });
  return { ok: true };
}

function compactLocalityLine(municipality, district) {
  const muni = municipality != null ? String(municipality).trim() : "";
  const dist = district != null ? String(district).trim() : "";
  if (muni && dist) return muni + " · okres " + dist;
  if (muni) return muni;
  if (dist) return "okres " + dist;
  return "";
}

/**
 * Deterministic short lead from structured fields + short source comment.
 * Presentation-only — does not alter summaryFull / impactFull data.
 */
function buildTrafficLeadText(opts) {
  const eventTypeLabel = String(opts.eventTypeLabel || "").trim();
  const road = String(opts.road || "").trim();
  const municipality = String(opts.municipality || "").trim();
  const impactShort = String(opts.impactShort || "").trim();
  if (impactShort && impactShort.length <= 140) return impactShort;
  const bits = [];
  if (eventTypeLabel && road) bits.push(eventTypeLabel + " na " + road + ".");
  else if (eventTypeLabel && municipality) bits.push(eventTypeLabel + " v " + municipality + ".");
  else if (eventTypeLabel) bits.push(eventTypeLabel + ".");
  if (bits.length) return bits.join(" ");
  if (!impactShort) return "";
  // UI-only short preview; full source text remains in impactFull.
  if (impactShort.length <= 160) return impactShort;
  const cut = impactShort.slice(0, 140).replace(/\s+\S*$/, "").trim();
  return cut ? cut + "…" : impactShort.slice(0, 140) + "…";
}

function fullTextAddsDetail(leadText, impactFull) {
  const lead = String(leadText || "").trim();
  const full = String(impactFull || "").trim();
  if (!full) return false;
  if (!lead) return full.length > 0;
  if (full === lead) return false;
  if (full.length <= lead.length + 8) return false;
  // Ignore trivial ellipsis variants of the same presentation string.
  const leadBase = lead.replace(/…$/, "").replace(/\.\.\.$/, "").trim();
  if (full === leadBase) return false;
  return true;
}

/**
 * Structured view-model for redesigned traffic cards (no invented facts).
 */
export function buildTrafficCardViewModel(trafficV1) {
  const tv = trafficV1 && typeof trafficV1 === "object" ? trafficV1 : {};
  const badge = trafficBadgeModel(tv);
  const change = String((tv.feed && tv.feed.feedChangeType) || "");
  const showNew = change === "EVENT_CREATED";
  const showActive = String(tv.lifecycleStatus || "") === "ACTIVE";
  const presentation = buildTrafficCardPresentation(tv);
  const roadPres = presentation.roadPresentation;
  const road = roadPres.road || (tv.road != null ? String(tv.road) : "");
  const roadClass = roadPres.roadClass || tv.roadClass || "UNKNOWN";
  const roadClassLabel =
    tv.roadClassLabel || ROAD_CLASS_LABEL_CS[roadClass] || ROAD_CLASS_LABEL_CS.UNKNOWN;
  const eventType = tv.eventType || tv.category || null;
  const eventTypeLabel = presentation.event.titleCs || eventTypeLabelCs(eventType);
  const municipality = tv.municipality != null ? String(tv.municipality).trim() : "";
  const district = tv.district != null ? String(tv.district).trim() : "";
  const municipalitySign =
    (presentation.communication && presentation.communication.municipalitySign) || null;
  const municipalitySignLabel =
    (presentation.communication && presentation.communication.municipalitySignLabel) || null;
  const besideLocality =
    (presentation.communication && presentation.communication.besideLocality) || null;
  const districtBeside =
    (presentation.communication && presentation.communication.districtBeside) || null;
  const cityPartRow =
    (presentation.communication && presentation.communication.cityPartRow) || null;
  const parkingStatusLabel =
    (presentation.communication && presentation.communication.parkingStatusLabel) || null;
  const headLocality =
    (presentation.communication && presentation.communication.headLocality) ||
    presentation.communication.localityFallback ||
    "";
  const locality =
    municipalitySign ||
    municipality ||
    headLocality ||
    (tv.location && String(tv.location).trim()) ||
    (tv.subjectScopeLabel && String(tv.subjectScopeLabel).trim()) ||
    road ||
    "";
  const localityLine = compactLocalityLine(municipality, district);
  const dir =
    humanDirectionOrNull(tv.direction) ||
    (presentation.communication && presentation.communication.direction) ||
    null;
  const locationNote =
    tv.locationDisclosureCs != null && String(tv.locationDisclosureCs).trim()
      ? String(tv.locationDisclosureCs).trim()
      : "";
  const communicationLine = presentation.placeLine || "";
  const impactShort = tv.impact != null ? String(tv.impact) : "";
  const impactFullRaw = tv.impactFull != null ? String(tv.impactFull) : "";
  const impactFull = impactFullRaw || impactShort;
  const leadText = presentation.situationSummary;
  const eventLine = leadText || eventTypeLabel || "";
  const validityLine = presentation.validityLine || (tv.validityLine != null ? String(tv.validityLine) : "");
  const illustrationKey = presentation.event.illustrationKey || tv.illustrationKey || "neutral";
  const mapUrl = resolveSafeTrafficMapUrl(tv.mapTarget);
  const followId = String(tv.publicEventId || "").trim();
  const sourceLabel = presentation.sourceLabel || "ŘSD/NDIC";
  const expandedRows = presentation.expanded.rows || [];
  const sourceAlreadyInExpanded = expandedRows.some((r) => r && r.key === "sourceDescription");
  // Full source text lives once in expandedRows — do not also dump impactFull body.
  const showMore = presentation.showMore && expandedRows.length > 0;

  const detailRows = [];
  if (road) detailRows.push({ key: "road", label: "Komunikace", value: road });
  if (localityLine) detailRows.push({ key: "locality", label: "Lokalita", value: localityLine });
  if (dir) detailRows.push({ key: "direction", label: "Směr", value: dir });
  if (eventTypeLabel) detailRows.push({ key: "event", label: "Událost", value: eventTypeLabel });
  if (validityLine) detailRows.push({ key: "validity", label: "Platnost", value: validityLine });

  const quickBlocks = [];
  if (municipality) {
    quickBlocks.push({ key: "municipality", title: "Lokalita", body: localityLine || municipality });
  }
  if (tv.delayAvailable === true && tv.delayMinutes != null) {
    quickBlocks.push({
      key: "delay",
      title: "Zpoždění",
      body: String(tv.delayMinutes) + " min",
    });
  }

  const headline = eventTypeLabel || "";
  const directionArrow = dir ? "→ směr " + dir : "";

  return {
    badge,
    roadBadge: {
      road,
      roadClass,
      label: roadClassLabel,
      numberBadge: roadPres.numberBadge,
      roadTypeIcon: roadPres.roadTypeIcon,
      roadTypeIconAlt: roadPres.roadTypeIconAlt || "",
      showMotorwayIcon: roadPres.showMotorwayIcon === true,
      showMotorVehiclesIcon: roadPres.showMotorVehiclesIcon === true,
    },
    locality,
    headLocality,
    municipalitySign,
    municipalitySignLabel,
    besideLocality,
    districtBeside,
    cityPartRow,
    parkingStatusLabel,
    localityLine,
    municipality,
    district,
    direction: dir,
    directionArrow,
    eventTypeLabel,
    eventKind: presentation.event.kind,
    eventSignSrc: presentation.event.asset,
    communicationLine,
    placeLine: presentation.placeLine,
    placeLabel: presentation.placeLabel,
    situationLabel: presentation.situationLabel,
    situationSummary: presentation.situationSummary,
    locationNote,
    eventLine,
    leadText,
    headline,
    detailRows,
    expandedRows,
    validityLine,
    impactShort,
    impactFull: expandTrafficAbbreviationsCs(impactFull),
    impactFullRaw,
    sourceAlreadyInExpanded,
    // Renderer must not append impactFull body when sourceDescription row exists.
    renderImpactFullBody: false,
    showMore,
    quickBlocks,
    illustrationKey,
    mapUrl,
    mapDotCssVar: TRAFFIC_MAP_DOT_CSS_VAR,
    followId,
    sourceLabel,
    showActive,
    showNew,
    informative: presentation.informative !== false,
    presentation,
  };
}

/** Architecture self-check used by fixtures/meta. */
export function trafficIntegrationArchitectureAudit() {
  return {
    SEPARATE_TRAFFIC_HOME: TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_HOME,
    SEPARATE_TRAFFIC_SETTINGS: TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_SETTINGS,
    SEPARATE_TRAFFIC_FILTERS: TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_FILTERS,
    SEPARATE_TRAFFIC_LOCALITIES: TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_LOCALITIES,
    PUBLICATION_ENABLED: TRAFFIC_OVERVIEW_FLAGS.PUBLICATION_ENABLED,
    TRAFFIC_UI_ENABLED: TRAFFIC_OVERVIEW_FLAGS.TRAFFIC_UI_ENABLED,
    LIVE_NDIC_INGEST: TRAFFIC_OVERVIEW_FLAGS.LIVE_NDIC_INGEST,
    SHARED_SETTINGS: true,
    SHARED_LOCALITY_MODEL: true,
    SHARED_TIMELINE: true,
    TRAFFIC_FEED_INTERNAL_ONLY: true,
    FEATURE_FLAG_DISABLE_READY: true,
    pass:
      TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_HOME === false &&
      TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_SETTINGS === false &&
      TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_FILTERS === false &&
      TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_LOCALITIES === false &&
      TRAFFIC_OVERVIEW_FLAGS.PUBLICATION_ENABLED === false &&
      TRAFFIC_OVERVIEW_FLAGS.LIVE_NDIC_INGEST === false,
  };
}

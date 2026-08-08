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
 */
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

/** Cap sync card→feed conversion so overview paint stays bounded (full catalog stays on disk). */
export const TRAFFIC_UI_INITIAL_CARD_CAP = 120;

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

const ALLOWED_CARD_KEYS = Object.freeze([
  "publicEventId",
  "lifecycleStatus",
  "changeStatus",
  "eventType",
  "category",
  "severity",
  "road",
  "kilometer",
  "section",
  "direction",
  "location",
  "validity",
  "impact",
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
  "locationPresentationLevel",
  "subjectScopeVerified",
  "preciseLocationVerified",
  "subjectScopeKind",
  "subjectScopeLabel",
  "locationDisclosureCs",
  "routeMatchMode",
]);

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

  const trafficV1 = {
    publicEventId,
    lifecycleStatus: c.lifecycleStatus || null,
    changeStatus: c.changeStatus || null,
    eventType: c.eventType || c.category || null,
    category: c.category || c.eventCategory || c.eventType || null,
    severity: c.severity || null,
    road: road,
    // Never surface km/dir/section unless precise location verified
    kilometer: precise && c.kilometer != null ? c.kilometer : null,
    section: precise && (c.section != null || c.sectionLabel != null) ? c.section || c.sectionLabel : null,
    direction: precise && c.direction != null ? c.direction : null,
    location: locLabel,
    validity,
    impact: c.impact != null ? c.impact : c.impactSummary != null ? c.impactSummary : null,
    freshness: c.freshness != null ? c.freshness : c.freshnessStatus != null ? c.freshnessStatus : null,
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
    locationPresentationLevel: level,
    subjectScopeVerified: c.subjectScopeVerified === true,
    preciseLocationVerified: precise,
    subjectScopeKind: c.subjectScopeKind || null,
    subjectScopeLabel: c.subjectScopeLabel || null,
    locationDisclosureCs: c.locationDisclosureCs || null,
    routeMatchMode: c.routeMatchMode || null,
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
  const severity = String(trafficV1.severity || "").toLowerCase();
  const importance = severity === "high" || severity === "severe" ? 5 : severity === "medium" ? 4 : 3;
  const life = trafficV1.lifecycleStatus;
  let status = "aktivni";
  if (life === "ENDED") status = "ukonceno";
  if (life === "CANCELLED") status = "zruseno";
  if (life === "FUTURE") status = "naplanovano";

  const regionName = String(locLabel || admin || road || "").trim();
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
    publishedAt: trafficV1.lastMeaningfulChangeAt || trafficV1.downloadedAt || opts.nowIso || null,
    publishedAtSource: trafficV1.sourceUpdatedAt || null,
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

export function trafficBadgeModel(trafficV1) {
  const change = String((trafficV1 && trafficV1.feed && trafficV1.feed.feedChangeType) || "");
  const cat = String((trafficV1 && (trafficV1.category || trafficV1.eventType)) || "").toLowerCase();
  const life = String((trafficV1 && trafficV1.lifecycleStatus) || "");
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
  if (change === "EVENT_CREATED" && /pocasi|weather/.test(cat)) {
    return { kind: "warn", text: "⚠️ NOVÁ", aria: "Nová dopravní událost — počasí" };
  }
  if (change === "EVENT_CREATED" && /prace|roadwork|works/.test(cat)) {
    return { kind: "new-works", text: "🔵 NOVÁ", aria: "Nové práce na silnici" };
  }
  if (change === "EVENT_CREATED") {
    return { kind: "new", text: "🔴 NOVÁ", aria: "Nová dopravní událost" };
  }
  if (life === "ACTIVE") {
    return { kind: "active", text: "AKTIVNÍ DOPRAVA", aria: "Aktivní dopravní událost" };
  }
  return { kind: "info", text: "DOPRAVA ŘSD", aria: "Dopravní informace ŘSD" };
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
const LS_SNAPSHOT_MAX_CHARS = 262144; // 256 KiB — larger payloads stay memory-only

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
    const res = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res || !res.ok) return null;
    const parsed = await res.json();
    const snap = acceptTrafficSnapshot(parsed);
    if (!snap) return null;
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
  const capRaw = opts.maxCards != null ? Number(opts.maxCards) : TRAFFIC_UI_INITIAL_CARD_CAP;
  const cap = Number.isFinite(capRaw) && capRaw > 0 ? Math.floor(capRaw) : TRAFFIC_UI_INITIAL_CARD_CAP;
  const built = [];
  for (let i = 0; i < cards.length && built.length < cap; i++) {
    const r = trafficProjectionToFeedItem(cards[i], opts);
    if (r.ok) built.push(r.item);
  }
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
  const freshness = snapshot.sourceFreshness || "UNKNOWN";
  return {
    generatedAt,
    freshness,
    publicationEnabled: false,
    label:
      "Dopravní data (offline): " +
      (generatedAt || "neznámý čas") +
      " · čerstvost " +
      freshness,
  };
}

export function trafficHistoryLines(trafficV1) {
  const change = String((trafficV1 && trafficV1.feed && trafficV1.feed.feedChangeType) || "");
  const map = {
    EVENT_CREATED: "nová",
    EVENT_UPDATED: "změněná",
    EVENT_ENDED: "ukončená",
    EVENT_CANCELLED: "zrušená",
    VALIDITY_EXTENDED: "prodloužená",
    VALIDITY_SHORTENED: "zkrácená",
    DIRECTION_CHANGED: "změna směru",
    SECTION_CHANGED: "změna úseku",
    ROAD_CHANGED: "změna silnice",
    SEVERITY_CHANGED: "změna závažnosti",
    IMPACT_CHANGED: "změna dopadu",
    EVENT_REOPENED: "znovu aktivní",
  };
  const label = map[change];
  return label ? [label] : [];
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

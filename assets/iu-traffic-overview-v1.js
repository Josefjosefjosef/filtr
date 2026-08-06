/**
 * Traffic overview bridge for Můj přehled dne (InfoUzel.cz).
 * Renders allowlisted trafficV1 card payloads from audited publication projections.
 * Does NOT enable live publication, public API, NDIC ingest, or a separate Doprava home.
 */
export const TRAFFIC_OVERVIEW_FLAGS = Object.freeze({
  PUBLICATION_ENABLED: false,
  PUBLIC_API_ENABLED: false,
  LIVE_NDIC_INGEST: false,
  TRAFFIC_CARDS_RENDER: true,
  SEPARATE_TRAFFIC_HOME: false,
  PRODUCTION_DEPLOY: false,
});

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
]);

export function defaultTrafficPrefs() {
  return {
    trafficSpatialMode: TRAFFIC_SPATIAL.WHOLE_CZ,
    trafficTemporalFilter: TRAFFIC_TEMPORAL.NOW,
    trafficTypeFilter: TRAFFIC_TYPE.ALL,
    trafficMySelection: { roads: [], eventTypes: [], directions: [] },
    trafficMyRoutes: [],
    trafficNearHashes: [],
    trafficCustomFrom: "",
    trafficCustomTo: "",
    trafficOfflineAware: true,
  };
}

export function sanitizeTrafficPrefs(raw) {
  const d = defaultTrafficPrefs();
  const r = raw && typeof raw === "object" ? raw : {};
  const spatial = String(r.trafficSpatialMode || d.trafficSpatialMode);
  d.trafficSpatialMode = Object.values(TRAFFIC_SPATIAL).includes(spatial) ? spatial : TRAFFIC_SPATIAL.WHOLE_CZ;
  const temporal = String(r.trafficTemporalFilter || d.trafficTemporalFilter);
  d.trafficTemporalFilter = Object.values(TRAFFIC_TEMPORAL).includes(temporal) ? temporal : TRAFFIC_TEMPORAL.NOW;
  const type = String(r.trafficTypeFilter || d.trafficTypeFilter);
  d.trafficTypeFilter = Object.values(TRAFFIC_TYPE).includes(type) ? type : TRAFFIC_TYPE.ALL;
  d.trafficMySelection =
    r.trafficMySelection && typeof r.trafficMySelection === "object"
      ? {
          roads: Array.isArray(r.trafficMySelection.roads)
            ? r.trafficMySelection.roads.map(String).slice(0, 40)
            : [],
          eventTypes: Array.isArray(r.trafficMySelection.eventTypes)
            ? r.trafficMySelection.eventTypes.map(String).slice(0, 20)
            : [],
          directions: Array.isArray(r.trafficMySelection.directions)
            ? r.trafficMySelection.directions.map(String).slice(0, 10)
            : [],
        }
      : d.trafficMySelection;
  d.trafficMyRoutes = Array.isArray(r.trafficMyRoutes)
    ? r.trafficMyRoutes
        .filter((x) => x && typeof x === "object")
        .slice(0, 20)
        .map((route) => ({
          road: String(route.road || "").slice(0, 32),
          fromLabel: String(route.fromLabel || "").slice(0, 80),
          toLabel: String(route.toLabel || "").slice(0, 80),
          direction: String(route.direction || "").slice(0, 32),
          plannedDay: String(route.plannedDay || "").slice(0, 32),
          plannedTime: String(route.plannedTime || "").slice(0, 16),
        }))
    : [];
  d.trafficNearHashes = Array.isArray(r.trafficNearHashes)
    ? r.trafficNearHashes.map(String).slice(0, 64)
    : [];
  d.trafficCustomFrom = String(r.trafficCustomFrom || "").slice(0, 40);
  d.trafficCustomTo = String(r.trafficCustomTo || "").slice(0, 40);
  d.trafficOfflineAware = r.trafficOfflineAware !== false;
  return d;
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
 */
export function trafficProjectionToFeedItem(cardOrProj, opts = {}) {
  if (TRAFFIC_OVERVIEW_FLAGS.PUBLICATION_ENABLED === true) {
    return { ok: false, rejectCode: "PUBLICATION_MUST_STAY_OFF" };
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
  const trafficV1 = {
    publicEventId,
    lifecycleStatus: c.lifecycleStatus || null,
    changeStatus: c.changeStatus || null,
    eventType: c.eventType || c.category || null,
    category: c.category || c.eventCategory || c.eventType || null,
    severity: c.severity || null,
    road: c.road != null ? c.road : c.roadNumber != null ? c.roadNumber : null,
    kilometer: c.kilometer != null ? c.kilometer : null,
    section: c.section != null ? c.section : c.sectionLabel != null ? c.sectionLabel : null,
    direction: c.direction != null ? c.direction : null,
    location: c.location != null ? c.location : c.locationLabel != null ? c.locationLabel : null,
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

  const item = {
    id: "ie-traffic-" + publicEventId,
    sourceId: "rsd",
    sourceLabel: "ŘSD/NDIC",
    adapterOwner: "iu-traffic-overview-v1",
    sectionId: "doprava",
    lane: "doprava",
    eventType: "doprava",
    title: headline,
    summary: clip(trafficV1.impact, 280) || "",
    url: mapUrl || "",
    originalUrl: mapUrl || "",
    publishedAt: trafficV1.lastMeaningfulChangeAt || trafficV1.downloadedAt || opts.nowIso || null,
    publishedAtSource: trafficV1.sourceUpdatedAt || null,
    status,
    importance,
    region: trafficV1.location ? { summary: String(trafficV1.location) } : null,
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
    // Allow only official ŘSD / NDIC traffic-info host
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

function startOfDayUtc(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function overlapsWindow(fromMs, toMs, winStart, winEnd) {
  const start = Number.isFinite(fromMs) ? fromMs : -Infinity;
  const end = Number.isFinite(toMs) ? toMs : Infinity;
  return start <= winEnd && end >= winStart;
}

export function matchesTrafficTemporal(item, filter, opts = {}) {
  const tv = item && item.trafficV1;
  if (!tv) return false;
  const nowMs = Date.parse(opts.nowIso || new Date().toISOString());
  const from = tv.validity && tv.validity.validFrom ? Date.parse(tv.validity.validFrom) : NaN;
  const to = tv.validity && tv.validity.expectedEnd ? Date.parse(tv.validity.expectedEnd) : NaN;
  switch (filter) {
    case TRAFFIC_TEMPORAL.NOW: {
      const start = Number.isFinite(from) ? from : -Infinity;
      const end = Number.isFinite(to) ? to : Infinity;
      return start <= nowMs && end >= nowMs;
    }
    case TRAFFIC_TEMPORAL.TODAY: {
      const s = startOfDayUtc(nowMs);
      return overlapsWindow(from, to, s, s + 86400000 - 1);
    }
    case TRAFFIC_TEMPORAL.TOMORROW: {
      const s = startOfDayUtc(nowMs) + 86400000;
      return overlapsWindow(from, to, s, s + 86400000 - 1);
    }
    case TRAFFIC_TEMPORAL.WEEKEND: {
      const day = new Date(nowMs).getUTCDay();
      const toSat = (6 - day + 7) % 7;
      const sat =
        startOfDayUtc(nowMs) +
        (day === 0 || day === 6 ? (day === 6 ? 0 : -86400000) : toSat * 86400000);
      return overlapsWindow(from, to, sat, sat + 2 * 86400000 - 1);
    }
    case TRAFFIC_TEMPORAL.CUSTOM_DATETIME: {
      const cs = Date.parse(opts.customFrom || "");
      const ce = Date.parse(opts.customTo || "");
      if (!Number.isFinite(cs) || !Number.isFinite(ce)) return false;
      return overlapsWindow(from, to, cs, ce);
    }
    default:
      return false;
  }
}

export function matchesTrafficType(item, typeFilter) {
  const tv = item && item.trafficV1;
  if (!tv) return false;
  const t = typeFilter || TRAFFIC_TYPE.ALL;
  if (t === TRAFFIC_TYPE.ALL) return true;
  const cat = String(tv.category || tv.eventType || "").toLowerCase();
  const life = tv.lifecycleStatus;
  const sev = String(tv.severity || "").toLowerCase();
  switch (t) {
    case TRAFFIC_TYPE.CLOSURES:
      return /uzavir|closure/.test(cat);
    case TRAFFIC_TYPE.RESTRICTIONS:
      return /omezen|restrict/.test(cat);
    case TRAFFIC_TYPE.ACCIDENTS:
      return /nehod|accident/.test(cat);
    case TRAFFIC_TYPE.ROADWORKS:
      return /prace|roadwork|works/.test(cat);
    case TRAFFIC_TYPE.QUEUES:
      return /kolon|queue|congest/.test(cat);
    case TRAFFIC_TYPE.ROAD_AND_WEATHER:
      return /pocasi|weather|vozov/.test(cat);
    case TRAFFIC_TYPE.FUTURE:
      return life === "FUTURE";
    case TRAFFIC_TYPE.ENDED:
      return life === "ENDED" || life === "CANCELLED";
    case TRAFFIC_TYPE.SEVERE:
      return sev === "high" || sev === "severe";
    default:
      return false;
  }
}

export function matchesTrafficSpatial(item, prefs) {
  const tv = item && item.trafficV1;
  if (!tv) return false;
  const mode = (prefs && prefs.trafficSpatialMode) || TRAFFIC_SPATIAL.WHOLE_CZ;
  if (mode === TRAFFIC_SPATIAL.WHOLE_CZ) return true;
  if (mode === TRAFFIC_SPATIAL.MY_SELECTION) {
    const roads = new Set(((prefs.trafficMySelection && prefs.trafficMySelection.roads) || []).map(String));
    if (!roads.size) return false;
    return tv.road != null && roads.has(String(tv.road));
  }
  if (mode === TRAFFIC_SPATIAL.MY_ROUTES) {
    const routes = prefs.trafficMyRoutes || [];
    if (!routes.length) return false;
    return routes.some((r) => r && r.road && tv.road != null && String(r.road) === String(tv.road));
  }
  if (mode === TRAFFIC_SPATIAL.NEAR_ME) {
    const hashes = new Set((prefs.trafficNearHashes || []).map(String));
    const mine = (tv._nearHashes || item._nearHashes || []).map(String);
    if (!hashes.size || !mine.length) return false;
    return mine.some((h) => hashes.has(h));
  }
  return false;
}

export function filterTrafficFeedItems(items, prefs, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const p = sanitizeTrafficPrefs(prefs || {});
  const out = [];
  for (const it of list) {
    if (!it || !it.trafficV1) continue;
    if (it.publicationEnabled === true) continue;
    if (!matchesTrafficSpatial(it, p)) continue;
    if (!matchesTrafficTemporal(it, p.trafficTemporalFilter, {
      nowIso: opts.nowIso,
      customFrom: p.trafficCustomFrom,
      customTo: p.trafficCustomTo,
    })) {
      continue;
    }
    if (!matchesTrafficType(it, p.trafficTypeFilter)) continue;
    out.push(it);
  }
  out.sort((a, b) => {
    const ta = Date.parse((a.trafficV1 && a.trafficV1.lastMeaningfulChangeAt) || a.publishedAt || "") || 0;
    const tb = Date.parse((b.trafficV1 && b.trafficV1.lastMeaningfulChangeAt) || b.publishedAt || "") || 0;
    if (tb !== ta) return tb - ta;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  return out;
}

export function isRsdTrafficSourceEnabled(prefs) {
  const f = prefs || {};
  const ids = f.sourceIds || [];
  const groups = f.sourceGroups || [];
  if (ids.length === 1 && ids[0] === "__none__") return false;
  if (!ids.length && !groups.length) return true; // "all sources"
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

/**
 * Load offline snapshot from localStorage (publication projections only).
 */
export function loadOfflineTrafficSnapshot() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_OFFLINE_SNAPSHOT);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.publicationEnabled === true) return null;
    const canary = scanTrafficUiCanaries(parsed);
    if (!canary.ok) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

export function saveOfflineTrafficSnapshot(snapshot) {
  if (typeof localStorage === "undefined") return { ok: false };
  if (!snapshot || snapshot.publicationEnabled === true) {
    return { ok: false, rejectCode: "PUBLICATION_MUST_STAY_OFF" };
  }
  const canary = scanTrafficUiCanaries(snapshot);
  if (!canary.ok) return { ok: false, rejectCode: "TRAFFIC_UI_SECURITY_CANARY_DETECTED", hits: canary.hits };
  try {
    localStorage.setItem(LS_OFFLINE_SNAPSHOT, JSON.stringify(snapshot));
    return { ok: true };
  } catch (_) {
    return { ok: false, rejectCode: "STORAGE_FAILED" };
  }
}

export function clearOfflineTrafficSnapshot() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LS_OFFLINE_SNAPSHOT);
  } catch (_) {}
}

/**
 * Build overview traffic items from offline snapshot cards/projections.
 */
export function trafficItemsFromOfflineSnapshot(snapshot, prefs, opts = {}) {
  if (!snapshot || snapshot.publicationEnabled === true) return [];
  if (TRAFFIC_OVERVIEW_FLAGS.PUBLICATION_ENABLED === true) return [];
  const cards = Array.isArray(snapshot.cards) && snapshot.cards.length
    ? snapshot.cards
    : Array.isArray(snapshot.projections)
      ? snapshot.projections
      : [];
  const built = [];
  for (const c of cards) {
    const r = trafficProjectionToFeedItem(c, opts);
    if (r.ok) built.push(r.item);
  }
  return filterTrafficFeedItems(built, prefs, opts);
}

/**
 * Merge traffic items into overview list without creating a separate home.
 */
export function mergeTrafficIntoOverview(baseItems, prefs, opts = {}) {
  const base = Array.isArray(baseItems) ? baseItems.slice() : [];
  if (!isDopravaTopicEnabled(prefs) || !isRsdTrafficSourceEnabled(prefs)) {
    return base.filter((x) => !(x && x.trafficV1));
  }
  const fromFeed = base.filter((x) => x && x.trafficV1);
  const fromOffline =
    prefs && prefs.trafficOfflineAware === false
      ? []
      : trafficItemsFromOfflineSnapshot(opts.snapshot || loadOfflineTrafficSnapshot(), prefs, opts);
  const byId = new Map();
  for (const it of fromFeed) byId.set(String(it.id), it);
  for (const it of fromOffline) {
    if (!byId.has(String(it.id))) byId.set(String(it.id), it);
  }
  const traffic = filterTrafficFeedItems(Array.from(byId.values()), prefs, opts);
  const nonTraffic = base.filter((x) => !(x && x.trafficV1));
  // Interleave by publishedAt / lastMeaningfulChangeAt with other cards
  const merged = nonTraffic.concat(traffic);
  merged.sort((a, b) => {
    const ta =
      Date.parse(
        (a.trafficV1 && a.trafficV1.lastMeaningfulChangeAt) || a.publishedAt || a.publishedAtSource || ""
      ) || 0;
    const tb =
      Date.parse(
        (b.trafficV1 && b.trafficV1.lastMeaningfulChangeAt) || b.publishedAt || b.publishedAtSource || ""
      ) || 0;
    if (tb !== ta) return tb - ta;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  return merged;
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

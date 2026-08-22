/**
 * InfoUzel — shared feed filter model (Doprava + ČHMÚ).
 * Presentation-only; never mutates source/ingest data.
 *
 * Empty-selection semantics (UNIFORM):
 * - localities []  → Celá ČR (no geo restriction)
 * - roads []       → all roads
 * - eventCategories [] → all non-parking event types
 * - parkingEnabled false → hide parking cards
 * - parkingEnabled true + parkingIds [] → all registry parking
 * - parkingEnabled true + parkingIds [..] → OR match those ids
 *
 * Within a group = OR; between groups = AND.
 */
import {
  PARKING_REGISTRY,
  matchParkingRegistry,
} from "./iu-parking-registry-v1.js?v=evening-theme-settings-v1-20260818";

export const FEED_FILTER_VERSION = 1;

/** True for ČHMÚ / CAP feed items (incl. smoke stubs using sourceId chmi-cap). */
export function isChmiFeedEvent(ev) {
  if (!ev || typeof ev !== "object") return false;
  if (ev.capV2) return true;
  const sid = String(ev.sourceId || "").toLowerCase();
  if (sid === "chmi" || sid === "chmi-cap" || sid.startsWith("chmi")) return true;
  const ctype = String(ev.connectorType || "").toLowerCase();
  if (ctype === "chmi-cap" || ctype.startsWith("chmi")) return true;
  return false;
}

/** @typedef {'all'|'traffic'|'chmu'} FeedQuickView */

/** User-facing event categories (normalized types fully covered). */
export const EVENT_USER_CATEGORIES = Object.freeze([
  Object.freeze({
    id: "nehody",
    label: "Nehody",
    types: Object.freeze(["nehoda"]),
  }),
  Object.freeze({
    id: "kolony",
    label: "Kolony a silný provoz",
    types: Object.freeze(["kolona"]),
    kinds: Object.freeze(["queue", "heavy_traffic"]),
  }),
  Object.freeze({
    id: "uzavirky",
    label: "Uzavírky a omezení",
    types: Object.freeze(["omezeni", "objizdka", "uzavirka"]),
    kinds: Object.freeze(["closure", "warning"]),
  }),
  Object.freeze({
    id: "prace",
    label: "Práce na silnici",
    types: Object.freeze(["prace"]),
    kinds: Object.freeze(["roadworks"]),
  }),
  Object.freeze({
    id: "prekazky",
    label: "Překážky a poruchy",
    types: Object.freeze(["prekazka"]),
    kinds: Object.freeze(["obstacle", "oversize_load"]),
  }),
  Object.freeze({
    id: "nebezpeci",
    label: "Nebezpečí",
    types: Object.freeze(["pozar"]),
  }),
  Object.freeze({
    id: "sjizdnost",
    label: "Sjízdnost a počasí",
    types: Object.freeze(["sjizdnost"]),
  }),
  Object.freeze({
    id: "ostatni",
    label: "Další dopravní informace",
    types: Object.freeze(["doprava"]),
  }),
]);

const TYPE_TO_CATEGORY = (() => {
  /** @type {Record<string, string>} */
  const m = {};
  for (const cat of EVENT_USER_CATEGORIES) {
    for (const t of cat.types || []) m[String(t).toLowerCase()] = cat.id;
    for (const k of cat.kinds || []) m["kind:" + String(k).toLowerCase()] = cat.id;
  }
  return Object.freeze(m);
})();

/** Road class groups shown in UI (LOCAL intentionally omitted — residual heuristic only). */
export const ROAD_FILTER_GROUPS = Object.freeze([
  Object.freeze({ id: "MOTORWAY", label: "Dálnice", roadClass: "MOTORWAY" }),
  Object.freeze({
    id: "MOTOR_VEHICLE",
    label: "Silnice pro motorová vozidla",
    roadClass: "MOTOR_VEHICLE",
  }),
  Object.freeze({ id: "CLASS_I", label: "Silnice I. třídy", roadClass: "CLASS_I" }),
  Object.freeze({ id: "CLASS_II", label: "Silnice II. třídy", roadClass: "CLASS_II" }),
  Object.freeze({ id: "CLASS_III", label: "Silnice III. třídy", roadClass: "CLASS_III" }),
  Object.freeze({ id: "E_ROAD", label: "Evropské tahy", roadClass: "E_ROAD" }),
]);

export function defaultTrafficFilter() {
  return {
    localities: [],
    roads: [],
    eventCategories: [],
    parkingEnabled: false,
    parkingIds: [],
  };
}

export function defaultChmuFilter() {
  return {
    localities: [],
  };
}

export function defaultFeedFilter() {
  return {
    version: FEED_FILTER_VERSION,
    trafficEnabled: true,
    chmuEnabled: true,
    traffic: defaultTrafficFilter(),
    chmu: defaultChmuFilter(),
  };
}

function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  const seen = new Set();
  for (const x of v) {
    const s = String(x == null ? "" : x).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function asLocalities(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((loc) => loc && typeof loc === "object")
    .map((loc) => ({
      name: String(loc.name || "").trim(),
      level: String(loc.level || "").trim(),
      id: loc.id != null ? String(loc.id) : "",
      orpCode: loc.orpCode != null ? String(loc.orpCode) : "",
    }))
    .filter((loc) => loc.name && loc.level);
}

export function sanitizeFeedFilter(raw) {
  const base = defaultFeedFilter();
  const src = raw && typeof raw === "object" ? raw : {};
  const trafficIn = src.traffic && typeof src.traffic === "object" ? src.traffic : {};
  const chmuIn = src.chmu && typeof src.chmu === "object" ? src.chmu : {};
  const knownCats = new Set(EVENT_USER_CATEGORIES.map((c) => c.id));
  knownCats.add("__none__");
  const eventCategories = asStringArray(trafficIn.eventCategories).filter((id) => knownCats.has(id));
  const eventCategoriesFinal =
    eventCategories.includes("__none__") && eventCategories.length > 1
      ? eventCategories.filter((id) => id !== "__none__")
      : eventCategories;
  return {
    version: FEED_FILTER_VERSION,
    trafficEnabled: src.trafficEnabled !== false,
    chmuEnabled: src.chmuEnabled !== false,
    traffic: {
      localities: asLocalities(trafficIn.localities).filter((l) => l.level !== "kraj"),
      roads: asStringArray(trafficIn.roads).map((r) => r.toUpperCase()),
      eventCategories: eventCategoriesFinal,
      parkingEnabled: !!trafficIn.parkingEnabled,
      parkingIds: asStringArray(trafficIn.parkingIds),
    },
    chmu: {
      localities: asLocalities(chmuIn.localities),
    },
  };
}

/**
 * Build feedFilter from legacy sections/sources/localities prefs.
 * Shared locality is copied to BOTH traffic and chmu so prior geo restriction is preserved.
 */
export function migrateFeedFilterFromLegacyPrefs(prefs) {
  const p = prefs || {};
  if (p.feedFilter && typeof p.feedFilter === "object") {
    return sanitizeFeedFilter(p.feedFilter);
  }
  const secs = Array.isArray(p.sections) ? p.sections : [];
  const ids = Array.isArray(p.sourceIds) ? p.sourceIds : [];
  const groups = Array.isArray(p.sourceGroups) ? p.sourceGroups : [];
  const noneSecs = secs.length === 1 && secs[0] === "__none__";
  const noneSrc = ids.length === 1 && ids[0] === "__none__";

  let trafficEnabled = true;
  if (noneSecs || noneSrc) trafficEnabled = false;
  else if (secs.length || ids.length || groups.length) {
    const topicOk = !secs.length || secs.includes("doprava");
    const srcOk =
      !ids.length && !groups.length
        ? true
        : ids.includes("rsd") ||
          ids.includes("ndic") ||
          groups.includes("doprava") ||
          groups.includes("ndic");
    trafficEnabled = topicOk && srcOk;
  }

  let chmuEnabled = true;
  if (noneSecs || noneSrc) chmuEnabled = false;
  else if (secs.length || ids.length || groups.length) {
    const topicOk = !secs.length || secs.includes("pocasi") || secs.includes("doprava");
    // Empty = all sources historically included ČHMÚ; explicit lists must include chmi.
    const srcOk =
      !ids.length && !groups.length
        ? true
        : ids.includes("chmi") || groups.includes("pocasi") || groups.includes("chmi");
    // If user had only explicit non-chmi sources, disable CHMU.
    if (ids.length || groups.length) {
      chmuEnabled = ids.includes("chmi") || groups.includes("pocasi") || groups.includes("chmi");
    } else {
      chmuEnabled = topicOk;
    }
  }

  const locs = asLocalities(p.localities);
  const ff = defaultFeedFilter();
  ff.trafficEnabled = trafficEnabled;
  ff.chmuEnabled = chmuEnabled;
  ff.traffic.localities = locs.slice();
  ff.chmu.localities = locs.slice();
  return sanitizeFeedFilter(ff);
}

export function ensureFeedFilter(prefs) {
  return migrateFeedFilterFromLegacyPrefs(prefs || {});
}

export function resetTrafficFeedFilter() {
  return defaultTrafficFilter();
}

export function resetChmuFeedFilter() {
  return defaultChmuFilter();
}

export function mapEventTypeToUserCategory(eventType, eventKind) {
  const kind = String(eventKind || "")
    .trim()
    .toLowerCase();
  if (kind && TYPE_TO_CATEGORY["kind:" + kind]) return TYPE_TO_CATEGORY["kind:" + kind];
  const t = String(eventType || "")
    .trim()
    .toLowerCase();
  if (t && TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t];
  return "ostatni";
}

export function isParkingTrafficEvent(ev) {
  if (!(ev && ev.trafficV1)) return false;
  const tv = ev.trafficV1;
  const kind = String(tv.eventKind || tv.presentationKind || "").toLowerCase();
  if (kind === "parking") return true;
  const t = String(tv.eventType || tv.category || "").toLowerCase();
  return t === "parking" || t === "parkoviste";
}

export function resolveTrafficParkingId(ev) {
  if (!(ev && ev.trafficV1)) return "";
  const tv = ev.trafficV1;
  if (tv.parkingRegistryId) return String(tv.parkingRegistryId);
  if (tv.parkingId) return String(tv.parkingId);
  const hit = matchParkingRegistry({
    parkingId: tv.parkingId || tv.parkingRegistryId,
    parkingName: tv.parkingName || tv.location || tv.road,
    impact: tv.impact || tv.summary,
    impactFull: tv.impactFull || tv.summaryFull,
    location: tv.location,
  });
  return hit ? hit.parkingId : "";
}

export function parkingCitiesFromRegistry() {
  /** @type {Map<string, { city: string, lots: { id: string, name: string }[] }>} */
  const map = new Map();
  for (const e of PARKING_REGISTRY) {
    if (!e || !e.municipality || !e.parkingId) continue;
    const city = String(e.municipality);
    if (!map.has(city)) map.set(city, { city, lots: [] });
    map.get(city).lots.push({ id: e.parkingId, name: e.canonicalName || e.parkingId });
  }
  return Array.from(map.values()).sort((a, b) => a.city.localeCompare(b.city, "cs"));
}

/**
 * Classify a road number the same way as traffic-card-content (client mirror).
 */
export function classifyRoadNumberClient(roadNumber) {
  const r = String(roadNumber || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!r) return "UNKNOWN";
  if (/^E\d+[A-Z]?$/.test(r) || /^E\d+/.test(r)) return "E_ROAD";
  if (/^D\d+[A-Z]?$/.test(r) || /^R\d+/.test(r)) return "MOTORWAY";
  if (/^III\/\d+/.test(r)) return "CLASS_III";
  if (/^II\/\d+/.test(r)) return "CLASS_II";
  if (/^I\/\d+/.test(r)) return "CLASS_I";
  if (/^\d{1,3}[A-Z]?$/.test(r)) return "CLASS_I";
  if (/^\d{4,6}[A-Z]?$/.test(r)) return "CLASS_III";
  return "UNKNOWN";
}

export function normalizeRoadLabel(road) {
  return String(road || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/**
 * Build road catalog from offline snapshot / visible traffic items (data-derived, no brief hardcode).
 * @returns {{ byClass: Record<string, string[]>, all: string[], smv: string[] }}
 */
export function buildRoadCatalogFromTrafficItems(items) {
  /** @type {Map<string, Set<string>>} */
  const byClass = new Map();
  const smv = new Set();
  const all = new Set();
  for (const group of ROAD_FILTER_GROUPS) {
    byClass.set(group.roadClass, new Set());
  }
  for (const ev of items || []) {
    const tv = (ev && ev.trafficV1) || ev || {};
    const road = normalizeRoadLabel(tv.road || tv.roadNumber || "");
    if (!road) continue;
    all.add(road);
    let rc = String(tv.roadClass || "").toUpperCase();
    if (!rc || rc === "UNKNOWN" || rc === "LOCAL") rc = classifyRoadNumberClient(road);
    if (rc === "LOCAL" || rc === "UNKNOWN") {
      // Keep in all, but do not invent a LOCAL UI group.
    } else if (byClass.has(rc)) {
      byClass.get(rc).add(road);
    } else {
      // Unlisted class → still searchable via all
    }
    const smvOn =
      tv.motorVehicleRoadConfirmed === true ||
      tv.isMotorVehicleRoad === true ||
      tv.motorVehicleRoadStatus === true ||
      String(tv.roadFacilityType || "") === "MOTOR_VEHICLE_ROAD";
    if (smvOn) smv.add(road);
  }
  /** @type {Record<string, string[]>} */
  const outBy = {};
  for (const [k, set] of byClass.entries()) {
    outBy[k] = Array.from(set).sort((a, b) => a.localeCompare(b, "cs", { numeric: true }));
  }
  outBy.MOTOR_VEHICLE = Array.from(smv).sort((a, b) => a.localeCompare(b, "cs", { numeric: true }));
  return {
    byClass: outBy,
    all: Array.from(all).sort((a, b) => a.localeCompare(b, "cs", { numeric: true })),
    smv: outBy.MOTOR_VEHICLE.slice(),
  };
}

function roadFromTrafficView(tv) {
  const direct = normalizeRoadLabel(tv.road || tv.roadNumber || "");
  if (direct) return direct;
  // Existing offline cards may lack structured road while official impact names D1 / EXIT.
  // Fail-closed: leading motorway token or "dálnice Dx" / "Dx … EXIT" only.
  const blob = String(tv.impactFull || tv.impact || tv.summaryFull || tv.summary || "").trim();
  if (!blob) return "";
  const primary = blob.split(/\bObjížďk[ay]\b|\bObjízdn[áa]\s+tras|\bObjizdka\b/i)[0] || blob;
  const lead = primary.match(/^\s*([DER]\d{1,3}[A-Za-z]?)\b/i);
  if (lead) return normalizeRoadLabel(lead[1]);
  const dalnice = primary.match(/\bdálnice\s+([DER]\d{1,3}[A-Za-z]?)\b/i);
  if (dalnice) return normalizeRoadLabel(dalnice[1]);
  const exitPaired = primary.match(
    /\b([DER]\d{1,3}[A-Za-z]?)\s+(?:výjezd|sjezd|nájezd)?\s*EXIT(?:u|e)?\s+\d{1,4}[A-Za-z]?\b/i
  );
  if (exitPaired) return normalizeRoadLabel(exitPaired[1]);
  return "";
}

function roadMatchesSelection(tv, selectedRoads) {
  if (!selectedRoads.length) return true;
  const road = roadFromTrafficView(tv);
  if (!road) return false;
  const set = new Set(selectedRoads.map(normalizeRoadLabel));
  if (set.has(road)) return true;
  // SMV-named roads may appear without classic D/I labels — allow exact match only.
  return false;
}

function eventMatchesCategories(tv, selectedCats) {
  if (!selectedCats.length) return true;
  if (selectedCats.length === 1 && selectedCats[0] === "__none__") return false;
  const cat = mapEventTypeToUserCategory(tv.eventType || tv.category, tv.eventKind || tv.presentationKind);
  return selectedCats.includes(cat);
}

/**
 * Match one traffic card against traffic detail filter (area applied separately via prefs localities).
 */
export function matchesTrafficDetailFilter(ev, trafficFilter) {
  const tf = trafficFilter || defaultTrafficFilter();
  const tv = (ev && ev.trafficV1) || null;
  if (!tv) return false;

  if (isParkingTrafficEvent(ev)) {
    if (!tf.parkingEnabled) return false;
    const ids = asStringArray(tf.parkingIds);
    if (!ids.length) return true;
    const pid = resolveTrafficParkingId(ev);
    return !!(pid && ids.includes(pid));
  }

  // Non-parking: parking toggle does not hide regular events.
  if (!roadMatchesSelection(tv, asStringArray(tf.roads))) return false;
  if (!eventMatchesCategories(tv, asStringArray(tf.eventCategories))) return false;
  return true;
}

/**
 * Overlay feedFilter onto prefs for CHMI filterEvents / traffic locality.
 * Does not mutate the original prefs object deeply beyond returned clone fields.
 */
export function prefsForChmuFilter(prefs, feedFilter) {
  const ff = sanitizeFeedFilter(feedFilter || (prefs && prefs.feedFilter));
  const base = Object.assign({}, prefs || {});
  base.feedFilter = ff;
  base.localities = (ff.chmu.localities || []).slice();
  base.localityQuery = "";
  base.myRegionOnly = false;
  // Clear legacy topic/source gates so CHMI is not double-filtered by old rails.
  base.sections = [];
  base.sourceIds = [];
  base.sourceGroups = [];
  base.lanes = [];
  if (base.localities.length) {
    const cities = base.localities.filter((l) => l.level === "mesto");
    const okresy = base.localities.filter((l) => l.level === "okres");
    const kraje = base.localities.filter((l) => l.level === "kraj");
    base.homeObec = cities[0] ? cities[0].name : "";
    base.homeOkres = okresy[0] ? okresy[0].name : "";
    base.homeKraj = kraje[0] ? kraje[0].name : "";
  } else {
    base.homeObec = "";
    base.homeOkres = "";
    base.homeKraj = "";
  }
  return base;
}

export function prefsForTrafficLocality(prefs, feedFilter) {
  const ff = sanitizeFeedFilter(feedFilter || (prefs && prefs.feedFilter));
  const base = Object.assign({}, prefs || {});
  base.feedFilter = ff;
  base.localities = (ff.traffic.localities || []).slice();
  base.localityQuery = "";
  base.myRegionOnly = false;
  base.sections = [];
  base.sourceIds = [];
  base.sourceGroups = [];
  if (base.localities.length) {
    const cities = base.localities.filter((l) => l.level === "mesto");
    base.homeObec = cities[0] ? cities[0].name : "";
    base.homeOkres = "";
    base.homeKraj = "";
  } else {
    base.homeObec = "";
    base.homeOkres = "";
    base.homeKraj = "";
  }
  return base;
}

export function summarizeLocalities(localities) {
  const list = asLocalities(localities);
  if (!list.length) return "Celá ČR";
  const labels = list.map((l) => l.name);
  if (labels.length <= 2) return labels.join(" + ");
  return labels.slice(0, 2).join(" + ") + " + " + (labels.length - 2) + " další";
}

export function summarizeRoads(roads) {
  const list = asStringArray(roads);
  if (!list.length) return "Všechny";
  if (list.length <= 3) return list.join(", ");
  return list.slice(0, 3).join(", ") + " + " + (list.length - 3) + " další";
}

export function summarizeEventCategories(cats) {
  const list = asStringArray(cats);
  if (!list.length) return "Všechny";
  if (list.length === 1 && list[0] === "__none__") return "Žádné";
  const labels = list
    .filter((id) => id !== "__none__")
    .map((id) => {
      const hit = EVENT_USER_CATEGORIES.find((c) => c.id === id);
      return hit ? hit.label : id;
    });
  if (labels.length <= 3) return labels.join(", ");
  return labels.slice(0, 3).join(", ") + " + " + (labels.length - 3) + " další";
}

export function summarizeParking(trafficFilter) {
  const tf = trafficFilter || defaultTrafficFilter();
  if (!tf.parkingEnabled) return "Vypnuto";
  const ids = asStringArray(tf.parkingIds);
  if (!ids.length) return "Všechna parkoviště";
  const cities = parkingCitiesFromRegistry();
  const parts = [];
  for (const city of cities) {
    const n = city.lots.filter((l) => ids.includes(l.id)).length;
    if (n) parts.push(city.city + ": " + n);
  }
  return parts.length ? parts.join(" · ") : ids.length + " parkovišť";
}

/**
 * Apply main enable flags + quick view to a mixed timeline list.
 * @param {any[]} list
 * @param {{ trafficEnabled: boolean, chmuEnabled: boolean }} ff
 * @param {FeedQuickView} quickView
 */
export function applyFeedSourceAndQuickView(list, ff, quickView) {
  const trafficOn = ff.trafficEnabled !== false;
  const chmuOn = ff.chmuEnabled !== false;
  const q = quickView === "traffic" || quickView === "chmu" ? quickView : "all";
  return (list || []).filter((ev) => {
    const isTraffic = !!(ev && ev.trafficV1);
    const isChmi = isChmiFeedEvent(ev);
    if (isTraffic) {
      if (!trafficOn) return false;
      if (q === "chmu") return false;
      return true;
    }
    if (isChmi) {
      if (!chmuOn) return false;
      if (q === "traffic") return false;
      return true;
    }
    // Non-traffic / non-chmi legacy items: show only in "all" when both or either enabled broadly.
    if (q === "traffic" || q === "chmu") return false;
    return trafficOn || chmuOn;
  });
}

function escFeedHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Quick-view toolbar — on critical CHMI path (feed-filter, not deferred settings module). */
export function quickViewBarHtml(ff, quickView) {
  const trafficOn = ff.trafficEnabled !== false;
  const chmuOn = ff.chmuEnabled !== false;
  const q = quickView === "traffic" || quickView === "chmu" ? quickView : "all";
  const btn = (id, label, cls, disabled) =>
    `<button type="button" class="iuPdQuickView__btn iuPdQuickView__btn--${escFeedHtml(cls)}${
      q === id ? " is-on" : ""
    }" data-act="feed-quick-view" data-view="${escFeedHtml(id)}"${disabled ? " disabled aria-disabled=\"true\"" : ""}>${escFeedHtml(
      label
    )}</button>`;
  return (
    `<div class="iuPdQuickView" data-iu-feed-quick="1" role="toolbar" aria-label="Rychlý pohled feedu">` +
    btn("all", "Vše", "all", false) +
    btn("traffic", "Doprava", "traffic", !trafficOn) +
    btn("chmu", "ČHMÚ", "chmu", !chmuOn) +
    `</div>`
  );
}

export function emptyFeedStateHtml() {
  return (
    `<div class="iuPdFeedEmpty iuPdEmpty iuPrehledDne__empty" data-iu-feed-empty="1" role="status">` +
    `<p class="iuPdFeedEmpty__title">Pro toto nastavení momentálně nemáme žádné události.</p>` +
    `<button type="button" class="iuPdBtn iuPdBtn--primary" data-act="open-settings">Upravit filtry</button>` +
    `</div>`
  );
}

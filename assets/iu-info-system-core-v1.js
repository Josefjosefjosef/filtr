/**
 * InfoUzel.cz — shared info-system data layer (Přehled dne v3)
 * Backend prepares datasets; frontend is local-first and never fetches source sites.
 * Displays only: time, title, real source, place, status, importance, origin URL.
 * Never images, perex, or article body.
 */
const IU_INFO_SYSTEM_VERSION = "3.0.0";
const LS_READ = "iu.infoEvents.read.v1";
const LS_SAVED = "iu.infoEvents.saved.v1";
const LS_HIDDEN = "iu.infoEvents.hidden.v1";
const LS_PREFS = "iu.infoEvents.prefs.v1";

function iuInfoBasePath() {
  try {
    const p = String(location.pathname || "").toLowerCase();
    if (p.includes("/filtr/")) return "/filtr/projects/";
    if (p.includes("/projects/")) return "/projects/";
  } catch (_) {}
  return "/projects/";
}

function iuInfoDataUrl(file) {
  const ver =
    (typeof document !== "undefined" &&
      document.querySelector &&
      (document.querySelector('meta[name="iu-data-ver"]')?.getAttribute("content") || "").trim()) ||
    String(Date.now());
  return `${iuInfoBasePath()}data/info_events/${file}?v=${encodeURIComponent(ver)}`;
}

function readJsonSet(key) {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch (_) {
    return new Set();
  }
}

function writeJsonSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch (_) {}
}

function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map(String).filter(Boolean);
}

function isCutoverEnabled() {
  try {
    const q = new URLSearchParams(location.search || "");
    const mode = String(q.get("iuInfoSystem") || "").toLowerCase();
    if (mode === "parallel" || mode === "off") return false;
    if (mode === "cutover" || mode === "1" || mode === "on") return true;
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.__IU_INFO_SYSTEM_CUTOVER__ === false) return false;
    if (typeof window !== "undefined" && window.__IU_INFO_SYSTEM_CUTOVER__ === true) return true;
  } catch (_) {}
  return true;
}

function isParallelMode() {
  try {
    const q = new URLSearchParams(location.search || "");
    return String(q.get("iuInfoSystem") || "").toLowerCase() === "parallel";
  } catch (_) {
    return false;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.json();
}

function eventSortAt(ev) {
  return ev && (ev.sortAt || ev.publishedAtSource || ev.firstSeenByInfoUzel || ev.publishedAt || ev.updatedAt || "");
}

async function loadInfoSystemData(opts) {
  const o = opts || {};
  let manifest = null;
  let metadata = null;
  try {
    manifest = await fetchJson(iuInfoDataUrl("manifest.json"));
  } catch (_) {
    manifest = null;
  }
  try {
    metadata = await fetchJson(iuInfoDataUrl("metadata.json"));
  } catch (_) {
    metadata = null;
  }

  const [taxonomy, registry, feed] = await Promise.all([
    fetchJson(iuInfoDataUrl("taxonomy.json")),
    fetchJson(iuInfoDataUrl("source_registry.json")),
    fetchJson(iuInfoDataUrl("feed.json")),
  ]);

  let laneItems = null;
  const laneIds = Array.isArray(o.lanes) ? o.lanes.map(String) : [];
  if (laneIds.length && manifest) {
    const parts = await Promise.all(
      laneIds.map((id) => fetchJson(iuInfoDataUrl(`lanes/${id}.json`)).catch(() => null))
    );
    laneItems = [];
    for (const part of parts) {
      if (part && Array.isArray(part.items)) laneItems.push(...part.items);
    }
  }

  const effectiveFeed =
    laneItems && laneItems.length
      ? Object.assign({}, feed, { items: laneItems, itemCount: laneItems.length, fromLanes: laneIds })
      : feed;

  return {
    taxonomy,
    registry,
    metadata,
    manifest,
    feed: effectiveFeed,
    loadedAt: new Date().toISOString(),
  };
}

function defaultPrefs() {
  return {
    sections: [],
    eventTypes: [],
    sourceGroups: [],
    sourceIds: [],
    orgTypes: [],
    lanes: [],
    connectorTypes: [],
    statuses: [],
    regionLevels: [],
    institutions: [],
    favoriteSourceIds: [],
    favoriteLanes: [],
    favoriteRegions: [],
    favoriteInstitutions: [],
    localityQuery: "",
    localities: [],
    sortMode: "nejdulezitejsi",
    timeRangeHours: 0,
    importanceMin: 0,
    activeOnly: false,
    newOnly: false,
    unreadOnly: false,
    savedOnly: false,
    favoritesOnly: false,
  };
}

function getPrefs() {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (!raw) return defaultPrefs();
    const merged = Object.assign(defaultPrefs(), JSON.parse(raw) || {});
    merged.sections = asStringArray(merged.sections);
    merged.eventTypes = asStringArray(merged.eventTypes);
    merged.sourceGroups = asStringArray(merged.sourceGroups);
    merged.sourceIds = asStringArray(merged.sourceIds);
    merged.orgTypes = asStringArray(merged.orgTypes);
    merged.lanes = asStringArray(merged.lanes);
    merged.connectorTypes = asStringArray(merged.connectorTypes);
    merged.statuses = asStringArray(merged.statuses);
    merged.regionLevels = asStringArray(merged.regionLevels);
    merged.institutions = asStringArray(merged.institutions);
    merged.favoriteSourceIds = asStringArray(merged.favoriteSourceIds);
    merged.favoriteLanes = asStringArray(merged.favoriteLanes);
    merged.favoriteRegions = asStringArray(merged.favoriteRegions);
    merged.favoriteInstitutions = asStringArray(merged.favoriteInstitutions);
    merged.timeRangeHours = Number(merged.timeRangeHours) || 0;
    merged.importanceMin = Number(merged.importanceMin) || 0;
    return merged;
  } catch (_) {
    return defaultPrefs();
  }
}

function setPrefs(prefs) {
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify(Object.assign(defaultPrefs(), prefs || {})));
  } catch (_) {}
}

function markRead(id) {
  const s = readJsonSet(LS_READ);
  s.add(String(id));
  writeJsonSet(LS_READ, s);
}

function toggleSaved(id) {
  const s = readJsonSet(LS_SAVED);
  const k = String(id);
  if (s.has(k)) s.delete(k);
  else s.add(k);
  writeJsonSet(LS_SAVED, s);
  return s.has(k);
}

function hideItem(id) {
  const s = readJsonSet(LS_HIDDEN);
  s.add(String(id));
  writeJsonSet(LS_HIDDEN, s);
}

function isRead(id) {
  return readJsonSet(LS_READ).has(String(id));
}

function isSaved(id) {
  return readJsonSet(LS_SAVED).has(String(id));
}

function isHidden(id) {
  return readJsonSet(LS_HIDDEN).has(String(id));
}

function toggleFavoriteInPrefs(prefs, key, id) {
  const next = Object.assign(defaultPrefs(), prefs || {});
  const set = new Set(asStringArray(next[key]));
  const k = String(id || "");
  if (!k) return next;
  if (set.has(k)) set.delete(k);
  else set.add(k);
  next[key] = Array.from(set);
  return next;
}

function localitySuggest(query, localities) {
  const q = String(query || "").trim().toLowerCase();
  if (!q || q.length < 2) return [];
  const list = Array.isArray(localities) ? localities : [];
  const out = [];
  for (const loc of list) {
    const name = String(loc && (loc.name || loc.label || loc) ? loc.name || loc.label || loc : "").toLowerCase();
    if (!name) continue;
    if (name.includes(q)) {
      out.push(typeof loc === "string" ? { name: loc } : loc);
      if (out.length >= 8) break;
    }
  }
  return out;
}

function institutionOf(ev) {
  return String((ev && (ev.sourceName || ev.sourceLabel || ev.institution || "")) || "");
}

function isActiveEvent(ev) {
  const st = String((ev && ev.status) || "").toLowerCase();
  const et = String((ev && ev.eventType) || "").toLowerCase();
  if (st === "ukoncene" || et === "ukoncene") return false;
  return (
    st === "aktivni" ||
    st === "prave-probihajici" ||
    et === "aktivni" ||
    et === "prave-probihajici" ||
    et === "mimoradne" ||
    et === "aktualni"
  );
}

function isNewEvent(ev, hours) {
  const h = Number(hours) > 0 ? Number(hours) : 24;
  const t = Date.parse((ev && (ev.firstSeenByInfoUzel || eventSortAt(ev))) || 0) || 0;
  if (!t) return false;
  return Date.now() - t <= h * 3600000;
}

function favoriteBoost(ev, f) {
  let b = 0;
  if (!ev || !f) return 0;
  if (f.favoriteSourceIds && f.favoriteSourceIds.length && f.favoriteSourceIds.includes(String(ev.sourceId))) {
    b += 120;
  }
  if (f.favoriteLanes && f.favoriteLanes.length && f.favoriteLanes.includes(String(ev.lane || ""))) {
    b += 70;
  }
  const regionName = String((ev.region && ev.region.name) || "");
  if (f.favoriteRegions && f.favoriteRegions.length && regionName) {
    const rn = regionName.toLowerCase();
    if (f.favoriteRegions.some((r) => rn.includes(String(r).toLowerCase()))) b += 50;
  }
  const inst = institutionOf(ev).toLowerCase();
  if (f.favoriteInstitutions && f.favoriteInstitutions.length && inst) {
    if (f.favoriteInstitutions.some((x) => inst.includes(String(x).toLowerCase()))) b += 40;
  }
  return b;
}

function dedupeCluster(events) {
  const map = new Map();
  for (const ev of events || []) {
    if (!ev) continue;
    const key = String(ev.groupKey || ev.id || "");
    if (!key) continue;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        primary: ev,
        members: [ev],
        links: [{ label: ev.sourceLabel || "Zdroj", url: ev.url }],
      });
      continue;
    }
    prev.members.push(ev);
    if (ev.url) prev.links.push({ label: ev.sourceLabel || "Zdroj", url: ev.url });
    const pi = Number(prev.primary.importance || 0);
    const ei = Number(ev.importance || 0);
    const pt = Date.parse(eventSortAt(prev.primary) || prev.primary.updatedAt || 0) || 0;
    const et = Date.parse(eventSortAt(ev) || ev.updatedAt || 0) || 0;
    if (ei > pi || (ei === pi && et > pt)) prev.primary = ev;
  }
  return Array.from(map.values()).map((c) =>
    Object.assign({}, c.primary, {
      _clusterSize: c.members.length,
      _clusterLinks: c.links,
      _memberIds: c.members.map((m) => m.id),
    })
  );
}

/**
 * Fast filter pipeline: Set membership only, single pass, then cluster + sort.
 * Prepared for growth beyond hundreds of items without redesign.
 */
function filterEvents(events, filters) {
  const f = Object.assign(defaultPrefs(), filters || {});
  const hidden = readJsonSet(LS_HIDDEN);
  const read = readJsonSet(LS_READ);
  const saved = readJsonSet(LS_SAVED);

  const secSet = f.sections && f.sections.length ? new Set(f.sections.map(String)) : null;
  const typeSet = f.eventTypes && f.eventTypes.length ? new Set(f.eventTypes.map(String)) : null;
  const statusSet = f.statuses && f.statuses.length ? new Set(f.statuses.map(String)) : null;
  const groupSet = f.sourceGroups && f.sourceGroups.length ? new Set(f.sourceGroups.map(String)) : null;
  const sourceSet = f.sourceIds && f.sourceIds.length ? new Set(f.sourceIds.map(String)) : null;
  const orgSet = f.orgTypes && f.orgTypes.length ? new Set(f.orgTypes.map(String)) : null;
  const laneSet = f.lanes && f.lanes.length ? new Set(f.lanes.map(String)) : null;
  const connSet = f.connectorTypes && f.connectorTypes.length ? new Set(f.connectorTypes.map(String)) : null;
  const levelSet = f.regionLevels && f.regionLevels.length ? new Set(f.regionLevels.map(String)) : null;
  const instSet = f.institutions && f.institutions.length ? new Set(f.institutions.map((x) => String(x).toLowerCase())) : null;
  const favSrc = f.favoriteSourceIds && f.favoriteSourceIds.length ? new Set(f.favoriteSourceIds.map(String)) : null;
  const favLane = f.favoriteLanes && f.favoriteLanes.length ? new Set(f.favoriteLanes.map(String)) : null;
  const favReg = f.favoriteRegions && f.favoriteRegions.length ? f.favoriteRegions.map((x) => String(x).toLowerCase()) : null;
  const favInst = f.favoriteInstitutions && f.favoriteInstitutions.length ? f.favoriteInstitutions.map((x) => String(x).toLowerCase()) : null;

  const locQ = String(f.localityQuery || "").trim().toLowerCase();
  const locNames =
    f.localities && f.localities.length ? f.localities.map((x) => String(x.name || x).toLowerCase()) : null;
  const rangeMs = Number(f.timeRangeHours) > 0 ? Number(f.timeRangeHours) * 3600000 : 0;
  const now = Date.now();
  const importanceMin = Number(f.importanceMin) || 0;

  let list = [];
  for (const ev of events || []) {
    if (!ev || hidden.has(String(ev.id))) continue;
    if (secSet && !secSet.has(String(ev.sectionId))) continue;
    if (typeSet && !typeSet.has(String(ev.eventType)) && !typeSet.has(String(ev.status))) continue;
    if (statusSet && !statusSet.has(String(ev.status))) continue;
    if (groupSet && !groupSet.has(String(ev.sourceGroup || ""))) continue;
    if (sourceSet && !sourceSet.has(String(ev.sourceId))) continue;
    if (orgSet && !orgSet.has(String(ev.orgType || ""))) continue;
    if (laneSet && !laneSet.has(String(ev.lane || ""))) continue;
    if (connSet && !connSet.has(String(ev.connectorType || ""))) continue;
    if (levelSet && !levelSet.has(String((ev.region && ev.region.level) || "cr"))) continue;
    if (instSet) {
      const inst = institutionOf(ev).toLowerCase();
      if (![...instSet].some((x) => inst.includes(x) || x.includes(inst))) continue;
    }
    if (locQ) {
      const name = String((ev.region && ev.region.name) || "").toLowerCase();
      const level = String((ev.region && ev.region.level) || "").toLowerCase();
      if (!(name.includes(locQ) || level === locQ || locQ === "čr" || locQ === "cr")) continue;
    }
    if (locNames) {
      const name = String((ev.region && ev.region.name) || "").toLowerCase();
      const ok = !name
        ? locNames.some((n) => n === "čr" || n === "cr" || n === "cesko")
        : locNames.some((n) => name.includes(n) || n.includes(name));
      if (!ok) continue;
    }
    if (rangeMs) {
      const t = Date.parse(eventSortAt(ev) || 0) || 0;
      if (!t || now - t > rangeMs) continue;
    }
    if (importanceMin && Number(ev.importance || 0) < importanceMin) continue;
    if (f.activeOnly && !isActiveEvent(ev)) continue;
    if (f.newOnly && !isNewEvent(ev, 24)) continue;
    if (f.unreadOnly && read.has(String(ev.id))) continue;
    if (f.savedOnly && !saved.has(String(ev.id))) continue;
    if (f.favoritesOnly) {
      const regionName = String((ev.region && ev.region.name) || "").toLowerCase();
      const inst = institutionOf(ev).toLowerCase();
      const hit =
        (favSrc && favSrc.has(String(ev.sourceId))) ||
        (favLane && favLane.has(String(ev.lane || ""))) ||
        (favReg && favReg.some((r) => regionName.includes(r))) ||
        (favInst && favInst.some((x) => inst.includes(x)));
      if (!hit) continue;
    }
    list.push(ev);
  }

  const clustered = dedupeCluster(list);
  const mode = String(f.sortMode || "nejdulezitejsi");
  clustered.sort((a, b) => {
    if (mode === "oblibene" || mode === "nejdulezitejsi") {
      const db = favoriteBoost(b, f) - favoriteBoost(a, f);
      if (db) return db;
    }
    if (mode === "nejnovejsi") {
      return (Date.parse(eventSortAt(b) || 0) || 0) - (Date.parse(eventSortAt(a) || 0) || 0);
    }
    if (mode === "posledni-aktualizace") {
      return (
        (Date.parse(b.lastUpdatedBySource || b.updatedAt || eventSortAt(b) || 0) || 0) -
        (Date.parse(a.lastUpdatedBySource || a.updatedAt || eventSortAt(a) || 0) || 0)
      );
    }
    if (mode === "nejvetsi-dopad") {
      return Number(b.impact || 0) - Number(a.impact || 0);
    }
    if (mode === "nejblizsi-region") {
      const rank = (ev) => {
        const lv = String((ev.region && ev.region.level) || "cr");
        if (lv === "obec" || lv === "mesto") return 0;
        if (lv === "okres") return 1;
        if (lv === "kraj") return 2;
        return 3;
      };
      return rank(a) - rank(b);
    }
    if (mode === "oblibene") {
      return (Date.parse(eventSortAt(b) || 0) || 0) - (Date.parse(eventSortAt(a) || 0) || 0);
    }
    const di = Number(b.importance || 0) - Number(a.importance || 0);
    if (di) return di;
    return (Date.parse(eventSortAt(b) || 0) || 0) - (Date.parse(eventSortAt(a) || 0) || 0);
  });
  return clustered;
}

function applyCutoverDom() {
  const cutover = isCutoverEnabled();
  try {
    document.documentElement.classList.toggle("iu-info-system-cutover", cutover);
    document.documentElement.classList.toggle("iu-info-system-parallel", isParallelMode());
  } catch (_) {}
  return cutover;
}

const IUInfoSystem = {
  version: IU_INFO_SYSTEM_VERSION,
  isCutoverEnabled,
  isParallelMode,
  applyCutoverDom,
  loadInfoSystemData,
  filterEvents,
  dedupeCluster,
  localitySuggest,
  getPrefs,
  setPrefs,
  markRead,
  toggleSaved,
  hideItem,
  isRead,
  isSaved,
  isHidden,
  toggleFavoriteInPrefs,
  favoriteBoost,
  iuInfoDataUrl,
  eventSortAt,
};

try {
  window.IUInfoSystem = IUInfoSystem;
} catch (_) {}

export {
  IU_INFO_SYSTEM_VERSION,
  IUInfoSystem,
  isCutoverEnabled,
  isParallelMode,
  applyCutoverDom,
  loadInfoSystemData,
  filterEvents,
  dedupeCluster,
  localitySuggest,
  getPrefs,
  setPrefs,
  markRead,
  toggleSaved,
  hideItem,
  isRead,
  isSaved,
  isHidden,
  toggleFavoriteInPrefs,
  favoriteBoost,
  eventSortAt,
};

export default IUInfoSystem;

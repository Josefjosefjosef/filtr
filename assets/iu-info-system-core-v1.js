/**
 * InfoUzel.cz — shared info-system data layer (Přehled dne v1)
 * Displays only: time, title, real source, place, status, importance, origin URL.
 * Never images, perex, or article body.
 */
const IU_INFO_SYSTEM_VERSION = "1.0.0";
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

async function loadInfoSystemData() {
  const [taxonomy, registry, feed] = await Promise.all([
    fetchJson(iuInfoDataUrl("taxonomy.json")),
    fetchJson(iuInfoDataUrl("source_registry.json")),
    fetchJson(iuInfoDataUrl("feed.json")),
  ]);
  return { taxonomy, registry, feed, loadedAt: new Date().toISOString() };
}

function defaultPrefs() {
  return {
    sections: [],
    eventTypes: [],
    sourceGroups: [],
    sourceIds: [],
    statuses: [],
    localityQuery: "",
    localities: [],
    sortMode: "nejdulezitejsi",
    unreadOnly: false,
    savedOnly: false,
  };
}

function getPrefs() {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (!raw) return defaultPrefs();
    return Object.assign(defaultPrefs(), JSON.parse(raw) || {});
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
    const pt = Date.parse(prev.primary.updatedAt || prev.primary.publishedAt || 0) || 0;
    const et = Date.parse(ev.updatedAt || ev.publishedAt || 0) || 0;
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

function filterEvents(events, filters) {
  const f = Object.assign(defaultPrefs(), filters || {});
  const hidden = readJsonSet(LS_HIDDEN);
  const read = readJsonSet(LS_READ);
  const saved = readJsonSet(LS_SAVED);
  let list = (events || []).filter((ev) => ev && !hidden.has(String(ev.id)));

  if (f.sections && f.sections.length) {
    const set = new Set(f.sections.map(String));
    list = list.filter((ev) => set.has(String(ev.sectionId)));
  }
  if (f.eventTypes && f.eventTypes.length) {
    const set = new Set(f.eventTypes.map(String));
    list = list.filter((ev) => set.has(String(ev.eventType)) || set.has(String(ev.status)));
  }
  if (f.statuses && f.statuses.length) {
    const set = new Set(f.statuses.map(String));
    list = list.filter((ev) => set.has(String(ev.status)));
  }
  if (f.sourceGroups && f.sourceGroups.length) {
    const set = new Set(f.sourceGroups.map(String));
    list = list.filter((ev) => set.has(String(ev.sourceGroup || "")));
  }
  if (f.sourceIds && f.sourceIds.length) {
    const set = new Set(f.sourceIds.map(String));
    list = list.filter((ev) => set.has(String(ev.sourceId)));
  }
  const locQ = String(f.localityQuery || "").trim().toLowerCase();
  if (locQ) {
    list = list.filter((ev) => {
      const name = String((ev.region && ev.region.name) || "").toLowerCase();
      const level = String((ev.region && ev.region.level) || "").toLowerCase();
      return name.includes(locQ) || level === locQ || locQ === "čr" || locQ === "cr";
    });
  }
  if (f.localities && f.localities.length) {
    const names = f.localities.map((x) => String(x.name || x).toLowerCase());
    list = list.filter((ev) => {
      const name = String((ev.region && ev.region.name) || "").toLowerCase();
      if (!name) return names.some((n) => n === "čr" || n === "cr" || n === "cesko");
      return names.some((n) => name.includes(n) || n.includes(name));
    });
  }
  if (f.unreadOnly) list = list.filter((ev) => !read.has(String(ev.id)));
  if (f.savedOnly) list = list.filter((ev) => saved.has(String(ev.id)));

  const clustered = dedupeCluster(list);
  const mode = String(f.sortMode || "nejdulezitejsi");
  clustered.sort((a, b) => {
    if (mode === "nejnovejsi") {
      return (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0);
    }
    if (mode === "posledni-aktualizace") {
      return (Date.parse(b.updatedAt || b.publishedAt || 0) || 0) - (Date.parse(a.updatedAt || a.publishedAt || 0) || 0);
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
    const di = Number(b.importance || 0) - Number(a.importance || 0);
    if (di) return di;
    return (Date.parse(b.updatedAt || b.publishedAt || 0) || 0) - (Date.parse(a.updatedAt || a.publishedAt || 0) || 0);
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
  iuInfoDataUrl,
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
};

export default IUInfoSystem;

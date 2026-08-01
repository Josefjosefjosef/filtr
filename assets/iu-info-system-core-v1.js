/**
 * InfoUzel.cz — shared info-system data layer (Přehled dne v5 UI slim)
 * Backend prepares datasets; frontend is local-first and never fetches source sites.
 * V4 data model kept; V5 forces chronological feed + prefs/views migration.
 */
const IU_INFO_SYSTEM_VERSION = "5.0.0";
const LS_SCHEMA_VERSION = 6;
const LS_SCHEMA = "iu.infoEvents.schema.v1";
const LS_READ = "iu.infoEvents.read.v1";
const LS_SAVED = "iu.infoEvents.saved.v1";
const LS_HIDDEN = "iu.infoEvents.hidden.v1";
const LS_PREFS = "iu.infoEvents.prefs.v1";
const LS_VIEWS = "iu.infoEvents.views.v1";
const LS_ALERTS = "iu.infoEvents.alerts.v1";
const LS_ALERT_STATE = "iu.infoEvents.alertState.v1";
const LS_SCROLL = "iu.infoEvents.scroll.v1";
const LS_VIEW_BASELINE = "iu.infoEvents.viewBaseline.v1";

const _timeCache = new Map();
const _filterMemo = { key: "", result: null, index: null, itemsRef: null };

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

function readJsonObj(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJsonObj(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj || {}));
  } catch (_) {}
}

function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map(String).filter(Boolean);
}

function parseTime(iso) {
  const k = String(iso || "");
  if (!k) return 0;
  if (_timeCache.has(k)) return _timeCache.get(k);
  const t = Date.parse(k) || 0;
  if (_timeCache.size > 8000) _timeCache.clear();
  _timeCache.set(k, t);
  return t;
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

  const laneIds = Array.isArray(o.lanes) ? o.lanes.map(String) : [];
  const wantLanesOnly = laneIds.length > 0 && manifest;

  const jobs = [
    fetchJson(iuInfoDataUrl("taxonomy.json")),
    fetchJson(iuInfoDataUrl("source_registry.json")),
  ];
  if (!wantLanesOnly) jobs.push(fetchJson(iuInfoDataUrl("feed.json")));

  const settled = await Promise.all(jobs);
  const taxonomy = settled[0];
  const registry = settled[1];
  let feed = wantLanesOnly ? { items: [], itemCount: 0 } : settled[2];

  if (wantLanesOnly) {
    const parts = await Promise.all(
      laneIds.map((id) => fetchJson(iuInfoDataUrl(`lanes/${id}.json`)).catch(() => null))
    );
    const laneItems = [];
    for (const part of parts) {
      if (part && Array.isArray(part.items)) laneItems.push(...part.items);
    }
    feed = Object.assign({}, feed, { items: laneItems, itemCount: laneItems.length, fromLanes: laneIds });
  }

  return {
    taxonomy,
    registry,
    metadata,
    manifest,
    feed,
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
    homeKraj: "",
    homeOkres: "",
    homeObec: "",
    regionalDoprava: false,
    regionalKrize: false,
    regionalZdravi: false,
    myRegionOnly: false,
    localityQuery: "",
    localities: [],
    searchQuery: "",
    sortMode: "nejnovejsi",
    timeRangeHours: 0,
    importanceMin: 0,
    activeOnly: false,
    newOnly: false,
    unreadOnly: false,
    savedOnly: false,
    favoritesOnly: false,
    activeViewId: "",
  };
}

/** Strip UI-removed filter dimensions; keep backend/alert fields out of user prefs. */
function sanitizeUserPrefs(raw) {
  const merged = Object.assign(defaultPrefs(), raw || {});
  merged.sections = asStringArray(merged.sections);
  // Event-type / lifecycle filters removed from user UI (Krok 13)
  merged.eventTypes = [];
  merged.statuses = [];
  merged.sourceGroups = asStringArray(merged.sourceGroups);
  merged.sourceIds = asStringArray(merged.sourceIds);
  merged.orgTypes = asStringArray(merged.orgTypes);
  merged.lanes = asStringArray(merged.lanes);
  merged.connectorTypes = asStringArray(merged.connectorTypes);
  merged.regionLevels = asStringArray(merged.regionLevels);
  merged.institutions = asStringArray(merged.institutions);
  merged.favoriteSourceIds = asStringArray(merged.favoriteSourceIds);
  merged.favoriteLanes = asStringArray(merged.favoriteLanes);
  merged.favoriteRegions = asStringArray(merged.favoriteRegions);
  merged.favoriteInstitutions = asStringArray(merged.favoriteInstitutions);
  merged.homeKraj = String(merged.homeKraj || "");
  merged.homeOkres = String(merged.homeOkres || "");
  merged.homeObec = String(merged.homeObec || "");
  merged.searchQuery = String(merged.searchQuery || "");
  merged.activeViewId = String(merged.activeViewId || "");
  // Feed window is server-side 96h; no user time-range control
  merged.timeRangeHours = 0;
  merged.importanceMin = Number(merged.importanceMin) || 0;
  merged.regionalDoprava = !!merged.regionalDoprava;
  merged.regionalKrize = !!merged.regionalKrize;
  merged.regionalZdravi = !!merged.regionalZdravi;
  merged.myRegionOnly = !!merged.myRegionOnly;
  merged.activeOnly = false;
  merged.newOnly = false;
  merged.unreadOnly = !!merged.unreadOnly;
  merged.savedOnly = !!merged.savedOnly;
  merged.favoritesOnly = !!merged.favoritesOnly;
  // Always chronological (Krok 14)
  merged.sortMode = "nejnovejsi";
  if (!Array.isArray(merged.localities)) merged.localities = [];
  merged.localityQuery = String(merged.localityQuery || "");
  return merged;
}

function normalizePrefs(raw) {
  return sanitizeUserPrefs(raw);
}

function readSchemaVersion() {
  try {
    return Number(localStorage.getItem(LS_SCHEMA) || 0) || 0;
  } catch (_) {
    return 0;
  }
}

function writeSchemaVersion(v) {
  try {
    localStorage.setItem(LS_SCHEMA, String(v));
  } catch (_) {}
}

/** Idempotent local prefs migration (V4/V5 → V6 clean concept). Preserves read/saved/hidden/scroll. */
const LS_CHMI_V2_MIG = "iu.infoEvents.chmiCapV2.mig.v1";
const LS_CHMI_V2_BACKUP = "iu.infoEvents.chmiCapV2.backup.v1";

/**
 * Map legacy ie-chmi-* states onto ie-chmi-v2-* when feed contains capV2 items.
 * Certain matches only; ambiguous kept on legacy ids. Reversible via backup key.
 */
/**
 * Continuous migration: when feed items declare capV2.supersedesIds (canonical
 * onset-split id replaced a stale warm id), remap saved/hidden/read prefs.
 * Does not revive user-hidden cards — only rewrites ids that already exist in prefs.
 */
function migrateChmiSupersedesIds(events) {
  const items = Array.isArray(events) ? events : [];
  const pairs = [];
  for (const e of items) {
    if (!e || !e.capV2 || !String(e.id || "").startsWith("ie-chmi-v2-")) continue;
    const olds = Array.isArray(e.capV2.supersedesIds) ? e.capV2.supersedesIds : [];
    for (const oldId of olds) {
      if (oldId && String(oldId) !== String(e.id)) pairs.push([String(oldId), String(e.id)]);
    }
  }
  if (!pairs.length) return { migrated: false, reason: "no_supersedes" };
  try {
    const read = readJsonSet(LS_READ);
    const saved = readJsonSet(LS_SAVED);
    const hidden = readJsonSet(LS_HIDDEN);
    let changed = 0;
    for (const [from, to] of pairs) {
      for (const set of [read, saved, hidden]) {
        if (set.has(from)) {
          set.delete(from);
          set.add(to);
          changed += 1;
        }
      }
    }
    if (!changed) return { migrated: false, reason: "no_matching_prefs", pairs: pairs.length };
    writeJsonSet(LS_READ, read);
    writeJsonSet(LS_SAVED, saved);
    writeJsonSet(LS_HIDDEN, hidden);
    return { migrated: true, changed, pairs: pairs.length };
  } catch (_) {
    return { migrated: false, reason: "storage_error" };
  }
}

function migrateChmiCapV2UserStates(events) {
  const items = Array.isArray(events) ? events : [];
  // Always apply supersedes remaps when present (independent of one-shot v1 mig).
  migrateChmiSupersedesIds(items);
  const v2 = items.filter((e) => e && e.capV2 && String(e.id || "").startsWith("ie-chmi-v2-"));
  if (!v2.length) return { migrated: false, reason: "no_v2_items" };
  try {
    if (localStorage.getItem(LS_CHMI_V2_MIG) === "done") return { migrated: false, reason: "already" };
  } catch (_) {}

  const read = readJsonSet(LS_READ);
  const saved = readJsonSet(LS_SAVED);
  const hidden = readJsonSet(LS_HIDDEN);
  const legacyIds = [...read, ...saved, ...hidden].filter((id) => String(id).startsWith("ie-chmi-") && !String(id).startsWith("ie-chmi-v2-"));
  if (!legacyIds.length) {
    try {
      localStorage.setItem(LS_CHMI_V2_MIG, "done");
    } catch (_) {}
    return { migrated: false, reason: "no_legacy_states" };
  }

  const byLegacyTitle = new Map();
  for (const e of items) {
    if (!e || !String(e.id || "").startsWith("ie-chmi-") || String(e.id).startsWith("ie-chmi-v2-")) continue;
    byLegacyTitle.set(String(e.id), e);
  }

  function fold(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  const audit = [];
  const backup = {
    read: [...read],
    saved: [...saved],
    hidden: [...hidden],
    at: new Date().toISOString(),
  };

  function mapOne(id, set) {
    const legacy = byLegacyTitle.get(id);
    if (!legacy) return;
    const lt = fold(legacy.title);
    const lr = fold(legacy.region && legacy.region.name);
    const candidates = v2.filter((v) => {
      const vt = fold(v.title);
      const vr = fold(v.region && v.region.name);
      return (lt && vt && (vt.includes(lt.slice(0, 40)) || lt.includes(vt.slice(0, 40)))) || (lr && vr && (vr.includes(lr) || lr.includes(vr)));
    });
    if (candidates.length === 1) {
      set.delete(id);
      set.add(String(candidates[0].id));
      audit.push({ from: id, to: candidates[0].id, confidence: "certain" });
    } else {
      audit.push({ from: id, to: null, confidence: candidates.length ? "ambiguous" : "none" });
    }
  }

  for (const id of legacyIds) {
    if (read.has(id)) mapOne(id, read);
    if (saved.has(id)) mapOne(id, saved);
    if (hidden.has(id)) mapOne(id, hidden);
  }

  // unread resets for significant capV2 updates
  for (const e of v2) {
    if (e.capV2 && e.capV2.significantUnreadReset && read.has(String(e.id))) {
      read.delete(String(e.id));
      audit.push({ from: e.id, to: null, confidence: "unread_reset" });
    }
  }

  try {
    localStorage.setItem(LS_CHMI_V2_BACKUP, JSON.stringify(backup));
    writeJsonSet(LS_READ, read);
    writeJsonSet(LS_SAVED, saved);
    writeJsonSet(LS_HIDDEN, hidden);
    localStorage.setItem(LS_CHMI_V2_MIG, "done");
  } catch (_) {
    return { migrated: false, reason: "storage_error", audit };
  }
  return { migrated: true, audit, backup: true };
}

function rollbackChmiCapV2UserStates() {
  try {
    const raw = localStorage.getItem(LS_CHMI_V2_BACKUP);
    if (!raw) return { ok: false, reason: "no_backup" };
    const b = JSON.parse(raw);
    writeJsonSet(LS_READ, new Set(b.read || []));
    writeJsonSet(LS_SAVED, new Set(b.saved || []));
    writeJsonSet(LS_HIDDEN, new Set(b.hidden || []));
    localStorage.removeItem(LS_CHMI_V2_MIG);
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: "rollback_error" };
  }
}

function migrateLocalStateOnce() {
  const ver = readSchemaVersion();
  if (ver >= LS_SCHEMA_VERSION) return { migrated: false, from: ver, to: ver };
  try {
    const rawPrefs = localStorage.getItem(LS_PREFS);
    if (rawPrefs) {
      const cleaned = sanitizeUserPrefs(JSON.parse(rawPrefs) || {});
      // V6: display toggles are session-only — never persist unread/saved feed modes
      cleaned.unreadOnly = false;
      cleaned.savedOnly = false;
      localStorage.setItem(LS_PREFS, JSON.stringify(cleaned));
    }
    const store = readJsonObj(LS_VIEWS, { views: [] });
    const views = Array.isArray(store.views) ? store.views : [];
    const nextViews = views.map((v) =>
      Object.assign({}, v, {
        prefs: sanitizeUserPrefs(v.prefs || {}),
      })
    );
    writeJsonObj(LS_VIEWS, { views: nextViews, updatedAt: new Date().toISOString(), schemaVersion: LS_SCHEMA_VERSION });
    writeSchemaVersion(LS_SCHEMA_VERSION);
    return { migrated: true, from: ver, to: LS_SCHEMA_VERSION };
  } catch (_) {
    writeSchemaVersion(LS_SCHEMA_VERSION);
    return { migrated: false, from: ver, to: LS_SCHEMA_VERSION, error: true };
  }
}

function getPrefs() {
  migrateLocalStateOnce();
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (!raw) return defaultPrefs();
    return normalizePrefs(JSON.parse(raw) || {});
  } catch (_) {
    return defaultPrefs();
  }
}

function filterFingerprint(prefs) {
  const f = normalizePrefs(prefs || {});
  return JSON.stringify({
    sections: f.sections,
    lanes: f.lanes,
    sourceGroups: f.sourceGroups,
    sourceIds: f.sourceIds,
    orgTypes: f.orgTypes,
    institutions: f.institutions,
    regionLevels: f.regionLevels,
    localities: f.localities,
    localityQuery: f.localityQuery,
    homeKraj: f.homeKraj,
    homeOkres: f.homeOkres,
    homeObec: f.homeObec,
    myRegionOnly: f.myRegionOnly,
    unreadOnly: f.unreadOnly,
    savedOnly: f.savedOnly,
    favoritesOnly: f.favoritesOnly,
    searchQuery: f.searchQuery,
  });
}

function getViewBaseline() {
  try {
    return normalizePrefs(JSON.parse(localStorage.getItem(LS_VIEW_BASELINE) || "null") || {});
  } catch (_) {
    return defaultPrefs();
  }
}

function setViewBaseline(prefs) {
  try {
    localStorage.setItem(LS_VIEW_BASELINE, JSON.stringify(normalizePrefs(prefs || {})));
  } catch (_) {}
}

/**
 * Count temporary filters beyond the active saved-view baseline.
 * Quick toggles unread/saved count when they differ from baseline.
 */
function countTemporaryFilters(prefs, baseline) {
  const p = normalizePrefs(prefs || {});
  const b = normalizePrefs(baseline || getViewBaseline());
  let n = 0;
  const arrDiff = (a, c) => {
    const aa = asStringArray(a).slice().sort().join("\0");
    const bb = asStringArray(c).slice().sort().join("\0");
    return aa !== bb;
  };
  if (arrDiff(p.sections, b.sections)) n += 1;
  if (arrDiff(p.lanes, b.lanes)) n += 1;
  if (arrDiff(p.sourceGroups, b.sourceGroups)) n += 1;
  if (arrDiff(p.sourceIds, b.sourceIds)) n += 1;
  if (arrDiff(p.orgTypes, b.orgTypes)) n += 1;
  if (arrDiff(p.institutions, b.institutions)) n += 1;
  if (arrDiff(p.regionLevels, b.regionLevels)) n += 1;
  const locA = JSON.stringify(p.localities || []) + "|" + String(p.localityQuery || "");
  const locB = JSON.stringify(b.localities || []) + "|" + String(b.localityQuery || "");
  if (locA !== locB) n += 1;
  if (String(p.homeKraj) !== String(b.homeKraj) || String(p.homeOkres) !== String(b.homeOkres) || String(p.homeObec) !== String(b.homeObec)) {
    n += 1;
  }
  if (!!p.myRegionOnly !== !!b.myRegionOnly) n += 1;
  if (!!p.unreadOnly !== !!b.unreadOnly) n += 1;
  if (!!p.savedOnly !== !!b.savedOnly) n += 1;
  if (!!p.favoritesOnly !== !!b.favoritesOnly) n += 1;
  if (String(p.searchQuery || "") !== String(b.searchQuery || "")) n += 1;
  return n;
}

function setPrefs(prefs) {
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify(normalizePrefs(prefs || {})));
    return true;
  } catch (_) {
    return false;
  }
}

function prefsFingerprint(f) {
  try {
    return JSON.stringify(normalizePrefs(f));
  } catch (_) {
    return String(Date.now());
  }
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

function unhideItem(id) {
  const s = readJsonSet(LS_HIDDEN);
  s.delete(String(id));
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
  const next = normalizePrefs(prefs || {});
  const set = new Set(asStringArray(next[key]));
  const k = String(id || "");
  if (!k) return next;
  if (set.has(k)) set.delete(k);
  else set.add(k);
  next[key] = Array.from(set);
  return next;
}

function builtinViews() {
  return [
    { id: "muj-prehled", label: "Můj přehled", builtin: true, prefs: {} },
    { id: "doprava", label: "Doprava", builtin: true, prefs: { sections: ["doprava"] } },
    { id: "muj-kraj", label: "Můj region", builtin: true, prefs: { myRegionOnly: true } },
    { id: "ministerstva", label: "Ministerstva", builtin: true, prefs: { lanes: ["ministerstva"] } },
    { id: "bezpecnost", label: "Bezpečnost", builtin: true, prefs: { sections: ["bezpecnost"] } },
    { id: "pocasi", label: "Počasí", builtin: true, prefs: { sections: ["pocasi"] } },
    { id: "ekonomika", label: "Ekonomika", builtin: true, prefs: { lanes: ["ekonomika"] } },
    { id: "prace", label: "Práce", builtin: true, prefs: { sections: ["stat"], orgTypes: ["government", "agency"] } },
    { id: "skolstvi", label: "Školství", builtin: true, prefs: { sections: ["veda"] } },
    { id: "zdravi", label: "Zdraví", builtin: true, prefs: { sections: ["zdravi"] } },
  ];
}

function listViews() {
  migrateLocalStateOnce();
  const custom = readJsonObj(LS_VIEWS, { views: [] });
  const customs = Array.isArray(custom.views) ? custom.views : [];
  return builtinViews().concat(
    customs.map((v) => ({
      id: String(v.id),
      label: String(v.label || v.id),
      builtin: false,
      prefs: normalizePrefs(v.prefs || {}),
    }))
  );
}

function saveView(label, prefs) {
  const name = String(label || "").trim().slice(0, 48);
  if (!name) return null;
  const store = readJsonObj(LS_VIEWS, { views: [] });
  const views = Array.isArray(store.views) ? store.views : [];
  const id = "custom-" + Date.now().toString(36);
  const entry = { id, label: name, prefs: normalizePrefs(prefs || getPrefs()), savedAt: new Date().toISOString() };
  views.push(entry);
  if (views.length > 24) views.splice(0, views.length - 24);
  writeJsonObj(LS_VIEWS, { views, updatedAt: new Date().toISOString(), schemaVersion: LS_SCHEMA_VERSION });
  return entry;
}

/** Overwrite an existing custom view (conscious action). */
function updateView(viewId, prefs) {
  const k = String(viewId || "");
  if (!k || k.indexOf("custom-") !== 0) return null;
  const store = readJsonObj(LS_VIEWS, { views: [] });
  const views = Array.isArray(store.views) ? store.views : [];
  const idx = views.findIndex((v) => String(v.id) === k);
  if (idx < 0) return null;
  views[idx] = Object.assign({}, views[idx], {
    prefs: normalizePrefs(prefs || getPrefs()),
    savedAt: new Date().toISOString(),
  });
  writeJsonObj(LS_VIEWS, { views, updatedAt: new Date().toISOString(), schemaVersion: LS_SCHEMA_VERSION });
  return views[idx];
}

function deleteView(id) {
  const k = String(id || "");
  if (!k || k.indexOf("custom-") !== 0) return false;
  const store = readJsonObj(LS_VIEWS, { views: [] });
  const views = (Array.isArray(store.views) ? store.views : []).filter((v) => String(v.id) !== k);
  writeJsonObj(LS_VIEWS, { views, updatedAt: new Date().toISOString(), schemaVersion: LS_SCHEMA_VERSION });
  return true;
}

function applyView(viewId, basePrefs) {
  const views = listViews();
  const view = views.find((v) => String(v.id) === String(viewId));
  if (!view) return normalizePrefs(basePrefs || getPrefs());
  const base = defaultPrefs();
  const home = normalizePrefs(basePrefs || getPrefs());
  // Keep home region settings when applying thematic views
  const next = normalizePrefs(Object.assign({}, base, view.prefs || {}, {
    homeKraj: home.homeKraj,
    homeOkres: home.homeOkres,
    homeObec: home.homeObec,
    favoriteRegions: home.favoriteRegions,
    favoriteSourceIds: home.favoriteSourceIds,
    favoriteLanes: home.favoriteLanes,
    favoriteInstitutions: home.favoriteInstitutions,
    activeViewId: view.id,
  }));
  if (view.id === "muj-kraj" && home.homeKraj) {
    next.localityQuery = home.homeKraj;
    next.localities = [{ name: home.homeKraj, level: "kraj" }];
    next.myRegionOnly = true;
  }
  if (view.id === "muj-prehled") {
    const muj = normalizePrefs(Object.assign({}, home, { activeViewId: view.id }));
    setViewBaseline(muj);
    return muj;
  }
  setViewBaseline(next);
  return next;
}

function defaultAlertConfig() {
  return {
    version: 1,
    enabled: false,
    pushServer: false,
    rules: [
      { id: "chmi-vystrahy", label: "Výstrahy ČHMÚ / počasí", enabled: false, lanes: ["pocasi"], eventTypes: ["mimoradne"], importanceMin: 4 },
      { id: "doprava-mimo", label: "Dopravní mimořádnosti", enabled: false, lanes: ["doprava"], eventTypes: ["mimoradne", "prave-probihajici"] },
      { id: "krize", label: "Krizové informace", enabled: false, lanes: ["bezpecnost"], eventTypes: ["mimoradne"], importanceMin: 4 },
      { id: "ministerstva", label: "Vybraná ministerstva", enabled: false, lanes: ["ministerstva"], sourceIds: [] },
      { id: "kraj", label: "Vybraný kraj", enabled: false, matchHomeRegion: true, regionLevels: ["kraj", "okres", "mesto", "obec"] },
      { id: "oblibene-zdroje", label: "Oblíbené zdroje", enabled: false, useFavoriteSources: true },
    ],
  };
}

function getAlertConfig() {
  return Object.assign(defaultAlertConfig(), readJsonObj(LS_ALERTS, {}));
}

function setAlertConfig(cfg) {
  writeJsonObj(LS_ALERTS, Object.assign(defaultAlertConfig(), cfg || {}));
}

function getAlertState() {
  return readJsonObj(LS_ALERT_STATE, { seenIds: [], lastEvalAt: null, pending: [] });
}

function setAlertState(state) {
  writeJsonObj(LS_ALERT_STATE, state || { seenIds: [], lastEvalAt: null, pending: [] });
}

function getScrollState() {
  return readJsonObj(LS_SCROLL, { viewId: "", y: 0 });
}

function setScrollState(state) {
  writeJsonObj(LS_SCROLL, state || { viewId: "", y: 0 });
}

function regionNeedlesFromPrefs(f) {
  const out = [];
  for (const x of [f.homeKraj, f.homeOkres, f.homeObec]) {
    if (x && String(x).trim()) out.push(String(x).trim().toLowerCase());
  }
  for (const r of f.favoriteRegions || []) {
    if (r) out.push(String(r).toLowerCase());
  }
  for (const loc of f.localities || []) {
    const n = String((loc && (loc.name || loc)) || "").toLowerCase();
    if (n) out.push(n);
  }
  if (f.localityQuery) out.push(String(f.localityQuery).toLowerCase());
  return Array.from(new Set(out.filter(Boolean)));
}

function regionMatches(ev, needles) {
  if (!needles || !needles.length) return true;
  const r = ev && ev.region ? ev.region : null;
  const parts = [];
  if (r) {
    if (r.name) parts.push(String(r.name));
    if (r.summary) parts.push(String(r.summary));
    if (r.orpName) parts.push(String(r.orpName));
    if (r.okresName) parts.push(String(r.okresName));
    if (r.krajName) parts.push(String(r.krajName));
    if (Array.isArray(r.orpNames)) parts.push(...r.orpNames.map(String));
    if (Array.isArray(r.okresNames)) parts.push(...r.okresNames.map(String));
    if (Array.isArray(r.krajNames)) parts.push(...r.krajNames.map(String));
    if (Array.isArray(r.areaDescs)) parts.push(...r.areaDescs.map(String));
    if (Array.isArray(r.orpIds)) parts.push(...r.orpIds.map(String));
    if (Array.isArray(r.orpCodes)) parts.push(...r.orpCodes.map(String));
    if (Array.isArray(r.krajIds)) parts.push(...r.krajIds.map(String));
  }
  const capSearch = ev && ev.capV2 && ev.capV2.searchText ? String(ev.capV2.searchText) : "";
  if (capSearch) parts.push(capSearch);
  const hay = parts.join(" ").toLowerCase();
  if (!hay) return needles.some((n) => n === "čr" || n === "cr" || n === "cesko");
  return needles.some((n) => {
    const nn = String(n || "").toLowerCase();
    if (!nn) return false;
    if (hay.includes(nn)) return true;
    return parts.some((p) => {
      const pp = String(p).toLowerCase();
      return pp.includes(nn) || nn.includes(pp);
    });
  });
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
      if (out.length >= 10) break;
    }
  }
  return out;
}

/** Diacritic-insensitive compare for locality names. */
function foldLocName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function locNamesEqual(a, b) {
  const aa = foldLocName(a);
  const bb = foldLocName(b);
  if (!aa || !bb) return false;
  return aa === bb || aa.includes(bb) || bb.includes(aa);
}

function uniqStableNames(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const name = String(raw || "").trim();
    if (!name) continue;
    const key = foldLocName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Parse active locality filter from prefs (cities / okres / kraj).
 * Does not mutate prefs.
 */
function parseActiveLocationFilter(filter) {
  const f = filter || {};
  const cities = [];
  const okresy = [];
  const kraje = [];
  for (const loc of f.localities || []) {
    if (!loc) continue;
    if (typeof loc === "string") {
      cities.push(loc);
      continue;
    }
    const name = String(loc.name || "").trim();
    if (!name) continue;
    const level = String(loc.level || "").toLowerCase();
    if (level === "kraj") kraje.push(name);
    else if (level === "okres") okresy.push(name);
    else cities.push(name);
  }
  if (f.homeObec) cities.push(String(f.homeObec));
  if (f.homeOkres) okresy.push(String(f.homeOkres));
  if (f.homeKraj) kraje.push(String(f.homeKraj));
  const query = String(f.localityQuery || "").trim();
  return {
    cities: uniqStableNames(cities),
    okresy: uniqStableNames(okresy),
    kraje: uniqStableNames(kraje),
    query,
  };
}

function isWholeCrLocationFilter(active) {
  return !active.cities.length && !active.okresy.length && !active.kraje.length && !active.query;
}

function warningGeoLinks(ev) {
  const links = ev && ev.capV2 && ev.capV2.geo && Array.isArray(ev.capV2.geo.links) ? ev.capV2.geo.links : [];
  return links.filter(Boolean);
}

function sortLinksByOrpName(links) {
  return (links || []).slice().sort((a, b) =>
    String((a && a.orpName) || "").localeCompare(String((b && b.orpName) || ""), "cs", { sensitivity: "base" })
  );
}

function linkMatchesNeedle(link, needle) {
  if (!link || !needle) return false;
  return (
    locNamesEqual(link.orpName, needle) ||
    locNamesEqual(link.okresName, needle) ||
    locNamesEqual(link.krajName, needle)
  );
}

function intersectWarningLinks(links, active) {
  if (isWholeCrLocationFilter(active)) return links.slice();
  return links.filter((link) => {
    if (active.cities.some((c) => locNamesEqual(link.orpName, c) || locNamesEqual(link.okresName, c))) return true;
    if (active.okresy.some((o) => locNamesEqual(link.okresName, o) || locNamesEqual(link.orpName, o))) return true;
    if (active.kraje.some((k) => locNamesEqual(link.krajName, k))) return true;
    if (active.query && linkMatchesNeedle(link, active.query)) return true;
    return false;
  });
}

/** Czech inflection for “N dalších oblastí” (public unit = unique ORP). */
function formatExtraAreasPhrase(extra) {
  const n = Number(extra) || 0;
  if (n <= 0) return "";
  if (n === 1) return "a 1 další oblast";
  if (n >= 2 && n <= 4) return "a " + n + " další oblasti";
  return "a dalších " + n + " oblastí";
}

function formatLocationLabel(primary, extra, style) {
  const name = String(primary || "").trim();
  if (!name) return "";
  const n = Number(extra) || 0;
  if (n <= 0) return name;
  // style reserved for callers; public phrase always uses Czech inflection.
  void style;
  return name + " " + formatExtraAreasPhrase(n);
}

function pickPrimaryLocalityName(links, active) {
  const sorted = sortLinksByOrpName(links);
  if (!sorted.length) return "";

  for (const city of active.cities || []) {
    const hit = sorted.find((l) => locNamesEqual(l.orpName, city));
    if (hit) return String(city);
  }
  for (const okres of active.okresy || []) {
    const center = sorted.find((l) => locNamesEqual(l.okresName, okres) && locNamesEqual(l.orpName, okres));
    if (center) return String(center.orpName || okres);
    const any = sorted.find((l) => locNamesEqual(l.okresName, okres));
    if (any) return String(any.orpName || okres);
  }
  for (const kraj of active.kraje || []) {
    const inKraj = sorted.filter((l) => locNamesEqual(l.krajName, kraj));
    if (inKraj.length) return String(inKraj[0].orpName || kraj);
  }
  if (active.query) {
    const qHit = sorted.find((l) => linkMatchesNeedle(l, active.query));
    if (qHit) {
      if (locNamesEqual(qHit.orpName, active.query)) return String(qHit.orpName);
      return String(qHit.orpName || active.query);
    }
  }
  return String(sorted[0].orpName || "");
}

/**
 * Display-only geographic label for a CAP warning card, derived from warning + active filter.
 * Never mutates the warning object. Empty string ⇒ no locality text (caller may hide meta pill).
 *
 * @param {object} warning feed event
 * @param {object} activeLocationFilter prefs / draft filter
 * @returns {string}
 */
function getFilteredWarningLocationLabel(warning, activeLocationFilter) {
  const region = warning && warning.region ? warning.region : null;
  const globalSummary =
    region && (region.summary || region.name) ? String(region.summary || region.name).trim() : "";
  const active = parseActiveLocationFilter(activeLocationFilter);

  if (isWholeCrLocationFilter(active)) return globalSummary;

  const links = warningGeoLinks(warning);
  if (!links.length) {
    // Non-CAP or incomplete geo: keep legacy summary (filter already gates visibility).
    return globalSummary;
  }

  const onlySingleCity =
    active.cities.length === 1 && !active.okresy.length && !active.kraje.length && !active.query;
  const onlyCities =
    active.cities.length > 0 && !active.okresy.length && !active.kraje.length && !active.query;

  if (onlySingleCity) {
    const city = active.cities[0];
    const hit = links.some((l) => locNamesEqual(l.orpName, city));
    if (!hit) return "";
    // Approved: city-first, remaining count may still reflect the whole warning.
    return formatLocationLabel(city, links.length - 1, "legacyMulti");
  }

  const scoped = intersectWarningLinks(links, active);
  if (!scoped.length) return "";

  const primary = pickPrimaryLocalityName(scoped, active);
  if (!primary) return "";
  return formatLocationLabel(primary, scoped.length - 1, onlyCities ? "legacyMulti" : "czech");
}

/**
 * Event title without baked-in global locality summary (display helper).
 * Does not mutate the event.
 */
function eventTitleBaseWithoutLocality(ev) {
  let raw = String((ev && ev.title) || "").trim();
  if (!raw) return "Bez názvu";
  raw = raw
    .replace(/^\s*V[ýy]straha\s+ČHM[ÚU]\s*[:\-–—]\s*/i, "")
    .replace(/^\s*V[ýy]straha\s+CHMU\s*[:\-–—]\s*/i, "")
    .trim();
  const region = ev && ev.region ? ev.region : null;
  const summary = region && region.summary ? String(region.summary).trim() : "";
  const name = region && region.name ? String(region.name).trim() : "";
  if (summary) {
    const needle = " — " + summary;
    if (raw.endsWith(needle)) raw = raw.slice(0, -needle.length).trim();
    else if (raw.includes(needle)) raw = raw.split(needle).join("").replace(/\s{2,}/g, " ").trim();
  }
  if (name && raw.endsWith(" — " + name)) raw = raw.slice(0, -(" — " + name).length).trim();
  return raw || "Bez názvu";
}

/** Europe/Prague calendar helpers for timeline rollover (display/sort only). */
const IU_PRAGUE_TZ = "Europe/Prague";

function pragueYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IU_PRAGUE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function startOfPragueDayMs(ms) {
  const ymd = pragueYmd(ms);
  let lo = Date.parse(ymd + "T00:00:00Z") - 14 * 3600000;
  let hi = Date.parse(ymd + "T00:00:00Z") + 14 * 3600000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (pragueYmd(mid) < ymd) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function nextPragueMidnightMs(ms) {
  const startToday = startOfPragueDayMs(ms);
  // Step into tomorrow afternoon then take that day's start.
  return startOfPragueDayMs(startToday + 36 * 3600000);
}

function formatPragueDayMonth(ms) {
  return new Date(ms).toLocaleDateString("cs-CZ", {
    timeZone: IU_PRAGUE_TZ,
    day: "numeric",
    month: "numeric",
  });
}

function formatPragueTime(ms) {
  return new Date(ms).toLocaleTimeString("cs-CZ", {
    timeZone: IU_PRAGUE_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isChmiCapWarning(ev) {
  if (!ev || !ev.capV2) return false;
  if (String(ev.sourceId || "") === "chmi") return true;
  return String(ev.id || "").indexOf("ie-chmi-v2-") === 0;
}

/**
 * Canonical CAP validFrom raw string — same priority as normalize-feed / identity:
 * event.validFrom (onset || effective || sent) → capV2.onset → capV2.effective.
 * Never invent a timestamp for UI or status.
 */
function canonicalChmiValidFromRaw(ev) {
  if (!ev) return "";
  const top = String(ev.validFrom || "").trim();
  if (top) return top;
  const onset = String((ev.capV2 && ev.capV2.onset) || "").trim();
  if (onset) return onset;
  const effective = String((ev.capV2 && ev.capV2.effective) || "").trim();
  if (effective) return effective;
  return "";
}

function canonicalChmiValidToRaw(ev) {
  if (!ev) return "";
  const top = String(ev.validTo || "").trim();
  if (top) return top;
  return String((ev.capV2 && ev.capV2.expires) || "").trim();
}

/** True when the CAP timestamp string includes a reliable clock time (not date-only). */
function chmiRawHasClockTime(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  if (/T\d{1,2}:\d{2}/.test(s)) return true;
  if (/\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(s)) return true;
  return false;
}

/**
 * Display parts for "platnost od" from the same canonical validFrom used for status.
 * Returns { date, time|null } or null when the start is missing / unreliable.
 */
function chmiValidFromDisplayParts(ev) {
  const raw = canonicalChmiValidFromRaw(ev);
  const ms = parseTime(raw);
  if (!ms || !raw) return null;
  const date = formatPragueDayMonth(ms);
  if (!date) return null;
  if (chmiRawHasClockTime(raw)) return { date, time: formatPragueTime(ms) };
  // Date-only ISO (YYYY-MM-DD) — show date, never invent a clock time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date, time: null };
  return null;
}

/**
 * Canonical public-feed lifecycle for a CHMI CAP warning.
 * ACTIVE | FUTURE | INACTIVE | CANCELLED | null (not CHMI).
 *
 * Same rules as pipeline classifyChmiTemporalState (validFrom/validTo/untilRevoked + Cancel).
 * Recomputes from times so a stale published feed still rolls over between syncs.
 *
 * ACTIVE:  validFrom <= now < validTo (or untilRevoked), not Cancel
 * FUTURE:  now < validFrom (with validTo or untilRevoked)
 * INACTIVE: expired / ended / truly missing bounds / nezaraditelne without open-ended
 * CANCELLED: Cancel msgType or status zruseno
 */
function getChmiWarningLifecycleStatus(ev, nowMs) {
  if (!isChmiCapWarning(ev)) return null;
  const status = String(ev.status || "").toLowerCase();
  const msgType = String((ev.capV2 && ev.capV2.msgType) || "");
  const temporalState = String((ev.capV2 && ev.capV2.temporalState) || "").toLowerCase();
  if (/^Cancel$/i.test(msgType) || status === "zruseno" || temporalState === "cancelled") {
    return "CANCELLED";
  }
  if (
    temporalState === "excluded" ||
    (ev.capV2 && ev.capV2.productExcluded) ||
    (ev.capV2 && String(ev.capV2.temporalReason || "") === "excluded_product_type")
  ) {
    return "INACTIVE";
  }

  const now = Number(nowMs) > 0 ? Number(nowMs) : Date.now();
  const validFrom = parseTime(canonicalChmiValidFromRaw(ev));
  const validToRaw = canonicalChmiValidToRaw(ev);
  const validTo = parseTime(validToRaw);
  const untilRevoked =
    ev.untilRevoked === true ||
    (ev.capV2 && ev.capV2.untilRevoked === true) ||
    (ev.capV2 && ev.capV2.openEnded === true) ||
    (!validToRaw && ev.untilRevoked !== false && !(ev.capV2 && ev.capV2.untilRevoked === false));

  if (!validFrom) {
    // Rare CAP edge: missing onset but concrete end still in the future → treat as already active.
    if (validTo && now < validTo) return "ACTIVE";
    return "INACTIVE";
  }
  if (!validTo && !untilRevoked) {
    if (status === "nezaraditelne" || temporalState === "invalid") return "INACTIVE";
    return "INACTIVE";
  }
  if (validTo && now >= validTo) return "INACTIVE";
  if (now < validFrom) return "FUTURE";
  return "ACTIVE";
}

/** True only while the CHMI warning is actually in force (green AKTIVNÍ badge). */
function isCurrentlyActiveChmiWarning(ev, nowMs) {
  return getChmiWarningLifecycleStatus(ev, nowMs) === "ACTIVE";
}

/** Public feed keeps currently active and already-published future CHMI warnings. */
function isPublicFeedChmiWarning(ev, nowMs) {
  const st = getChmiWarningLifecycleStatus(ev, nowMs);
  return st === "ACTIVE" || st === "FUTURE";
}

function publishedAtIso(ev) {
  return (
    (ev &&
      (ev.publishedAtSource ||
        ev.sortAt ||
        ev.firstSeenByInfoUzel ||
        ev.publishedAt ||
        ev.updatedAt ||
        "")) ||
    ""
  );
}

/**
 * Authoritative CAP revision label from msgType provenance (never calendar-date heuristics).
 * Alert → Vydáno; Update → Aktualizováno. Missing/unknown msgType → null (do not guess).
 */
function chmiCapRevisionIssuedWord(item) {
  const mt = String((item && item.capV2 && item.capV2.msgType) || "")
    .trim()
    .toLowerCase();
  if (mt === "update") return "Aktualizováno";
  if (mt === "alert") return "Vydáno";
  return null;
}

/**
 * Secondary issued/updated line: word from msgType + stamp from CAP sent (publishedAtSource).
 */
function formatChmiSecondaryIssuedLabel(item, whenMs, asDayMonth) {
  const word = chmiCapRevisionIssuedWord(item);
  if (!word || !(Number(whenMs) > 0)) return null;
  const stamp = asDayMonth ? formatPragueDayMonth(whenMs) : formatPragueTime(whenMs);
  if (!stamp) return null;
  return word + " " + stamp;
}

/**
 * Shared timeline presentation for feed cards (CHMI active-day rollover + AKTIVNÍ).
 * Does not mutate the item. timelineAt is sort-only; never write it onto the event.
 *
 * Public times for CAP cards:
 * - ACTIVE with onset/validFrom → primary axis = official validFrom (never ingest/deploy time).
 * - “Vydáno” / “Aktualizováno” = CAP sent/publishedAtSource of the head revision (msgType Alert vs Update).
 * - FUTURE → primary may show issued; secondary “Platí od” = validFrom (date+time).
 * - Never use fetchedAt / generatedAt / firstSeenByInfoUzel as the user-facing clock.
 *
 * @param {object} item
 * @param {number} [nowMs]
 */
function getEffectiveTimelinePresentation(item, nowMs) {
  const now = Number(nowMs) > 0 ? Number(nowMs) : Date.now();
  const publishedIso = publishedAtIso(item);
  const publishedMs = parseTime(publishedIso) || now;
  const lifecycleStatus = getChmiWarningLifecycleStatus(item, now);
  const isActiveWarning = lifecycleStatus === "ACTIVE";
  const isFutureWarning = lifecycleStatus === "FUTURE";
  const pubDay = pragueYmd(publishedMs);
  const today = pragueYmd(now);
  const isRolledActiveWarning = !!(isActiveWarning && pubDay < today);

  const validFromRaw = canonicalChmiValidFromRaw(item);
  const validFromMs = parseTime(validFromRaw);
  const hasOfficialValidFrom =
    !!(isChmiCapWarning(item) && validFromMs && chmiRawHasClockTime(validFromRaw));

  let timelineMs = publishedMs;
  if (isRolledActiveWarning) timelineMs = startOfPragueDayMs(now);
  else if (isActiveWarning && hasOfficialValidFrom) timelineMs = validFromMs;

  let primaryDate = formatPragueDayMonth(isRolledActiveWarning ? now : publishedMs);
  let primaryTime = null;
  let secondaryIssuedLabel = null;
  let secondaryValidFromLabel = null;
  let secondaryValidFromDate = null;
  let secondaryValidFromTime = null;

  if (isFutureWarning) {
    primaryTime = formatPragueTime(publishedMs);
    const parts = chmiValidFromDisplayParts(item);
    if (parts) {
      secondaryValidFromLabel = "Platí od";
      secondaryValidFromDate = parts.date;
      secondaryValidFromTime = parts.time;
    }
  } else if (isActiveWarning && hasOfficialValidFrom) {
    // Primary public clock = official onset / Platí od (e.g. 11:25, not CAP sent 11:29).
    primaryDate = formatPragueDayMonth(isRolledActiveWarning ? now : validFromMs);
    if (!isRolledActiveWarning) {
      primaryTime = formatPragueTime(validFromMs);
    }
    const issuedDiffers =
      !!publishedMs && Math.abs(publishedMs - validFromMs) >= 60 * 1000;
    if (isRolledActiveWarning) {
      secondaryIssuedLabel = formatChmiSecondaryIssuedLabel(item, publishedMs, true);
      const parts = chmiValidFromDisplayParts(item);
      if (parts) {
        secondaryValidFromLabel = "Platí od";
        secondaryValidFromDate = parts.date;
        secondaryValidFromTime = parts.time;
      }
    } else if (issuedDiffers) {
      secondaryIssuedLabel = formatChmiSecondaryIssuedLabel(item, publishedMs, false);
    }
  } else if (isRolledActiveWarning) {
    secondaryIssuedLabel = formatChmiSecondaryIssuedLabel(item, publishedMs, true);
  } else {
    primaryTime = formatPragueTime(publishedMs);
  }

  return {
    timelineAt: new Date(timelineMs).toISOString(),
    timelineMs,
    primaryDate,
    primaryTime,
    secondaryIssuedLabel,
    secondaryValidFromLabel,
    secondaryValidFromDate,
    secondaryValidFromTime,
    lifecycleStatus,
    isActiveWarning,
    isFutureWarning,
    isRolledActiveWarning,
    publishedAt: publishedIso,
  };
}

/**
 * Next boundary that requires a timeline/AKTIVNÍ recompute (midnight or validity edge).
 */
function nextTimelineBoundaryMs(items, nowMs) {
  const now = Number(nowMs) > 0 ? Number(nowMs) : Date.now();
  let next = nextPragueMidnightMs(now);
  for (const ev of items || []) {
    if (!isChmiCapWarning(ev)) continue;
    const vf = parseTime(canonicalChmiValidFromRaw(ev));
    const vt = parseTime(canonicalChmiValidToRaw(ev));
    if (vf > now && vf < next) next = vf;
    if (vt > now && vt < next) next = vt;
  }
  return next;
}

function clearInfoEventsFilterMemo() {
  _filterMemo.key = "";
  _filterMemo.result = null;
}

function compareTimelineItems(a, b, nowMs) {
  const pa = getEffectiveTimelinePresentation(a, nowMs);
  const pb = getEffectiveTimelinePresentation(b, nowMs);
  const diff = pb.timelineMs - pa.timelineMs;
  if (diff !== 0) return diff;
  const pubDiff = parseTime(publishedAtIso(b)) - parseTime(publishedAtIso(a));
  if (pubDiff !== 0) return pubDiff;
  return String((b && b.id) || "").localeCompare(String((a && a.id) || ""));
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
  const t = parseTime((ev && (ev.firstSeenByInfoUzel || eventSortAt(ev))) || 0);
  if (!t) return false;
  return Date.now() - t <= h * 3600000;
}

function favoriteBoost(ev, f) {
  let b = 0;
  if (!ev || !f) return 0;
  if (f.favoriteSourceIds && f.favoriteSourceIds.length && f.favoriteSourceIds.includes(String(ev.sourceId))) b += 120;
  if (f.favoriteLanes && f.favoriteLanes.length && f.favoriteLanes.includes(String(ev.lane || ""))) b += 70;
  const regionName = String((ev.region && ev.region.name) || "");
  if (f.favoriteRegions && f.favoriteRegions.length && regionName) {
    const rn = regionName.toLowerCase();
    if (f.favoriteRegions.some((r) => rn.includes(String(r).toLowerCase()))) b += 50;
  }
  const homeNeedles = regionNeedlesFromPrefs(f);
  if (homeNeedles.length && regionMatches(ev, homeNeedles)) b += 35;
  const inst = institutionOf(ev).toLowerCase();
  if (f.favoriteInstitutions && f.favoriteInstitutions.length && inst) {
    if (f.favoriteInstitutions.some((x) => inst.includes(String(x).toLowerCase()))) b += 40;
  }
  if (f.regionalDoprava && String(ev.lane) === "doprava" && regionMatches(ev, homeNeedles)) b += 25;
  if (f.regionalKrize && String(ev.lane) === "bezpecnost" && regionMatches(ev, homeNeedles)) b += 25;
  if (f.regionalZdravi && String(ev.lane) === "zdravotnictvi" && regionMatches(ev, homeNeedles)) b += 25;
  return b;
}

/** Build inverted indexes for O(candidates) filtering at thousands of items. */
function buildFeedIndex(events) {
  const byLane = new Map();
  const bySource = new Map();
  const byLevel = new Map();
  const byRegionToken = new Map();
  const all = [];
  for (const ev of events || []) {
    if (!ev) continue;
    all.push(ev);
    const lane = String(ev.lane || "ostatni");
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane).push(ev);
    const sid = String(ev.sourceId || "");
    if (sid) {
      if (!bySource.has(sid)) bySource.set(sid, []);
      bySource.get(sid).push(ev);
    }
    const level = String((ev.region && ev.region.level) || "cr");
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(ev);
    const name = String((ev.region && ev.region.name) || "").toLowerCase();
    if (name) {
      const token = name.split(/\s+/)[0];
      if (token) {
        if (!byRegionToken.has(token)) byRegionToken.set(token, []);
        byRegionToken.get(token).push(ev);
      }
    }
  }
  return { byLane, bySource, byLevel, byRegionToken, all, size: all.length };
}

function pickCandidates(index, f) {
  if (!index) return null;
  let best = null;
  if (f.lanes && f.lanes.length) {
    const parts = [];
    for (const id of f.lanes) {
      const arr = index.byLane.get(String(id));
      if (arr) parts.push(...arr);
    }
    best = parts;
  }
  if (f.sourceIds && f.sourceIds.length) {
    const parts = [];
    for (const id of f.sourceIds) {
      const arr = index.bySource.get(String(id));
      if (arr) parts.push(...arr);
    }
    if (!best || parts.length < best.length) best = parts;
  }
  if (f.regionLevels && f.regionLevels.length) {
    const parts = [];
    for (const id of f.regionLevels) {
      const arr = index.byLevel.get(String(id));
      if (arr) parts.push(...arr);
    }
    if (!best || parts.length < best.length) best = parts;
  }
  return best;
}

function dedupeCluster(events) {
  const map = new Map();
  for (const ev of events || []) {
    if (!ev) continue;
    // CHMI CAP v2: each territorial/time segment is a distinct public card.
    // Never collapse by shared event-day groupKey (that key is for multi-source news only).
    const key =
      ev.capV2 || String(ev.sourceId || "") === "chmi"
        ? String(ev.id || ev.canonicalUrl || "")
        : String(ev.groupKey || ev.id || "");
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
    const pt = parseTime(eventSortAt(prev.primary) || prev.primary.updatedAt || 0);
    const et = parseTime(eventSortAt(ev) || ev.updatedAt || 0);
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
 * Fast filter: optional index candidate set + single pass + cluster + sort.
 * Memoized by prefs fingerprint + items reference for repeat paints.
 */
function filterEvents(events, filters, opts) {
  const o = opts || {};
  const f = normalizePrefs(filters || {});
  const items = events || [];
  const now = Number(o.nowMs) > 0 ? Number(o.nowMs) : Date.now();
  const memoKey =
    prefsFingerprint(f) +
    "|" +
    items.length +
    "|" +
    (o.generationId || "") +
    "|" +
    String(o.hiddenMode || "exclude") +
    "|" +
    pragueYmd(now);
  if (!o.skipMemo && _filterMemo.itemsRef === items && _filterMemo.key === memoKey && _filterMemo.result) {
    return _filterMemo.result;
  }

  let index = o.index || null;
  if (!index && _filterMemo.itemsRef === items && _filterMemo.index) index = _filterMemo.index;
  if (!index && items.length >= 400) index = buildFeedIndex(items);

  const hidden = o.hiddenSet || readJsonSet(LS_HIDDEN);
  const read = o.readSet || readJsonSet(LS_READ);
  const saved = o.savedSet || readJsonSet(LS_SAVED);

  const secSet = f.sections.length ? new Set(f.sections) : null;
  const typeSet = f.eventTypes.length ? new Set(f.eventTypes) : null;
  const statusSet = f.statuses.length ? new Set(f.statuses) : null;
  const groupSet = f.sourceGroups.length ? new Set(f.sourceGroups) : null;
  const sourceSet = f.sourceIds.length ? new Set(f.sourceIds) : null;
  const orgSet = f.orgTypes.length ? new Set(f.orgTypes) : null;
  const laneSet = f.lanes.length ? new Set(f.lanes) : null;
  const connSet = f.connectorTypes.length ? new Set(f.connectorTypes) : null;
  const levelSet = f.regionLevels.length ? new Set(f.regionLevels) : null;
  const instNeedles = f.institutions.length ? f.institutions.map((x) => String(x).toLowerCase()) : null;
  const favSrc = f.favoriteSourceIds.length ? new Set(f.favoriteSourceIds) : null;
  const favLane = f.favoriteLanes.length ? new Set(f.favoriteLanes) : null;
  const favReg = f.favoriteRegions.length ? f.favoriteRegions.map((x) => String(x).toLowerCase()) : null;
  const favInst = f.favoriteInstitutions.length ? f.favoriteInstitutions.map((x) => String(x).toLowerCase()) : null;
  const homeNeedles = regionNeedlesFromPrefs(f);
  const searchQ = String(f.searchQuery || "").trim().toLowerCase();
  const rangeMs = Number(f.timeRangeHours) > 0 ? Number(f.timeRangeHours) * 3600000 : 0;
  const importanceMin = Number(f.importanceMin) || 0;

  const candidates = pickCandidates(index, f) || items;
  const seen = new Set();
  const list = [];
  for (const ev of candidates) {
    if (!ev) continue;
    const id = String(ev.id || "");
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const hiddenMode = String(o.hiddenMode || "exclude");
    if (hiddenMode === "only") {
      if (!hidden.has(id)) continue;
    } else if (hiddenMode !== "include") {
      if (hidden.has(id)) continue;
    }
    if (groupSet && !groupSet.has(String(ev.sourceGroup || ""))) {
      const pubs = ev.sourcePublications || [];
      if (!pubs.some((p) => groupSet.has(String(p.sourceGroup || "")))) continue;
    }
    if (sourceSet && !sourceSet.has(String(ev.sourceId))) {
      const pubs = ev.sourcePublications || [];
      if (!pubs.some((p) => sourceSet.has(String(p.sourceId)))) continue;
    }
    if (secSet && !secSet.has(String(ev.sectionId))) {
      const ids = (ev.sectionIds || []).map(String);
      const lane = String(ev.lane || "");
      if (!ids.some((id) => secSet.has(id)) && !secSet.has(lane)) continue;
    }
    if (typeSet && !typeSet.has(String(ev.eventType)) && !typeSet.has(String(ev.status))) continue;
    if (statusSet && !statusSet.has(String(ev.status))) continue;
    if (orgSet && !orgSet.has(String(ev.orgType || ""))) continue;
    if (laneSet && !laneSet.has(String(ev.lane || ""))) continue;
    if (connSet && !connSet.has(String(ev.connectorType || ""))) continue;
    if (levelSet && !levelSet.has(String((ev.region && ev.region.level) || "cr"))) continue;
    if (instNeedles) {
      const inst = institutionOf(ev).toLowerCase();
      if (!instNeedles.some((x) => inst.includes(x) || x.includes(inst))) continue;
    }
    if (f.myRegionOnly && homeNeedles.length && !regionMatches(ev, homeNeedles)) continue;
    if (f.localityQuery || (f.localities && f.localities.length)) {
      const needles = regionNeedlesFromPrefs(f);
      if (needles.length && !regionMatches(ev, needles)) continue;
    }
    // Public feed: active + published-future CHMI CAP warnings (no ended/Cancel/expired).
    if (isChmiCapWarning(ev) && !isPublicFeedChmiWarning(ev, now)) continue;
    if (rangeMs) {
      const t = parseTime(eventSortAt(ev));
      if (!t || now - t > rangeMs) continue;
    }
    // Client-side 96h safety (mirrors backend isInActiveFeedWindow) for stale published feeds
    {
      const maxAgeMs = 96 * 3600000;
      const validTo = parseTime(ev.validTo);
      const validFrom = parseTime(ev.validFrom);
      const status = String(ev.status || "").toLowerCase();
      const lifecycleOk =
        (validTo && validTo >= now && status !== "ukoncene" && status !== "archivovano" && status !== "nezaraditelne") ||
        (status === "prave-probihajici" && validFrom && validFrom <= now && (!validTo || validTo >= now)) ||
        (status === "aktivni" && validTo && validTo >= now) ||
        (status === "naplanovano" && validTo && validTo >= now) ||
        status === "planovane";
      const pubT = parseTime(ev.publishedAtSource || (ev.timeConfidence !== "fallback" ? ev.publishedAt : null));
      if (!lifecycleOk) {
        if (!pubT) continue;
        if (now - pubT > maxAgeMs) continue;
        if (pubT - now > 48 * 3600000) continue;
      }
    }
    if (importanceMin && Number(ev.importance || 0) < importanceMin) continue;
    if (f.activeOnly && !isActiveEvent(ev)) continue;
    if (f.newOnly && !isNewEvent(ev, 24)) continue;
    if (f.unreadOnly && read.has(id)) continue;
    if (f.savedOnly && !saved.has(id)) continue;
    if (f.favoritesOnly) {
      const regionName = String((ev.region && ev.region.name) || "").toLowerCase();
      const inst = institutionOf(ev).toLowerCase();
      const hit =
        (favSrc && favSrc.has(String(ev.sourceId))) ||
        (favLane && favLane.has(String(ev.lane || ""))) ||
        (favReg && favReg.some((r) => regionName.includes(r))) ||
        (favInst && favInst.some((x) => inst.includes(x))) ||
        (homeNeedles.length && regionMatches(ev, homeNeedles));
      if (!hit) continue;
    }
    if (f.regionalDoprava || f.regionalKrize || f.regionalZdravi) {
      // soft preference handled in boost; optional hard lane when myRegionOnly already set
    }
    if (searchQ) {
      const hay = (
        String(ev.title || "") +
        " " +
        String(ev.sourceLabel || "") +
        " " +
        String((ev.region && ev.region.name) || "") +
        " " +
        String((ev.region && ev.region.krajName) || "") +
        " " +
        String((ev.region && ev.region.okresName) || "") +
        " " +
        String((ev.region && ev.region.orpName) || "") +
        " " +
        String(ev.lane || "") +
        " " +
        String((ev.capV2 && ev.capV2.searchText) || "")
      ).toLowerCase();
      if (!hay.includes(searchQ)) continue;
    }
    list.push(ev);
  }

  const clustered = dedupeCluster(list);
  // Chronological by effective timelineAt (active CHMI warnings may roll to Prague day start).
  clustered.sort((a, b) => compareTimelineItems(a, b, now));

  _filterMemo.key = memoKey;
  _filterMemo.result = clustered;
  _filterMemo.itemsRef = items;
  _filterMemo.index = index;
  return clustered;
}

/**
 * Local alerts evaluator — no server push. Returns newly matched items for enabled rules.
 */
function evaluateLocalAlerts(events, prefs, config, state) {
  const cfg = Object.assign(defaultAlertConfig(), config || {});
  const st = Object.assign({ seenIds: [], pending: [], lastEvalAt: null }, state || {});
  if (!cfg.enabled) return { pending: st.pending || [], state: st, newCount: 0 };
  const seen = new Set((st.seenIds || []).map(String));
  const homeNeedles = regionNeedlesFromPrefs(normalizePrefs(prefs || {}));
  const favSources = new Set(asStringArray((prefs && prefs.favoriteSourceIds) || []));
  const pending = Array.isArray(st.pending) ? st.pending.slice() : [];
  const pendingIds = new Set(pending.map((p) => String(p.itemId)));
  let newCount = 0;

  for (const rule of cfg.rules || []) {
    if (!rule || !rule.enabled) continue;
    for (const ev of events || []) {
      if (!ev || seen.has(String(ev.id)) || pendingIds.has(String(ev.id))) continue;
      // Never alert on historical backfill / fallback-time imports
      if (ev.isHistoricalBackfill || ev.timeConfidence === "fallback" || !ev.publishedAtSource) continue;
      if (ev.isNewCapture === false) continue;
      if (rule.lanes && rule.lanes.length && !rule.lanes.includes(String(ev.lane || ""))) continue;
      if (rule.eventTypes && rule.eventTypes.length) {
        const et = String(ev.eventType || "");
        const stt = String(ev.status || "");
        if (!rule.eventTypes.includes(et) && !rule.eventTypes.includes(stt)) continue;
      }
      if (rule.importanceMin && Number(ev.importance || 0) < Number(rule.importanceMin)) continue;
      if (rule.sourceIds && rule.sourceIds.length && !rule.sourceIds.includes(String(ev.sourceId))) continue;
      if (rule.useFavoriteSources && favSources.size && !favSources.has(String(ev.sourceId))) continue;
      if (rule.matchHomeRegion && homeNeedles.length && !regionMatches(ev, homeNeedles)) continue;
      if (rule.regionLevels && rule.regionLevels.length) {
        const lv = String((ev.region && ev.region.level) || "cr");
        if (!rule.regionLevels.includes(lv) && lv !== "cr") {
          // allow CR-wide crisis items
          if (!(String(ev.eventType) === "mimoradne")) continue;
        }
      }
      const hit = {
        ruleId: rule.id,
        ruleLabel: rule.label || rule.id,
        itemId: String(ev.id),
        title: String(ev.title || ""),
        sourceId: String(ev.sourceId || ""),
        lane: String(ev.lane || ""),
        url: String(ev.url || ""),
        at: eventSortAt(ev) || new Date().toISOString(),
      };
      pending.push(hit);
      pendingIds.add(String(ev.id));
      newCount += 1;
      if (pending.length > 80) pending.shift();
    }
  }

  const nextState = {
    seenIds: Array.from(seen).slice(-500),
    pending: pending.slice(-80),
    lastEvalAt: new Date().toISOString(),
  };
  return { pending: nextState.pending, state: nextState, newCount };
}

function dismissAlert(itemId) {
  const st = getAlertState();
  const id = String(itemId || "");
  st.pending = (st.pending || []).filter((p) => String(p.itemId) !== id);
  const seen = new Set((st.seenIds || []).map(String));
  if (id) seen.add(id);
  st.seenIds = Array.from(seen).slice(-500);
  setAlertState(st);
  return st;
}

function dismissAllAlerts() {
  const st = getAlertState();
  const seen = new Set((st.seenIds || []).map(String));
  for (const p of st.pending || []) seen.add(String(p.itemId));
  st.seenIds = Array.from(seen).slice(-500);
  st.pending = [];
  setAlertState(st);
  return st;
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
  buildFeedIndex,
  dedupeCluster,
  localitySuggest,
  getFilteredWarningLocationLabel,
  eventTitleBaseWithoutLocality,
  parseActiveLocationFilter,
  getEffectiveTimelinePresentation,
  getChmiWarningLifecycleStatus,
  isCurrentlyActiveChmiWarning,
  isPublicFeedChmiWarning,
  nextTimelineBoundaryMs,
  clearInfoEventsFilterMemo,
  startOfPragueDayMs,
  pragueYmd,
  getPrefs,
  setPrefs,
  markRead,
  toggleSaved,
  hideItem,
  unhideItem,
  isRead,
  isSaved,
  isHidden,
  toggleFavoriteInPrefs,
  favoriteBoost,
  listViews,
  saveView,
  updateView,
  deleteView,
  applyView,
  builtinViews,
  migrateLocalStateOnce,
  migrateChmiCapV2UserStates,
  rollbackChmiCapV2UserStates,
  getViewBaseline,
  setViewBaseline,
  countTemporaryFilters,
  filterFingerprint,
  sanitizeUserPrefs,
  getAlertConfig,
  setAlertConfig,
  getAlertState,
  setAlertState,
  evaluateLocalAlerts,
  dismissAlert,
  dismissAllAlerts,
  getScrollState,
  setScrollState,
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
  buildFeedIndex,
  dedupeCluster,
  localitySuggest,
  getFilteredWarningLocationLabel,
  eventTitleBaseWithoutLocality,
  parseActiveLocationFilter,
  getEffectiveTimelinePresentation,
  getChmiWarningLifecycleStatus,
  isCurrentlyActiveChmiWarning,
  isPublicFeedChmiWarning,
  nextTimelineBoundaryMs,
  clearInfoEventsFilterMemo,
  startOfPragueDayMs,
  pragueYmd,
  getPrefs,
  setPrefs,
  markRead,
  toggleSaved,
  hideItem,
  unhideItem,
  isRead,
  isSaved,
  isHidden,
  toggleFavoriteInPrefs,
  favoriteBoost,
  listViews,
  saveView,
  updateView,
  deleteView,
  applyView,
  migrateLocalStateOnce,
  migrateChmiCapV2UserStates,
  rollbackChmiCapV2UserStates,
  getViewBaseline,
  setViewBaseline,
  countTemporaryFilters,
  filterFingerprint,
  sanitizeUserPrefs,
  getAlertConfig,
  setAlertConfig,
  getAlertState,
  setAlertState,
  evaluateLocalAlerts,
  dismissAlert,
  dismissAllAlerts,
  getScrollState,
  setScrollState,
  iuInfoDataUrl,
  eventSortAt,
};

export default IUInfoSystem;

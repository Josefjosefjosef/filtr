/**
 * Client-only article delivery store (session scope).
 * Isolated from aggregation / publishable_pool / Data Bot — reads already-published chunks only.
 */

export const IU_CLIENT_ARTICLE_INITIAL_LIMIT = 100;
export const IU_CLIENT_ARTICLE_LOAD_MORE_SIZE = 100;

/** @typedef {{ urlOrder: string[], loadedCount: number }} IuClientSectionSlot */

const PREHLED_DNE_KEY = "prehled-dne";
const LOADABLE_SECTION_KEYS = Object.freeze([
  "zpravy",
  "sport",
  "finance",
  "zdravi",
  "cestovani",
  "hry",
  "kultura",
  "veda",
  "vzdelavani",
]);

const _store = {
  articlesByUrl: new Map(),
  sections: new Map(),
};

function _articleKey(it) {
  const u = String(it && it.url ? it.url : "").trim();
  if (u) return u;
  const t = String(it && it.title ? it.title : "");
  const p = String(it && it.publishedAt ? it.publishedAt : "");
  return "h:" + t + "|" + p;
}

export function iuClientArticleStoreIsPrehledDneKey(sectionKey) {
  return String(sectionKey || "").trim().toLowerCase() === PREHLED_DNE_KEY;
}

export function iuClientArticleStoreLoadableSectionKeys() {
  return LOADABLE_SECTION_KEYS;
}

export function iuClientArticleStoreReset() {
  _store.articlesByUrl.clear();
  _store.sections.clear();
}

export function iuClientArticleStoreRegisterSectionArticles(sectionKey, incoming) {
  const key = String(sectionKey || "").trim().toLowerCase();
  if (!key || iuClientArticleStoreIsPrehledDneKey(key)) return 0;
  let slot = _store.sections.get(key);
  if (!slot) {
    slot = { urlOrder: [], loadedCount: 0, loader: null };
    _store.sections.set(key, slot);
  }
  let added = 0;
  for (const it of incoming || []) {
    if (!it || typeof it !== "object") continue;
    const id = _articleKey(it);
    if (!_store.articlesByUrl.has(id)) {
      _store.articlesByUrl.set(id, it);
      added += 1;
    }
    if (!slot.urlOrder.includes(id)) slot.urlOrder.push(id);
  }
  slot.loadedCount = slot.urlOrder.length;
  return added;
}

export function iuClientArticleStoreGetSectionArticles(sectionKey) {
  const key = String(sectionKey || "").trim().toLowerCase();
  const slot = _store.sections.get(key);
  if (!slot) return [];
  return slot.urlOrder.map((id) => _store.articlesByUrl.get(id)).filter(Boolean);
}

export function iuClientArticleStoreGetLoader(sectionKey) {
  const key = String(sectionKey || "").trim().toLowerCase();
  const slot = _store.sections.get(key);
  return slot && slot.loader ? slot.loader : null;
}

export function iuClientArticleStoreSetLoader(sectionKey, loader) {
  const key = String(sectionKey || "").trim().toLowerCase();
  if (!key || iuClientArticleStoreIsPrehledDneKey(key)) return;
  let slot = _store.sections.get(key);
  if (!slot) {
    slot = { urlOrder: [], loadedCount: 0, loader: null };
    _store.sections.set(key, slot);
  }
  slot.loader = loader || null;
}

export function iuClientArticleStoreHasSection(sectionKey) {
  const key = String(sectionKey || "").trim().toLowerCase();
  const slot = _store.sections.get(key);
  return !!(slot && slot.urlOrder.length);
}

export function iuClientArticleStoreBuildPrehledDne() {
  const seen = new Set();
  const merged = [];
  for (const sec of LOADABLE_SECTION_KEYS) {
    const slot = _store.sections.get(sec);
    if (!slot) continue;
    for (const id of slot.urlOrder) {
      if (seen.has(id)) continue;
      const it = _store.articlesByUrl.get(id);
      if (!it) continue;
      seen.add(id);
      merged.push(it);
    }
  }
  merged.sort(
    (a, b) =>
      (Date.parse(String(b.publishedAt || "")) || 0) - (Date.parse(String(a.publishedAt || "")) || 0),
  );
  return merged;
}

export function iuClientArticleStoreStats() {
  return {
    canonicalArticles: _store.articlesByUrl.size,
    sectionsLoaded: _store.sections.size,
    sectionCounts: Object.fromEntries(
      [..._store.sections.entries()].map(([k, v]) => [k, v.urlOrder.length]),
    ),
  };
}

export function iuClientArticleStoreIsPrehledDneNav() {
  try {
    if (typeof document !== "undefined" && document.body && document.body.classList.contains("iu-home")) {
      return false;
    }
    const p = new URLSearchParams(String(typeof location !== "undefined" ? location.search : ""));
    let sec = String(p.get("section") || "feed").trim().toLowerCase();
    if (sec === "media") sec = "feed";
    if (sec !== "feed" && sec !== "media") return false;
    let topic = String(p.get("topic") || "").trim().toLowerCase();
    if (topic === "tech" || topic === "bydleni") topic = "all";
    return !topic || topic === "all";
  } catch (_) {
    return false;
  }
}

try {
  if (typeof window !== "undefined") {
    window.__iuClientArticleStore = {
      reset: iuClientArticleStoreReset,
      stats: iuClientArticleStoreStats,
      buildPrehledDne: iuClientArticleStoreBuildPrehledDne,
    };
  }
} catch (_) {}

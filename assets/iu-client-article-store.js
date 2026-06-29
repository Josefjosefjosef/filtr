/**
 * infoUzel.cz — in-memory canonical article store (P0 task 66)
 *
 * One URL → one article object. Section loaders register slices; Prehled dne reads a virtual view.
 * Session-scoped: reset on full loadData / new visit (no cross-session accumulation).
 */

import { CLIENT_PREHLED_DNE_VIRTUAL_SECTION_KEY } from "./iu-client-article-config.js";

const _canonicalByUrl = new Map();
const _sectionOrder = new Map();

function urlKey(item) {
  return String(item && item.url ? item.url : "").trim();
}

export function iuClientArticleStoreReset() {
  _canonicalByUrl.clear();
  _sectionOrder.clear();
}

export function iuClientArticleStoreIngest(sectionKey, articles) {
  const key = String(sectionKey || "").trim() || "feed";
  const ordered = [];
  for (const raw of articles || []) {
    if (!raw || typeof raw !== "object") continue;
    const u = urlKey(raw);
    if (!u) {
      ordered.push(raw);
      continue;
    }
    let canon = _canonicalByUrl.get(u);
    if (!canon) {
      canon = raw;
      _canonicalByUrl.set(u, canon);
    }
    ordered.push(canon);
  }
  _sectionOrder.set(key, ordered);
  return ordered;
}

export function iuClientArticleStoreGetSectionArticles(sectionKey) {
  const key = String(sectionKey || "").trim();
  if (!key) return [];
  return (_sectionOrder.get(key) || []).slice();
}

export function iuClientArticleStoreGetPrehledDneView() {
  const out = [];
  const seen = new Set();
  for (const list of _sectionOrder.values()) {
    for (const it of list) {
      if (!it) continue;
      const u = urlKey(it);
      if (u) {
        if (seen.has(u)) continue;
        seen.add(u);
      }
      out.push(it);
    }
  }
  out.sort((a, b) => {
    const ta = Date.parse(String(a && (a.publishedAt || a.published || a.date) ? a.publishedAt || a.published || a.date : "")) || 0;
    const tb = Date.parse(String(b && (b.publishedAt || b.published || b.date) ? b.publishedAt || b.published || b.date : "")) || 0;
    return tb - ta;
  });
  return out;
}

export function iuClientArticleStoreCreateVirtualPrehledLoader(manifest) {
  const articles = iuClientArticleStoreGetPrehledDneView();
  return {
    sectionKey: CLIENT_PREHLED_DNE_VIRTUAL_SECTION_KEY,
    manifest: manifest || null,
    articles,
    loadedChunkIndexes: new Set(),
    initLoaded: true,
    bufferChunkLoaded: true,
    nextLoadMoreChunkIndex: Number.MAX_SAFE_INTEGER,
    totalInSection: articles.length,
    backgroundDone: true,
    loadMoreInflight: false,
    articlesReceivedCount: articles.length,
    articlesParsedCount: articles.length,
    educationPreviewItems: [],
    sectionPreviewItems: null,
    _iuVirtualPrehledDne: true,
  };
}

export function iuClientArticleStoreIsVirtualPrehledLoader(loader) {
  return !!(loader && (loader._iuVirtualPrehledDne || loader.sectionKey === CLIENT_PREHLED_DNE_VIRTUAL_SECTION_KEY));
}

/**
 * Frontend article chunk loader (V2 — client delivery layer).
 * Reads already-published section chunks only; isolated from aggregation / Data Bot.
 */

import {
  IU_CLIENT_ARTICLE_INITIAL_LIMIT,
  IU_CLIENT_ARTICLE_LOAD_MORE_SIZE,
  iuClientArticleStoreIsPrehledDneKey,
  iuClientArticleStoreIsPrehledDneNav,
  iuClientArticleStoreRegisterSectionArticles,
  iuClientArticleStoreGetSectionArticles,
  iuClientArticleStoreGetLoader,
  iuClientArticleStoreSetLoader,
  iuClientArticleStoreHasSection,
  iuClientArticleStoreBuildPrehledDne,
} from "./iu-client-article-store.js";

export const IU_CHUNK_SCHEMA_VERSION = 2;
export const IU_CHUNK_INITIAL_SIZE = IU_CLIENT_ARTICLE_INITIAL_LIMIT;
export const IU_CHUNK_BUFFER_MAX = IU_CLIENT_ARTICLE_INITIAL_LIMIT;
export const IU_CHUNK_LOAD_MORE_SIZE = IU_CLIENT_ARTICLE_LOAD_MORE_SIZE;
export const IU_CHUNK_FILE_SIZE = IU_CLIENT_ARTICLE_LOAD_MORE_SIZE;
export const IU_ARTICLE_FEED_CHUNKS_DIR = "article_feed_chunks";
export const IU_HOMEPAGE_CHUNK_MANIFEST_FILE = "article_feed_chunks/manifest.json";
export const IU_PREHLED_DNE_SECTION_KEY = "prehled-dne";

/** @typedef {{ schemaVersion:number, generatedAt:string, poolGeneratedAt:string, chunkSize:number, initialSize:number, bufferMax:number, loadMoreSize:number, sections:Record<string,{totalArticles:number,chunkCount:number,chunkSize:number,initChunk?:string,initSize?:number,bufferMax?:number,chunks:string[]}>, sourcePool:string }} IuChunkManifest */

export function iuChunkManifestUrl(basePath, dataVer) {
  const base = String(basePath || "/projects/").replace(/\/?$/, "/") + "data/" + IU_HOMEPAGE_CHUNK_MANIFEST_FILE;
  const vq = !dataVer || dataVer === "iu-data-ver-placeholder" ? "iu-data-ver-placeholder" : dataVer;
  return `${base}?v=${encodeURIComponent(vq)}`;
}

export function iuChunkFileUrl(basePath, relChunkPath, dataVer) {
  const rel = String(relChunkPath || "").replace(/^data\//, "");
  const base = String(basePath || "/projects/").replace(/\/?$/, "/") + "data/" + rel;
  const vq = !dataVer || dataVer === "iu-data-ver-placeholder" ? "iu-data-ver-placeholder" : dataVer;
  return `${base}?v=${encodeURIComponent(vq)}`;
}

export function iuChunkKillSwitchOff() {
  try {
    return new URLSearchParams(String(typeof location !== "undefined" ? location.search : "")).get("iuArticlesChunk") === "0";
  } catch (_) {
    return false;
  }
}

export function iuChunkFullPoolForced() {
  try {
    return new URLSearchParams(String(typeof location !== "undefined" ? location.search : "")).get("iuArticlesFull") === "1";
  } catch (_) {
    return false;
  }
}

export function iuChunkBootstrapOptIn() {
  try {
    if (typeof window !== "undefined" && typeof window.__iuUseArticlesBootstrapPrimary === "function") {
      return window.__iuUseArticlesBootstrapPrimary();
    }
    const q = new URLSearchParams(String(typeof location !== "undefined" ? location.search : ""));
    if (q.get("iuArticlesFull") === "1") return false;
    if (q.get("iuArticlesBootstrap") === "0") return false;
    return q.get("iuArticlesBootstrap") === "1";
  } catch (_) {
    return false;
  }
}

export function iuUseChunkedArticleLoader() {
  if (iuChunkFullPoolForced() || iuChunkBootstrapOptIn() || iuChunkKillSwitchOff()) return false;
  try {
    const p = String(typeof location !== "undefined" && location.pathname ? location.pathname : "").replace(/\\/g, "/");
    return p === "/projects/" || p === "/projects" || p.indexOf("/projects/") === 0 || p === "/filtr/projects" || p === "/filtr/projects/";
  } catch (_) {
    return false;
  }
}

export function iuChunkNavSectionFromUrl() {
  if (iuClientArticleStoreIsPrehledDneNav()) return IU_PREHLED_DNE_SECTION_KEY;
  try {
    const p = new URLSearchParams(String(typeof location !== "undefined" ? location.search : ""));
    let sec = (p.get("section") || "feed").trim().toLowerCase();
    if (sec === "media") sec = "feed";
    let topic = (p.get("topic") || "").trim().toLowerCase();
    if (topic === "tech" || topic === "bydleni") topic = "zpravy";
    let mediaTopicKey = null;
    if (sec === "travel") mediaTopicKey = "cestovani";
    else if ((sec === "feed" || sec === "media") && topic && topic !== "all") mediaTopicKey = topic;
    else if (["hry", "kultura", "veda", "vzdelavani"].indexOf(sec) !== -1) mediaTopicKey = sec;
    return iuChunkResolveSectionKey({ mediaTopicKey, activeSection: sec });
  } catch (_) {
    return "zpravy";
  }
}

export function iuChunkResolveSectionKey(nav) {
  const n = nav && typeof nav === "object" ? nav : {};
  const topic = String(n.mediaTopicKey || "").trim().toLowerCase();
  if (topic && topic !== "all") {
    if (topic === "tech" || topic === "bydleni") return "zpravy";
    return topic;
  }
  const sec = String(n.activeSection || "").trim().toLowerCase();
  if (["hry", "kultura", "veda", "vzdelavani", "travel"].includes(sec)) return sec === "travel" ? "cestovani" : sec;
  if (iuClientArticleStoreIsPrehledDneNav()) return IU_PREHLED_DNE_SECTION_KEY;
  return "zpravy";
}

export function iuChunkCreateLoaderState(sectionKey) {
  return {
    sectionKey: String(sectionKey || "zpravy"),
    manifest: null,
    articles: [],
    loadedChunkIndexes: new Set(),
    initLoaded: false,
    previewMetaLoaded: false,
    bufferChunkLoaded: false,
    nextLoadMoreChunkIndex: 1,
    totalInSection: 0,
    backgroundDone: true,
    loadMoreInflight: false,
    articlesReceivedCount: 0,
    articlesParsedCount: 0,
    educationPreviewItems: [],
    sectionPreviewItems: null,
    clientDeliveryOnly: true,
  };
}

async function iuChunkFetchJson(url, label) {
  try {
    if (typeof window !== "undefined" && window.__iuArticlesLoaderFetchCounts) {
      const c = window.__iuArticlesLoaderFetchCounts;
      if (String(url).indexOf("article_feed_chunks") !== -1) c.article_feed_chunks = (c.article_feed_chunks | 0) + 1;
      else if (String(url).indexOf("publishable_pool.json") !== -1) c.publishable_pool = (c.publishable_pool | 0) + 1;
    }
  } catch (_) {}
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "cache-control": "no-cache" },
  });
  if (!res.ok) throw new Error(`HTTP_${res.status}_${label || "chunk"}`);
  return res.json();
}

export async function iuChunkEnsureManifest(loader, basePath, dataVer) {
  if (loader.manifest) return loader.manifest;
  const manifest = await iuChunkFetchJson(iuChunkManifestUrl(basePath, dataVer), "manifest");
  if (!manifest || typeof manifest !== "object" || !manifest.sections) {
    throw new Error("CHUNK_MANIFEST_INVALID");
  }
  loader.manifest = manifest;
  return manifest;
}

export function iuChunkSectionMeta(loader) {
  const m = loader && loader.manifest;
  if (!m || !m.sections) return null;
  return m.sections[loader.sectionKey] || null;
}

function iuChunkApplyPreviewPayload(loader, payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.sectionPreviewItems && typeof payload.sectionPreviewItems === "object") {
    loader.sectionPreviewItems = payload.sectionPreviewItems;
    const edu = payload.sectionPreviewItems.vzdelavani;
    if (Array.isArray(edu) && edu.length) loader.educationPreviewItems = edu.slice(0, 2);
  } else if (Array.isArray(payload.educationPreviewItems) && payload.educationPreviewItems.length) {
    loader.educationPreviewItems = payload.educationPreviewItems.slice(0, 2);
  }
}

function iuChunkDedupeAppend(existing, incoming) {
  const seen = new Set();
  const out = [];
  const keyOf = (it) => {
    const u = String(it && it.url ? it.url : "").trim();
    if (u) return "u:" + u;
    const t = String(it && it.title ? it.title : "");
    const p = String(it && it.publishedAt ? it.publishedAt : "");
    return "h:" + t + "|" + p;
  };
  for (const it of existing || []) {
    const k = keyOf(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  for (const it of incoming || []) {
    if (!it || typeof it !== "object") continue;
    const k = keyOf(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

async function iuChunkFetchRel(loader, relPath, basePath, dataVer, label, chunkIndexMark, includeArticles) {
  const url = iuChunkFileUrl(basePath, relPath, dataVer);
  const payload = await iuChunkFetchJson(url, label);
  if (includeArticles !== false) {
    const rows = Array.isArray(payload && payload.articles) ? payload.articles : [];
    loader.articlesReceivedCount += rows.length;
    if (chunkIndexMark != null) loader.loadedChunkIndexes.add(chunkIndexMark);
    loader.totalInSection =
      Number(payload && payload.totalInSection) ||
      Number(iuChunkSectionMeta(loader)?.totalArticles) ||
      loader.totalInSection;
    loader.articles = iuChunkDedupeAppend(loader.articles, rows);
    loader.articlesParsedCount = loader.articles.length;
    iuClientArticleStoreRegisterSectionArticles(loader.sectionKey, rows);
    return rows;
  }
  iuChunkApplyPreviewPayload(loader, payload);
  return [];
}

export async function iuChunkFetchFeedPreviewMetaOnly(loader, basePath, dataVer) {
  if (!loader || loader.previewMetaLoaded) return;
  const feedMeta = loader.manifest && loader.manifest.sections && loader.manifest.sections.feed;
  if (!feedMeta || !feedMeta.initChunk) return;
  loader.previewMetaLoaded = true;
  await iuChunkFetchRel(loader, feedMeta.initChunk, basePath, dataVer, "feed_preview_meta", null, false);
}

export async function iuChunkFetchInit(loader, basePath, dataVer) {
  if (loader.initLoaded) return [];
  const meta = iuChunkSectionMeta(loader);
  if (!meta || !meta.initChunk) throw new Error("CHUNK_INIT_MISSING");
  loader.initLoaded = true;
  return iuChunkFetchRel(loader, meta.initChunk, basePath, dataVer, "init", null);
}

export async function iuChunkFetchBufferChunk(loader, basePath, dataVer) {
  if (loader.bufferChunkLoaded) return [];
  const meta = iuChunkSectionMeta(loader);
  if (!meta || !Array.isArray(meta.chunks) || !meta.chunks[0]) return [];
  loader.bufferChunkLoaded = true;
  loader.backgroundDone = true;
  return iuChunkFetchRel(loader, meta.chunks[0], basePath, dataVer, "buffer_000", 0);
}

export async function iuChunkFetchChunkIndex(loader, chunkIndex, basePath, dataVer) {
  const meta = iuChunkSectionMeta(loader);
  if (!meta || !Array.isArray(meta.chunks) || chunkIndex < 0 || chunkIndex >= meta.chunks.length) {
    return [];
  }
  if (loader.loadedChunkIndexes.has(chunkIndex)) return [];
  return iuChunkFetchRel(loader, meta.chunks[chunkIndex], basePath, dataVer, `chunk_${chunkIndex}`, chunkIndex);
}

export async function iuChunkLoadInitial(basePath, dataVer, sectionKey) {
  const key = String(sectionKey || "zpravy").trim().toLowerCase();
  if (iuClientArticleStoreIsPrehledDneKey(key)) {
    const loader = iuChunkCreateLoaderState(key);
    return {
      loader,
      initialArticles: iuClientArticleStoreBuildPrehledDne(),
      generatedAt: null,
      totalInSection: iuClientArticleStoreBuildPrehledDne().length,
      prehledDneFromMemory: true,
    };
  }
  const cachedLoader = iuClientArticleStoreGetLoader(key);
  if (cachedLoader && iuClientArticleStoreHasSection(key)) {
    const cachedArticles = iuClientArticleStoreGetSectionArticles(key);
    return {
      loader: cachedLoader,
      initialArticles: cachedArticles.slice(0, IU_CLIENT_ARTICLE_INITIAL_LIMIT),
      generatedAt: cachedLoader.manifest && cachedLoader.manifest.generatedAt ? cachedLoader.manifest.generatedAt : null,
      totalInSection: iuChunkSectionMeta(cachedLoader)?.totalArticles || cachedLoader.totalInSection || cachedArticles.length,
      fromClientStore: true,
    };
  }
  const loader = iuChunkCreateLoaderState(key);
  await iuChunkEnsureManifest(loader, basePath, dataVer);
  void iuChunkFetchFeedPreviewMetaOnly(loader, basePath, dataVer);
  const rows = await iuChunkFetchChunkIndex(loader, 0, basePath, dataVer);
  loader.bufferChunkLoaded = true;
  loader.initLoaded = true;
  loader.backgroundDone = true;
  loader.nextLoadMoreChunkIndex = 1;
  const capped = rows.slice(0, IU_CLIENT_ARTICLE_INITIAL_LIMIT);
  iuClientArticleStoreSetLoader(key, loader);
  const meta = iuChunkSectionMeta(loader);
  return {
    loader,
    initialArticles: capped,
    generatedAt: loader.manifest && loader.manifest.generatedAt ? loader.manifest.generatedAt : null,
    totalInSection: (meta && meta.totalArticles) || loader.totalInSection || capped.length,
  };
}

/** Legacy no-op: initial load already delivers the client limit (100). */
export async function iuChunkFetchBackgroundBuffer(loader, basePath, dataVer) {
  if (!loader || loader.backgroundDone) return loader ? loader.articles.slice(0, IU_CLIENT_ARTICLE_INITIAL_LIMIT) : [];
  loader.backgroundDone = true;
  return loader.articles.slice(0, IU_CLIENT_ARTICLE_INITIAL_LIMIT);
}

export async function iuChunkFetchLoadMore(loader, basePath, dataVer) {
  if (!loader || loader.loadMoreInflight) return { added: [], chunkIndex: null };
  if (iuClientArticleStoreIsPrehledDneKey(loader.sectionKey)) {
    return { added: [], chunkIndex: null, prehledDneMemoryOnly: true };
  }
  loader.loadMoreInflight = true;
  try {
    const idx = loader.nextLoadMoreChunkIndex;
    const meta = iuChunkSectionMeta(loader);
    if (!meta || idx >= meta.chunkCount) return { added: [], chunkIndex: null };
    const before = loader.articles.length;
    await iuChunkFetchChunkIndex(loader, idx, basePath, dataVer);
    loader.nextLoadMoreChunkIndex = idx + 1;
    return { added: loader.articles.slice(before), chunkIndex: idx };
  } finally {
    loader.loadMoreInflight = false;
  }
}

export function iuChunkHasMoreOnServer(loader) {
  if (!loader || iuClientArticleStoreIsPrehledDneKey(loader.sectionKey)) return false;
  const meta = iuChunkSectionMeta(loader);
  if (!meta) return false;
  return loader.nextLoadMoreChunkIndex < meta.chunkCount;
}

export function iuChunkVisibleArticleBudget(page) {
  const p = Number(page) >= 1 ? Number(page) : 1;
  return p * IU_CLIENT_ARTICLE_INITIAL_LIMIT;
}

export function iuChunkPoolShapedPayload(loader, articles, generatedAt) {
  return {
    generatedAt: generatedAt || (loader.manifest && loader.manifest.generatedAt) || null,
    schemaVersion: IU_CHUNK_SCHEMA_VERSION,
    pipelinePhase: "article_feed_chunks_client",
    articles: Array.isArray(articles) ? articles : [],
    _iuChunkMode: true,
    _iuChunkSectionKey: loader.sectionKey,
    _iuChunkTotalInSection: iuChunkSectionMeta(loader)?.totalArticles || loader.totalInSection || 0,
  };
}

export function iuChunkDataVer() {
  try {
    const m = typeof document !== "undefined" && document.querySelector && document.querySelector('meta[name="iu-data-ver"]');
    const v = m && m.getAttribute("content") ? String(m.getAttribute("content")).trim() : "";
    return v || "iu-data-ver-placeholder";
  } catch (_) {
    return "iu-data-ver-placeholder";
  }
}

try {
  if (typeof window !== "undefined") {
    window.iuUseChunkedArticleLoader = iuUseChunkedArticleLoader;
    window.__iuHomepageFeedDataSource = IU_HOMEPAGE_CHUNK_MANIFEST_FILE;
    window.__iuClientArticleLimits = {
      initial: IU_CLIENT_ARTICLE_INITIAL_LIMIT,
      loadMore: IU_CLIENT_ARTICLE_LOAD_MORE_SIZE,
    };
  }
} catch (_) {}

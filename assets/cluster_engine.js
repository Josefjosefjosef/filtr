/**
 * infoUzel — 1 téma = 1 článek (cluster + pick best).
 * String + rough + sémantika (klíčová slova + entity + ENTITY_MAP), bez API.
 * Sekce: jen uvnitř stejného topic/section.
 * Čas: max rozpětí publikace v clusteru ±6 h vůči prvnímu článku.
 * Max velikost clusteru: 10.
 */

import { ENTITY_LOOKUP } from "./entity_map.js";
import { TOPIC_MAP } from "./topic_map.js";

const DEFAULT_SIMILARITY = 0.6;
const DEFAULT_HOURS = 6;
const DEFAULT_MAX_CLUSTER = 10;

/** LRU cap: normalizeTitle is pure; cache only shrinks CPU, never changes outputs. */
const IU_NORMALIZE_TITLE_CACHE_MAX = 16384;
const normalizeTitleCache = new Map();

/** @param {string} title */
export function normalizeTitle(title) {
  if (!title || typeof title !== "string") return "";
  const hit = normalizeTitleCache.get(title);
  if (hit !== undefined) return hit;
  const out = title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\d+/g, "")
    .replace(
      /\b(a|i|o|u|v|na|do|se|je|jsou|který|která|které|už|byl|byla|bude)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (normalizeTitleCache.size >= IU_NORMALIZE_TITLE_CACHE_MAX) {
    const firstKey = normalizeTitleCache.keys().next().value;
    normalizeTitleCache.delete(firstKey);
  }
  normalizeTitleCache.set(title, out);
  return out;
}

/** @param {string} a @param {string} b */
export function similarity(a, b) {
  const aw = new Set(a.split(/\s+/).filter(Boolean));
  const bw = new Set(b.split(/\s+/).filter(Boolean));
  if (aw.size === 0 || bw.size === 0) return 0;
  let intersection = 0;
  aw.forEach((w) => {
    if (bw.has(w)) intersection++;
  });
  return intersection / Math.max(aw.size, bw.size);
}

/**
 * Doplňková heuristika: stejný „úvod“ titulku (jiná formulace).
 * @param {string} a
 * @param {string} b
 */
export function roughMatch(a, b) {
  if (!a || !b || typeof a !== "string" || typeof b !== "string") return false;
  const pb = b.slice(0, 20);
  const pa = a.slice(0, 20);
  if (!pb.length || !pa.length) return false;
  return a.includes(pb) || b.includes(pa);
}

/**
 * @param {string} w jedno slovo
 */
function normalizeEntityToken(w) {
  const lw = String(w)
    .toLowerCase()
    .replace(/[.,:;!?()[\]{}'"]/g, "")
    .trim();
  if (!lw) return lw;
  return ENTITY_LOOKUP.has(lw) ? ENTITY_LOOKUP.get(lw) : lw;
}

/**
 * @param {string[]} words
 */
function normalizeEntities(words) {
  return words.map((w) => normalizeEntityToken(w));
}

/**
 * Přiřadí kanonické topicId podle klíčových slov v normalizovaném titulku.
 * @param {string} title
 * @returns {string | null}
 */
export function detectTopic(title) {
  const norm = normalizeTitle(title);

  let bestTopic = null;
  let bestScore = 0;

  for (const [topic, keywords] of Object.entries(TOPIC_MAP)) {
    let score = 0;

    for (const k of keywords) {
      if (norm.includes(k)) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestScore >= 1 ? bestTopic : null;
}

/** @param {string} title */
export function extractKeywords(title) {
  const words = normalizeTitle(title)
    .split(" ")
    .filter((w) => w.length > 3);
  return normalizeEntities(words);
}

/** @param {string} title */
export function extractEntities(title) {
  if (!title || typeof title !== "string") return [];
  const words = title.split(" ").filter((w) => w.length > 2);
  return normalizeEntities(words);
}

/**
 * Sémantická podobnost (heuristika, bez síťových volání).
 * @returns {{ score: number, entityOverlap: number, keywordScore: number, entityScore: number }}
 */
export function semanticSimilarityMeta(a, b) {
  const sa = String(a || "");
  const sb = String(b || "");
  const aKeywords = new Set(extractKeywords(sa));
  const bKeywords = new Set(extractKeywords(sb));

  let keywordOverlap = 0;
  aKeywords.forEach((w) => {
    if (bKeywords.has(w)) keywordOverlap++;
  });

  const aEntities = new Set(extractEntities(sa));
  const bEntities = new Set(extractEntities(sb));

  let entityOverlap = 0;
  aEntities.forEach((e) => {
    if (bEntities.has(e)) entityOverlap++;
  });

  const keywordScore =
    keywordOverlap / Math.max(aKeywords.size, bKeywords.size || 1);
  const entityScore =
    entityOverlap / Math.max(aEntities.size, bEntities.size || 1);

  const boosted = keywordScore * 0.6 + entityScore * 0.4;
  return {
    score: boosted,
    boosted,
    entityOverlap,
    keywordScore,
    entityScore,
  };
}

/** @param {string} a @param {string} b */
export function semanticSimilarity(a, b) {
  return semanticSimilarityMeta(a, b).score;
}

function publishedMs(article) {
  try {
    const raw = article?.publishedAt || article?.date || article?.published || "";
    const t = Date.parse(String(raw));
    return Number.isFinite(t) ? t : 0;
  } catch (_) {
    return 0;
  }
}

function sectionKey(article) {
  return String(article?.topic || article?.section || "").toLowerCase() || "_none";
}

/**
 * Dedup stejné kanonické URL (bez query/hash).
 * @param {object[]} articles
 */
/** Canonical URL key for dedupe + publication history (host+path, lowercase). */
export function canonicalArticleUrlKey(article) {
  if (!article || typeof article !== "object") return "";
  const raw = String(article.url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw, "https://infouzel.cz/");
    return `${u.hostname}${u.pathname}`.toLowerCase().replace(/\/$/, "");
  } catch (_) {
    return raw.split("?")[0].split("#")[0].toLowerCase();
  }
}

export function dedupeCanonicalUrl(articles) {
  if (!Array.isArray(articles)) return [];
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    if (!a || typeof a !== "object") continue;
    const raw = String(a.url || "").trim();
    if (!raw) {
      out.push(a);
      continue;
    }
    const canon = canonicalArticleUrlKey(a);
    if (!canon) {
      out.push(a);
      continue;
    }
    if (seen.has(canon)) continue;
    seen.add(canon);
    out.push(a);
  }
  return out;
}

/**
 * @param {object[]} articles
 * @param {{ similarityThreshold?: number, hoursWindow?: number, maxClusterSize?: number }} [options]
 */
export function clusterArticles(articles, options = {}) {
  const simTh = Number(options.similarityThreshold) || DEFAULT_SIMILARITY;
  const hours = Number(options.hoursWindow) || DEFAULT_HOURS;
  const windowMs = hours * 3600 * 1000;
  const maxSize = Number(options.maxClusterSize) || DEFAULT_MAX_CLUSTER;

  if (!Array.isArray(articles) || articles.length === 0) return [];

  const bySec = new Map();
  for (const article of articles) {
    if (!article || typeof article !== "object") continue;
    const sk = sectionKey(article);
    if (!bySec.has(sk)) bySec.set(sk, []);
    bySec.get(sk).push(article);
  }

  const allClusters = [];

  for (const [, sectionArticles] of bySec) {
    const sorted = [...sectionArticles].sort((a, b) => publishedMs(b) - publishedMs(a));

    const clusters = [];
    for (const article of sorted) {
      const norm = normalizeTitle(article.title || "");
      const t = publishedMs(article);

      let found = false;
      for (const cluster of clusters) {
        const sim = similarity(norm, cluster.norm);
        const primaryTitle = String(cluster.items[0]?.title || "");
        const articleTitle = String(article.title || "");
        const sem = semanticSimilarityMeta(articleTitle, primaryTitle);

        const topicA = detectTopic(articleTitle);
        const topicB = detectTopic(primaryTitle);
        const sameTopic = topicA && topicB && topicA === topicB;

        if (!sameTopic && sem.boosted > 0.5 && sem.entityOverlap === 0) continue;

        const match =
          sameTopic ||
          sim >= simTh ||
          roughMatch(norm, cluster.norm) ||
          sem.boosted >= 0.5;
        if (!match) continue;

        const t0 = publishedMs(cluster.items[0]);
        const timeDiff = Math.abs(t - t0);
        if (timeDiff > windowMs) continue;

        if (cluster.items.length >= maxSize) continue;

        cluster.items.push(article);
        found = true;
        break;
      }

      if (!found) {
        clusters.push({
          norm,
          items: [article],
          sectionKey: sectionKey(article),
        });
      }
    }
    allClusters.push(...clusters);
  }

  return allClusters;
}

function clusterEngineAuditEnabled() {
  try {
    return typeof window !== "undefined" && window.__IU_CLUSTER_ENGINE_AUDIT__ === true;
  } catch (_) {
    return false;
  }
}

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

/**
 * Stejná logika jako clusterArticles, ale jeden globální proud (čas ↓), bez splitu podle section.
 * Pro publikační dedup napříč zdroji u stejné události (např. více médií, stejná sekce / téma).
 *
 * CPU: časové okno ±hoursWindow je kontrolováno před drahým similarity/semantic (stejné výsledky jako dřív).
 * options._audit — interní měření (nastaví buildPublicationClusterUrlMap při window.__IU_CLUSTER_ENGINE_AUDIT__).
 */
export function clusterArticlesUnified(articles, options = {}) {
  const simTh = Number(options.similarityThreshold) || DEFAULT_SIMILARITY;
  const hours = Number(options.hoursWindow) || DEFAULT_HOURS;
  const windowMs = hours * 3600 * 1000;
  const maxSize = Number(options.maxClusterSize) || DEFAULT_MAX_CLUSTER;
  const audit = options._audit && typeof options._audit === "object" ? options._audit : null;

  if (!Array.isArray(articles) || articles.length === 0) return [];

  const tSort0 = audit ? nowMs() : 0;
  const sorted = [...articles].sort((a, b) => publishedMs(b) - publishedMs(a));
  if (audit) {
    audit.sortDurationMs = nowMs() - tSort0;
  }

  const clusters = [];
  let pairCompareCount = 0;
  let timeRejectCount = 0;
  let pairCompareMsAcc = 0;
  let assignMsAcc = 0;

  const tLoop0 = audit ? nowMs() : 0;

  for (const article of sorted) {
    if (!article || typeof article !== "object") continue;
    const norm = normalizeTitle(article.title || "");
    const t = publishedMs(article);
    const articleTitle = String(article.title || "");
    const topicA = detectTopic(articleTitle);

    let found = false;
    for (const cluster of clusters) {
      const tPair0 = audit ? nowMs() : 0;
      pairCompareCount += 1;

      const t0 = cluster.primaryMs != null ? cluster.primaryMs : publishedMs(cluster.items[0]);
      const timeDiff = Math.abs(t - t0);
      if (timeDiff > windowMs) {
        timeRejectCount += 1;
        if (audit) pairCompareMsAcc += nowMs() - tPair0;
        continue;
      }

      const primaryTitle = String(cluster.items[0]?.title || "");
      const sim = similarity(norm, cluster.norm);
      const sem = semanticSimilarityMeta(articleTitle, primaryTitle);

      const topicB =
        cluster.topicPrimary !== undefined ? cluster.topicPrimary : detectTopic(primaryTitle);
      const sameTopic = topicA && topicB && topicA === topicB;

      if (!sameTopic && sem.boosted > 0.5 && sem.entityOverlap === 0) {
        if (audit) pairCompareMsAcc += nowMs() - tPair0;
        continue;
      }

      const match =
        sameTopic || sim >= simTh || roughMatch(norm, cluster.norm) || sem.boosted >= 0.5;
      if (!match) {
        if (audit) pairCompareMsAcc += nowMs() - tPair0;
        continue;
      }

      if (cluster.items.length >= maxSize) {
        if (audit) pairCompareMsAcc += nowMs() - tPair0;
        continue;
      }

      const tAssign0 = audit ? nowMs() : 0;
      cluster.items.push(article);
      if (audit) {
        assignMsAcc += nowMs() - tAssign0;
        pairCompareMsAcc += nowMs() - tPair0;
      }
      found = true;
      break;
    }

    if (!found) {
      const tNew0 = audit ? nowMs() : 0;
      const primaryMs = t;
      const topicPrimary = topicA;
      clusters.push({
        norm,
        items: [article],
        sectionKey: sectionKey(article),
        primaryMs,
        topicPrimary,
      });
      if (audit) assignMsAcc += nowMs() - tNew0;
    }
  }

  if (audit) {
    audit.pairCompareCount = pairCompareCount;
    audit.timeRejectBeforeSemanticCount = timeRejectCount;
    audit.pairCompareDurationMs = pairCompareMsAcc;
    audit.clusterAssignDurationMs = assignMsAcc;
    audit.clusterUnifiedLoopWallMs = nowMs() - tLoop0;
  }

  return clusters;
}

/**
 * Přiřadí každému článku stabilní clusterId podle clusterArticlesUnified (po URL dedup).
 * @returns {Map<string, string>} canonicalArticleUrlKey → clusterId
 */
export function buildPublicationClusterUrlMap(articles, options = {}) {
  const map = new Map();
  const audit = clusterEngineAuditEnabled() ? {} : null;
  const opts = audit ? { ...options, _audit: audit } : options;

  const t0 = audit ? nowMs() : 0;
  const deduped = dedupeCanonicalUrl(articles);
  const tAfterDedupe = audit ? nowMs() : 0;
  if (audit) {
    audit.clusterInputCount = deduped.length;
    audit.dedupeWallMs = tAfterDedupe - t0;
  }

  const clusters = clusterArticlesUnified(deduped, opts);
  const tAfterUnified = audit ? nowMs() : 0;
  if (audit) {
    audit.clusterArticlesUnifiedWallMs = tAfterUnified - tAfterDedupe;
    audit.clusterMapMs = tAfterUnified - tAfterDedupe;
  }

  const tMap0 = audit ? nowMs() : 0;
  for (let i = 0; i < clusters.length; i++) {
    const cl = clusters[i];
    const id = `pubc:${i}:${cl.sectionKey}:${publishedMs(cl.items[0])}`;
    for (const it of cl.items) {
      const k = canonicalArticleUrlKey(it);
      if (k) map.set(k, id);
    }
  }
  if (audit) {
    audit.resultMapDurationMs = nowMs() - tMap0;
    try {
      window.__IU_CLUSTER_ENGINE_AUDIT_LAST__ = audit;
    } catch (_) {}
  }

  return map;
}

/** Klíč zdroje: primárně sources[0].name, jinak host z URL. */
export function publicationSourceKey(item) {
  try {
    const src0 =
      Array.isArray(item?.sources) && item.sources[0]
        ? String(item.sources[0].name || "").trim()
        : "";
    if (src0) return src0.toLowerCase().replace(/\s+/g, " ").slice(0, 120);
    const u = new URL(String(item?.url || ""), "https://infouzel.cz/");
    return String(u.hostname || "")
      .replace(/^www\./i, "")
      .toLowerCase();
  } catch (_) {
    return "";
  }
}

/**
 * Max 2 články na publikační cluster, max 1 na zdroj v rámci clusteru.
 * @param {object[]} sortedArts pořadí priorit (např. nejdřív ne-prev, pak čas ↓)
 * @param {Map<string,string>} clusterMap z buildPublicationClusterUrlMap(deduped)
 */
export function pickPublicationKeptUrlKeys(sortedArts, clusterMap) {
  const per = new Map();
  const kept = new Set();
  for (const it of sortedArts) {
    const k = canonicalArticleUrlKey(it);
    if (!k) continue;
    const cid = clusterMap.get(k) || "solo:" + k;
    const src = publicationSourceKey(it);
    let st = per.get(cid);
    if (!st) st = { n: 0, sources: new Set() };
    if (st.n >= 2) continue;
    if (src && st.sources.has(src)) continue;
    if (src) st.sources.add(src);
    st.n += 1;
    per.set(cid, st);
    kept.add(k);
  }
  return kept;
}

/**
 * @param {{ items: object[] }} cluster
 */
export function pickBest(cluster) {
  const items = cluster?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  return [...items].sort((a, b) => {
    const scoreA =
      Number(a?.displayScore ?? 0) * Number(a?.sourceDisplayWeight ?? 1);
    const scoreB =
      Number(b?.displayScore ?? 0) * Number(b?.sourceDisplayWeight ?? 1);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return publishedMs(b) - publishedMs(a);
  })[0];
}

/**
 * Kanonická URL dedup → cluster → jeden vítěz na cluster.
 * @param {object[]} articles
 */
export function clusterAndPickFinalArticles(articles) {
  const rawCount = Array.isArray(articles) ? articles.length : 0;
  const urlDeduped = dedupeCanonicalUrl(articles);
  const clusters = clusterArticles(urlDeduped);
  const final = clusters
    .map(pickBest)
    .filter(Boolean)
    .map((a) => ({
      ...a,
      topicId: detectTopic(String(a.title || "")),
    }));
  return {
    final,
    clusters,
    rawCount,
    urlDedupCount: urlDeduped.length,
    clusterCount: clusters.length,
    droppedCount: urlDeduped.length - final.length,
  };
}

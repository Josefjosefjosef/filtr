/**
 * infoUzel — 1 téma = 1 článek (cluster + pick best).
 * Sekce: jen uvnitř stejného topic/section.
 * Čas: max rozpětí publikace v clusteru ±6 h.
 * Max velikost clusteru: 10.
 */

const DEFAULT_SIMILARITY = 0.6;
const DEFAULT_HOURS = 6;
const DEFAULT_MAX_CLUSTER = 10;

/** @param {string} title */
export function normalizeTitle(title) {
  if (!title || typeof title !== "string") return "";
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\d+/g, "")
    .replace(
      /\b(a|i|o|u|v|na|do|se|je|jsou|který|která|které|už|byl|byla|bude)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
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
    try {
      const u = new URL(raw, "https://infouzel.cz/");
      const canon = `${u.hostname}${u.pathname}`.toLowerCase().replace(/\/$/, "");
      if (seen.has(canon)) continue;
      seen.add(canon);
      out.push(a);
    } catch (_) {
      const fallback = raw.split("?")[0].split("#")[0].toLowerCase();
      if (seen.has(fallback)) continue;
      seen.add(fallback);
      out.push(a);
    }
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
        const match = sim >= simTh || roughMatch(norm, cluster.norm);
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
  const final = clusters.map(pickBest).filter(Boolean);
  return {
    final,
    clusters,
    rawCount,
    urlDedupCount: urlDeduped.length,
    clusterCount: clusters.length,
    droppedCount: urlDeduped.length - final.length,
  };
}

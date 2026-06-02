/**
 * Shared RSS ↔ articles.json content freshness helpers (P0 headline sources).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadRegistry, activeRegistryEntries } from "./source-rotation-guard-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.join(__dirname, "..");

export const IU_USER_AGENT =
  process.env.IU_USER_AGENT ||
  "infoUzelBot/1.0 (+https://infouzel.cz; contact: Info@infoUzel.cz)";

/** P0 sources required for content freshness proof. */
export const P0_CONTENT_SOURCES = [
  {
    id: "novinky",
    label: "Novinky.cz",
    slotKey: "novinky.cz",
    namePatterns: [/novinky/i],
    fallbackUrl: "https://www.novinky.cz/rss",
  },
  {
    id: "ct24",
    label: "ČT24",
    slotKey: "ceskatelevize.cz",
    namePatterns: [/\bčt24\b/i, /\bct24\b/i, /česká televize.*ct24/i],
    fallbackUrl: "https://ct24.ceskatelevize.cz/rss",
  },
  {
    id: "seznam",
    label: "Seznam Zprávy",
    slotKey: "seznamzpravy.cz",
    namePatterns: [/seznam\s*zpr/i, /seznamzpravy/i],
    fallbackUrl: "https://www.seznamzpravy.cz/rss",
  },
  {
    id: "idnes",
    label: "iDNES",
    slotKey: "idnes.cz",
    namePatterns: [/idnes/i],
    fallbackUrl: "https://servis.idnes.cz/rss.aspx?c=zpravodaj",
  },
  {
    id: "sportcz",
    label: "Sport.cz",
    slotKey: "sport.cz",
    namePatterns: [/^sport\.cz/i, /\bsport\.cz\b/i],
    fallbackUrl: "https://www.sport.cz/rss/",
  },
];

export function canonicalUrl(u) {
  if (!u) return "";
  try {
    const x = new URL(String(u).trim());
    x.hash = "";
    let p = x.pathname.replace(/\/+$/, "") || "/";
    x.pathname = p;
    return x.toString().toLowerCase();
  } catch {
    return String(u).trim().toLowerCase();
  }
}

export function parseRssDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** articles.json generatedAt as epoch ms (bundle snapshot time for trace guard). */
export function bundleGeneratedAtMs(doc) {
  if (!doc || !doc.generatedAt) return null;
  return parseRssDate(String(doc.generatedAt));
}

/**
 * RSS item may be traced only if published at or before bundle generation (+ slack).
 */
export function isRssPublishTraceableAtBundle(publishTs, bundleGeneratedAtMs, slackMs = 0) {
  if (publishTs === null || bundleGeneratedAtMs === null) return false;
  return publishTs <= bundleGeneratedAtMs + slackMs;
}

export function filterRssCandidatesForBundleSnapshot(candidates, bundleGeneratedAtMs, slackMs = 0) {
  if (bundleGeneratedAtMs === null) return [];
  const cutoff = bundleGeneratedAtMs + slackMs;
  return candidates.filter((c) => typeof c.ts === "number" && c.ts <= cutoff);
}

export function extractItems(xml) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const chunk = block.split(/<\/item>/i)[0] || block;
    const title = (chunk.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1]?.trim() || "";
    const link =
      (chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]?.trim() ||
      (chunk.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1]?.trim() ||
      "";
    const pub =
      (chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1]?.trim() ||
      (chunk.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1]?.trim() ||
      (chunk.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i) || [])[1]?.trim() ||
      "";
    items.push({ title: title.replace(/<[^>]+>/g, ""), link, pubDate: pub });
  }
  if (items.length === 0) {
    const entries = xml.split(/<entry[\s>]/i).slice(1);
    for (const block of entries) {
      const chunk = block.split(/<\/entry>/i)[0] || block;
      const title = (chunk.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1]?.trim() || "";
      const link = (chunk.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1]?.trim() || "";
      const pub =
        (chunk.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1]?.trim() ||
        (chunk.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || [])[1]?.trim() ||
        "";
      items.push({ title: title.replace(/<[^>]+>/g, ""), link, pubDate: pub });
    }
  }
  return items;
}

export function looksLikeFeedXml(text) {
  if (!text) return false;
  const s = text.trim().replace(/^\uFEFF/, "");
  const low = s.slice(0, 240).toLowerCase();
  return low.startsWith("<?xml") || low.startsWith("<rss") || low.startsWith("<feed") || low.startsWith("<rdf:");
}

export async function loadArticlesDoc() {
  const remote = (process.env.ARTICLES_JSON_URL || "").trim();
  const local =
    process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
  if (remote) {
    const res = await fetch(remote, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!res.ok) throw new Error(`articles fetch failed ${res.status}`);
    return res.json();
  }
  if (!fs.existsSync(local)) throw new Error(`missing ${local}`);
  return JSON.parse(fs.readFileSync(local, "utf8"));
}

export function resolveFeedUrlForP0(def) {
  try {
    const registry = loadRegistry();
    for (const e of activeRegistryEntries(registry)) {
      const url = String(e.feed_url || "").trim();
      if (!url) continue;
      const label = String(e.label || e.id || "").toLowerCase();
      const dom = String(e.domain || "").toLowerCase();
      if (def.slotKey === "novinky.cz" && (dom.includes("novinky") || label.includes("novinky"))) return url;
      if (def.slotKey === "seznamzpravy.cz" && (dom.includes("seznam") || label.includes("seznam"))) return url;
      if (def.slotKey === "idnes.cz" && url.includes("idnes.cz") && !url.includes("sport")) return url;
      if (def.slotKey === "ceskatelevize.cz" && (url.includes("ct24") || label.includes("ct24"))) return url;
      if (def.slotKey === "sport.cz" && dom.includes("sport.cz") && !dom.includes("isport")) return url;
    }
  } catch {
    /* registry optional */
  }
  return def.fallbackUrl;
}

export async function fetchFeedXml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": IU_USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    redirect: "follow",
  });
  const text = await res.text();
  return { status: res.status, text, ok: res.ok && looksLikeFeedXml(text) };
}

export function articleMatchesP0Source(article, def) {
  const url = String(article.url || (article.sources && article.sources[0] && article.sources[0].url) || "").trim();
  if (def.id === "ct24" && /ct24\.ceskatelevize\.cz/i.test(url)) return true;
  if (def.id === "idnes" && /(^|\/)idnes\.cz\//i.test(url) && !/isport\.idnes/i.test(url)) return true;
  if (def.id === "novinky" && /novinky\.cz/i.test(url)) return true;
  if (def.id === "seznam" && /seznamzpravy\.cz/i.test(url)) return true;
  if (def.id === "sportcz" && /(^|\/)sport\.cz\//i.test(url) && !/isport\.cz/i.test(url)) return true;
  const src0 = (article.sources || [])[0];
  const name = String((src0 && src0.name) || article.sourceLabel || "").trim();
  if (!name) return false;
  return def.namePatterns.some((re) => re.test(name));
}

export function effectivePublishedMs(article) {
  const raw = article.iuReleaseAt || article.publishedAt;
  const t = parseRssDate(raw);
  return t;
}

export function buildArticleUrlIndex(articles) {
  const byUrl = new Map();
  for (const a of articles) {
    const u = canonicalUrl(a.url || (a.sources && a.sources[0] && a.sources[0].url));
    if (u) byUrl.set(u, a);
  }
  return byUrl;
}

export function newestProductionForP0(articles, def) {
  const now = Date.now();
  const maxFutureMs = 3_600_000;
  let best = null;
  for (const a of articles) {
    if (!articleMatchesP0Source(a, def)) continue;
    const t = effectivePublishedMs(a);
    if (t === null || t > now + maxFutureMs) continue;
    if (!best || t > best.ts) {
      best = { ts: t, title: a.title || "", url: a.url || "" };
    }
  }
  return best;
}

export function newestRssItem(items) {
  let best = null;
  for (const it of items) {
    const t = parseRssDate(it.pubDate);
    if (t === null) continue;
    if (!best || t > best.ts) {
      best = { ts: t, title: it.title || "", url: it.link || "" };
    }
  }
  return best;
}

export async function measureP0ContentGaps() {
  const doc = await loadArticlesDoc();
  const articles = Array.isArray(doc.articles) ? doc.articles : [];
  const byUrl = buildArticleUrlIndex(articles);
  const now = Date.now();
  const genTs = parseRssDate(doc.generatedAt);
  const rows = [];

  for (const def of P0_CONTENT_SOURCES) {
    const feedUrl = resolveFeedUrlForP0(def);
    let rssLatest = null;
    let fetchError = null;
    try {
      const { ok, text, status } = await fetchFeedXml(feedUrl);
      if (!ok) {
        fetchError = `HTTP/status ${status} not RSS`;
      } else {
        rssLatest = newestRssItem(extractItems(text));
      }
    } catch (e) {
      fetchError = e.message || String(e);
    }

    const prodLatest = newestProductionForP0(articles, def);
    let gapMinutes = null;
    if (rssLatest && prodLatest) {
      gapMinutes = Math.max(0, (rssLatest.ts - prodLatest.ts) / 60_000);
    } else if (rssLatest && !prodLatest) {
      gapMinutes = Infinity;
    }

    const rssInJson =
      rssLatest && rssLatest.url ? byUrl.has(canonicalUrl(rssLatest.url)) : false;

    rows.push({
      source: def.label,
      sourceId: def.id,
      feedUrl,
      fetchError,
      rssLatest: rssLatest
        ? { ts: rssLatest.ts, iso: new Date(rssLatest.ts).toISOString(), title: rssLatest.title, url: rssLatest.url }
        : null,
      productionLatest: prodLatest
        ? { ts: prodLatest.ts, iso: new Date(prodLatest.ts).toISOString(), title: prodLatest.title, url: prodLatest.url }
        : null,
      gapMinutes,
      rssLatestInJson: rssInJson,
    });
  }

  const contentNewerThanGenerated = articles.filter((a) => {
    const t = effectivePublishedMs(a);
    return genTs && t && t > genTs;
  }).length;

  return {
    generatedAt: doc.generatedAt || null,
    generatedAtTs: genTs,
    contentNewerThanGenerated,
    articleCount: articles.length,
    measuredAt: new Date(now).toISOString(),
    rows,
  };
}

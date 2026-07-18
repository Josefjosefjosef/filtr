/**
 * Shared helpers for Přehled dne info-events connectors.
 * Only concrete item URLs are accepted (never source homepages / listing roots).
 */
import crypto from "crypto";

export const IU_INFO_EVENTS_UA = "InfoUzelInfoEvents/1.1 (+https://infouzel.cz)";

const LISTING_PATH_RE =
  /^\/(aktuality|novinky|tiskove-zpravy|tiskove_zpravy|press|rss|rss\.aspx|feed|zpravodajstvi|media-centrum|informacni-servis)\/?$/i;

export function stripHtml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return "";
      }
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeXmlEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function normalizeItemUrl(raw, baseUrl) {
  if (!raw) return "";
  let u = decodeXmlEntities(String(raw).trim());
  if (!u) return "";
  try {
    const abs = new URL(u, baseUrl || undefined);
    if (abs.protocol === "http:") abs.protocol = "https:";
    abs.hash = "";
    // Drop common tracking params
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"].forEach((k) =>
      abs.searchParams.delete(k)
    );
    return abs.toString();
  } catch {
    return "";
  }
}

export function isConcreteItemUrl(url, sourceHomeUrl) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    // Malformed / truncated hrefs from broken CMS markup
    if (/https?&/i.test(url) || /%20https/i.test(url)) return false;
    const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
    if (path === "/") return false;
    if (LISTING_PATH_RE.test(path)) return false;
    if (sourceHomeUrl) {
      try {
        const home = new URL(sourceHomeUrl);
        const homePath = (home.pathname || "/").replace(/\/+$/, "") || "/";
        if (u.hostname.replace(/^www\./, "") === home.hostname.replace(/^www\./, "") && path === homePath) {
          return false;
        }
      } catch {
        /* ignore */
      }
    }
    if (path.split("/").filter(Boolean).length < 1) return false;
    return true;
  } catch {
    return false;
  }
}

export function extractFeedItems(xml) {
  const items = [];
  const blocks = String(xml || "").split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const chunk = block.split(/<\/item>/i)[0] || block;
    const title = stripHtml((chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const link =
      decodeXmlEntities((chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || "").trim() ||
      decodeXmlEntities((chunk.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || "").trim() ||
      decodeXmlEntities((chunk.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || [])[1] || "").trim();
    const pub =
      ((chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || "").trim() ||
      ((chunk.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i) || [])[1] || "").trim() ||
      ((chunk.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1] || "").trim();
    items.push({ title, link, pubDate: pub });
  }
  if (items.length === 0) {
    const entries = String(xml || "").split(/<entry[\s>]/i).slice(1);
    for (const block of entries) {
      const chunk = block.split(/<\/entry>/i)[0] || block;
      const title = stripHtml((chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
      const link = decodeXmlEntities((chunk.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || "").trim();
      const pub =
        ((chunk.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1] || "").trim() ||
        ((chunk.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || [])[1] || "").trim();
      items.push({ title, link, pubDate: pub });
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

export function foldCs(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeGroupKey(title, publishedAt) {
  const day = String(publishedAt || "").slice(0, 10) || "unknown";
  const words = foldCs(title).split(" ").filter(Boolean).slice(0, 8).join("-");
  const base = words || "item";
  return `${day}:${base}`;
}

export function makeItemId(sourceId, url, publishedAt) {
  const h = crypto.createHash("sha1").update(`${sourceId}|${url}|${publishedAt || ""}`).digest("hex").slice(0, 12);
  return `ie-${sourceId}-${h}`;
}

export function mapGroupToSection(group) {
  const g = String(group || "");
  if (g === "policie" || g === "hzs" || g === "kyber") return { sectionId: "bezpecnost", subsectionId: g === "hzs" ? "hasici" : g === "kyber" ? "varovani" : "policie" };
  if (g === "pocasi" || g === "chmi") return { sectionId: "pocasi", subsectionId: "vystrahy" };
  if (g === "doprava") return { sectionId: "doprava", subsectionId: "silnice" };
  if (g === "zdravotnictvi" || g === "hygiena") return { sectionId: "zdravi", subsectionId: "mzcr" };
  if (g === "ministerstva" || g === "verejna-sprava" || g === "stat") return { sectionId: "stat", subsectionId: "urady" };
  if (g === "veda" || g === "skoly") return { sectionId: "veda", subsectionId: "avcr" };
  if (g === "kultura") return { sectionId: "kultura", subsectionId: "mkcr" };
  if (g === "sport") return { sectionId: "sport", subsectionId: "msmt-sport" };
  if (g === "verejnopravni-media") return { sectionId: "cesko-svet", subsectionId: "ekonomika-cr" };
  return { sectionId: "cesko-svet", subsectionId: "ekonomika-cr" };
}

export async function fetchText(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": IU_INFO_EVENTS_UA,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, finalUrl: res.url || url };
}

const HTML_NAV_TITLE_RE =
  /^(přejít|prejit|skoč|skoc|menu|přihlásit|prihlasit|odhlásit|odhlasit|hledat|search|cookie|přijmout|prijmout|odmítnout|odmitnout|více|vice|zpět|zpet|domů|domu|mapa webu|rss|english|deutsch|facebook|twitter|instagram|linkedin|youtube|členové|clenove|ministerstvo|základní|zakladni|organizační|organizacni|kontakt|úvod|uvod)\b/i;

const HTML_ARTICLE_PATH_RE =
  /(\d{5,})|\/(clanek|aktualit|aktualita|novinka|tiskov|press|zprava|zpravy|news|mediaservice|detail|dokument)|\.aspx(?:\?|$)|\/\d{4}\/\d{2}\//i;

const HTML_REJECT_PATH_RE =
  /\/(login|auth|c\/portal|o-serveru|ochrana-osobnich|cookies?|mapa-webu|sitemap|rss\.aspx|feed)(\/|$)/i;

/** Extract article-like anchors from an HTML listing page (official press lists). */
export function extractHtmlListItems(html, pageUrl, opts = {}) {
  const max = Number(opts.max || 40);
  const hrefRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = hrefRe.exec(String(html || ""))) && out.length < max * 4) {
    const href = normalizeItemUrl(m[1], pageUrl);
    let title = stripHtml(m[2]).replace(/\s+/g, " ").trim();
    if (!href || !title || title.length < 28) continue;
    if (HTML_NAV_TITLE_RE.test(title)) continue;
    if (!isConcreteItemUrl(href, opts.homeUrl)) continue;
    try {
      const u = new URL(href);
      const path = u.pathname || "/";
      if (HTML_REJECT_PATH_RE.test(path)) continue;
      if (!HTML_ARTICLE_PATH_RE.test(path + u.search)) continue;
      const hu = opts.homeUrl ? new URL(opts.homeUrl).hostname.replace(/^www\./, "") : "";
      const iu = u.hostname.replace(/^www\./, "");
      if (hu && iu !== hu && !iu.endsWith("." + hu) && !hu.endsWith("." + iu)) continue;
      // Drop links that only point back to the listing page itself
      const listPath = new URL(pageUrl).pathname.replace(/\/+$/, "") || "/";
      const itemPath = path.replace(/\/+$/, "") || "/";
      if (itemPath === listPath) continue;
    } catch {
      continue;
    }
    const key = href.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, link: href, pubDate: "" });
  }
  return out.slice(0, max);
}

export function dedupeByUrlAndGroup(items) {
  const byUrl = new Map();
  for (const it of items) {
    const u = String(it.url || "").toLowerCase();
    if (!u) continue;
    const prev = byUrl.get(u);
    if (!prev) {
      byUrl.set(u, it);
      continue;
    }
    const pt = Date.parse(prev.updatedAt || prev.publishedAt || 0) || 0;
    const et = Date.parse(it.updatedAt || it.publishedAt || 0) || 0;
    if (et >= pt) byUrl.set(u, it);
  }
  // Secondary: same groupKey keep newest as primary; others become link members via UI clustering
  return Array.from(byUrl.values());
}
